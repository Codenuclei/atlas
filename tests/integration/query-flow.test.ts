import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createQueryFromPlan, ingestRecords, syncQuery } from "@/lib/orchestrator";
import { heuristicPlan } from "@/lib/ai/heuristic-plan";
import { resetMockApify, seedMockApifyRun } from "@/lib/apify/mock";
import { getApify } from "@/lib/apify/client";
import type { ScrapedRecord } from "@/lib/normalize";

afterEach(async () => {
  resetMockApify();
  await db.result.deleteMany();
  await db.job.deleteMany();
  await db.query.deleteMany();
});

async function waitForSummary(queryId: string, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    const row = await db.query.findUnique({
      where: { id: queryId },
      select: { summary: true },
    });
    if (row?.summary) return row.summary;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

describe("query flow", () => {
  it("runs a YC query to completion and stores results", async () => {
    const plan = heuristicPlan("YC companies hiring in fintech");
    const created = await createQueryFromPlan("YC companies hiring in fintech", plan);
    const synced = await syncQuery(created.id);
    expect(synced.status).toBe("succeeded");
    expect(synced.results.length).toBeGreaterThan(0);
    expect(await waitForSummary(created.id)).toBeTruthy();
  });

  it("runs a two-step search-then-people plan", async () => {
    const plan = heuristicPlan("AI founders in SF who went through YC with deeper LinkedIn enrichment");
    const created = await createQueryFromPlan(
      "AI founders in SF who went through YC with deeper LinkedIn enrichment",
      plan,
    );
    const synced = await syncQuery(created.id);
    expect(synced.jobs.length).toBeGreaterThan(1);
    expect(synced.jobs.every((job) => job.status === "succeeded")).toBe(true);
    expect(synced.results.length).toBeGreaterThan(0);
  });

  it("runs cross-platform content analysis to completion", async () => {
    const plan = heuristicPlan(
      "Analyze Example Brand across YouTube and Instagram",
    );
    const created = await createQueryFromPlan(
      "Analyze Example Brand across YouTube and Instagram",
      plan,
    );
    let synced = await syncQuery(created.id);
    expect(synced.status).toBe("succeeded");
    expect(synced.results.map((result) => result.sourceType).sort()).toEqual([
      "instagram",
      "instagram",
      "instagram",
      "instagram",
      "youtube",
      "youtube",
      "youtube",
      "youtube",
    ]);
    if (!synced.summary) {
      synced = {
        ...synced,
        summary: await waitForSummary(created.id),
      };
    }
    expect(synced.summary).toContain("Found 8 results");
    expect(
      (synced.jobs[2].input as { searchQueries?: string[] }).searchQueries,
    ).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(
      (synced.jobs[3].input as { directUrls?: string[] }).directUrls,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("instagram.com/explore/tags/"),
      ]),
    );
  });

  it("ingests paginated Apify datasets", async () => {
    const items = Array.from({ length: 150 }, (_, index) => ({
      id: `p-${index}`,
      fullName: `Person ${index}`,
      linkedinUrl: `https://www.linkedin.com/in/person-${index}`,
      headline: "Engineer",
    }));
    seedMockApifyRun("page-run", {
      status: "SUCCEEDED",
      defaultDatasetId: "page-ds",
      items,
    });
    const plan = heuristicPlan("engineers in SF");
    const created = await createQueryFromPlan("engineers in SF", plan);
    await db.job.update({
      where: { id: created.jobs[0].id },
      data: {
        apifyRunId: "page-run",
        apifyDatasetId: "page-ds",
        status: "running",
      },
    });
    const synced = await syncQuery(created.id);
    expect(synced.results.length).toBe(150);
  });

  it("is idempotent when the same records are ingested twice", async () => {
    const plan = heuristicPlan("YC companies hiring in fintech");
    const created = await createQueryFromPlan("YC companies hiring in fintech", plan);
    const first = await syncQuery(created.id);
    const record = first.results[0].data as ScrapedRecord;
    await ingestRecords(first.id, first.jobs[0].id, [record, record]);
    const again = await db.result.count({ where: { queryId: first.id } });
    expect(again).toBe(first.results.length);
  });

  it("records a failed Apify run", async () => {
    seedMockApifyRun("fail-run", {
      status: "FAILED",
      statusMessage: "Actor crashed",
      items: [],
    });
    const plan = heuristicPlan("engineers in SF");
    const created = await createQueryFromPlan("engineers in SF", plan);
    await db.job.update({
      where: { id: created.jobs[0].id },
      data: { apifyRunId: "fail-run", status: "running" },
    });
    const synced = await syncQuery(created.id);
    expect(synced.jobs[0].status).toBe("failed");
    expect(synced.status).toBe("failed");
  });

  it("fails dependent jobs when an upstream step fails", async () => {
    const plan = heuristicPlan("AI founders in SF who went through YC with deeper LinkedIn enrichment");
    const created = await createQueryFromPlan(
      "AI founders in SF who went through YC with deeper LinkedIn enrichment",
      plan,
    );
    await db.job.update({
      where: { id: created.jobs[0].id },
      data: {
        status: "failed",
        apifyRunId: null,
        error: "Actor crashed",
        finishedAt: new Date(),
      },
    });

    const synced = await syncQuery(created.id);
    expect(synced.jobs).toHaveLength(2);
    expect(synced.jobs[1].status).toBe("failed");
    expect(synced.jobs[1].error).toContain("Dependency");
    expect(synced.status).toBe("failed");
  });

  it("maps TIMED-OUT runs", async () => {
    seedMockApifyRun("timeout-run", { status: "TIMED-OUT", items: [] });
    const plan = heuristicPlan("engineers in SF");
    const created = await createQueryFromPlan("engineers in SF", plan);
    await db.job.update({
      where: { id: created.jobs[0].id },
      data: { apifyRunId: "timeout-run", status: "running" },
    });
    const synced = await syncQuery(created.id);
    expect(synced.jobs[0].status).toBe("timed_out");
  });
});

describe("apify mock pagination", () => {
  it("returns dataset pages with total/offset/count", async () => {
    seedMockApifyRun("ds-run", {
      defaultDatasetId: "ds-1",
      items: [{ id: "a" }, { id: "b" }, { id: "c" }],
    });
    const page = await getApify().listDatasetItems("ds-1", { limit: 2, offset: 0 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    const page2 = await getApify().listDatasetItems("ds-1", { limit: 2, offset: 2 });
    expect(page2.items).toHaveLength(1);
  });
});
