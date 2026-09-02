import { expect, test } from "@playwright/test";

test("user can interpret a query, run it, and export CSV", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("textbox").first();
  await expect(input).toBeVisible();
  await input.fill("YC companies hiring in fintech");
  await page.getByRole("button", { name: /Generate plan/ }).click();
  await expect(page.getByText("Approve the research operation")).toBeVisible();
  await page.getByRole("button", { name: /Approve & run/ }).click();
  await expect(page).toHaveURL(/\/queries\//);
  await page.getByRole("button", { name: /Evidence/ }).click();
  await expect(page.getByText("Company").first()).toBeVisible({ timeout: 15_000 });
  // The Ramp company row is the evidence this run was asked for; reference
  // rows ("Eric Glyman") also contain the word "Ramp", so target the link.
  await expect(page.getByRole("link", { name: "Ramp" })).toBeVisible({
    timeout: 15_000,
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export all/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});

test("user can analyze content across YouTube and Instagram", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox")
    .first()
    .fill("Analyze Example Brand across YouTube and Instagram");
  await page.getByRole("button", { name: /Generate plan/ }).click();
  await expect(page.getByText("youtube-content", { exact: true })).toBeVisible();
  await expect(
    page.getByText("instagram-content", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("youtube-content-examples")).toBeVisible();
  await expect(page.getByText("instagram-content-examples")).toBeVisible();
  await page.getByRole("button", { name: /Approve & run/ }).click();
  await expect(page).toHaveURL(/\/queries\//);
  await expect(
    page.getByRole("button", { name: /Creatives/ }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("External matching creatives")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: /Evidence/ }).click();
  await expect(
    page.getByText("Founder explains how to validate an idea"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("What students built during venture week"),
  ).toBeVisible();
});

test("unchecked steps are excluded from the run", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("textbox")
    .first()
    .fill("Analyze Example Brand across YouTube and Instagram");
  await page.getByRole("button", { name: /Generate plan/ }).click();
  await expect(page.getByText("Approve the research operation")).toBeVisible();

  // Exclude External YouTube; nothing depends on it, so it must not cascade.
  await page
    .getByRole("checkbox", { name: /\(youtube-content-examples\)$/ })
    .uncheck();
  await expect(page.getByText("Excluded with")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Approve & run 3 steps" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Approve & run/ }).click();
  await expect(page).toHaveURL(/\/queries\//);

  // The server must never create a job for the excluded connector.
  const id = new URL(page.url()).pathname.split("/").pop();
  const response = await page.request.get(`/api/queries/${id}`);
  const connectors = (await response.json()).query.jobs.map(
    (job: { connectorId: string }) => job.connectorId,
  );
  expect(connectors).not.toContain("youtube-content-examples");
  expect(connectors).toHaveLength(3);

  await page.getByRole("button", { name: /Evidence/ }).click();
  await expect(
    page.getByText("Three founder decisions"),
  ).toBeVisible({ timeout: 15_000 });
  // The excluded step's platform must not appear in the results.
  await expect(page.getByText("How a startup grew from zero")).not.toBeVisible();
});

test("excluding a step cascades to steps that depend on it", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox")
    .first()
    .fill("Analyze Example Brand across YouTube and Instagram");
  await page.getByRole("button", { name: /Generate plan/ }).click();
  await expect(page.getByText("Approve the research operation")).toBeVisible();

  // Owned Instagram feeds both external example steps, so excluding it must
  // pull them in too — otherwise the run would be rejected server-side.
  await page
    .getByRole("checkbox", { name: /\(instagram-content\)$/ })
    .uncheck();
  await expect(page.getByText("Excluded with Owned Instagram")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Approve & run 1 step" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Approve & run/ }).click();
  await expect(page).toHaveURL(/\/queries\//);

  // Only the Owned YouTube step may run.
  const id = new URL(page.url()).pathname.split("/").pop();
  const response = await page.request.get(`/api/queries/${id}`);
  const connectors = (await response.json()).query.jobs.map(
    (job: { connectorId: string }) => job.connectorId,
  );
  expect(connectors).toEqual(["youtube-content"]);
});

test("'Edit query' keeps the typed query when returning from review", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("textbox")
    .first()
    .fill("Analyze Example Brand across YouTube and Instagram");
  await page.getByRole("button", { name: /Generate plan/ }).click();
  await expect(page.getByText("Approve the research operation")).toBeVisible();
  await page.getByRole("button", { name: "Edit query" }).click();
  await expect(
    page.getByRole("textbox", { name: "Research query" }),
  ).toHaveValue("Analyze Example Brand across YouTube and Instagram");
});
