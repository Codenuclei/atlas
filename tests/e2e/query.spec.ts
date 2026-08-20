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
  await expect(page.getByText("yc-companies")).toBeVisible();
  await page.getByRole("button", { name: /Evidence/ }).click();
  await expect(page.getByText("Ramp").first()).toBeVisible({ timeout: 15_000 });
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
  await expect(page.getByText("External matching creatives")).toBeVisible();
  await page.getByRole("button", { name: /Evidence/ }).click();
  await expect(
    page.getByText("Founder explains how to validate an idea"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("What students built during venture week"),
  ).toBeVisible();
});
