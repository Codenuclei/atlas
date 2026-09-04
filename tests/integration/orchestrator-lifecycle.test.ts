import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  abortQuery,
  claimQueuedWork,
  createQueryFromPlan,
  deleteQuery,
  getQuery,
  listQueries,
  rerunQuery,
  retryFailedJobs,
  syncQuery,
} from "@/lib/orchestrator";
import { heuristicPlan } from "@/lib/ai/heuristic-plan";
import { resetMockApify } from "@/lib/apify/mock";
import { AppError } from "@/lib/errors";
import type { ScrapePlan } from "@/lib/ai/plan-schema";

function twoStepPlan(): ScrapePlan {
  return {
    interpretation: "Find engineering jobs and their companies",
    intent: "companies",
    expectedResultType: "companies",
    clarificationNeeded: "",
    steps: [
      {
        connectorId: "linkedin-jobs",
        purpose: "Find open jobs",
        dependsOn: [],
        params: { jobTitles: ["Senior Backend Engineer"], locations: ["Berlin"], maxItems: 10 },
      },
      {
        connectorId: "linkedin-profile-search",
        purpose: "Find related people",
        dependsOn: ["linkedin-jobs"],
        params: { searchQuery: "backend founders", maxItems: 10 },
      },
    ],
  };
}

/** Two independent steps so both start concurrently at creation. */
function parallelPlan(): ScrapePlan {
  return {
    interpretation: "Find engineering jobs and their companies",
    intent: "companies",
    expectedResultType: "companies",
    clarificationNeeded: "",
    steps: [
      {
        connectorId: "linkedin-jobs",
        purpose: "Find open jobs",
        dependsOn: [],
        params: { jobTitles: ["Senior Backend Engineer"], locations: ["Berlin"], maxItems: 10 },
      },
      {
        connectorId: "linkedin-profile-search",
        purpose: "Find related people",
        dependsOn: [],
        params: { searchQuery: "backend founders", maxItems: 10 },
      },
    ],
  };
}

async function runJobsQueryToCompletion() {
  const plan = heuristicPlan("senior backend roles in Berlin");
  const created = await createQueryFromPlan("senior backend roles in Berlin", plan);
  const synced = await syncQuery(created.id);
  expect(synced.status).toBe("succeeded");
  return synced;
}

afterEach(async () => {
  resetMockApify();
  await db.result.deleteMany();
  await db.job.deleteMany();
  await db.query.deleteMany();
});

describe("retryFailedJobs", () => {
  it("clears failed runs and re-runs them to completion", async () => {
    const created = await createQueryFromPlan(
      "senior backend roles in Berlin",
      heuristicPlan("senior backend roles in Berlin"),
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
    const failed = await syncQuery(created.id);
    expect(failed.jobs[0].status).toBe("failed");

    const retried = await retryFailedJobs(created.id);
    expect(retried.status).toBe("succeeded");
    expect(retried.jobs[0].status).toBe("succeeded");
    expect(retried.jobs[0].error).toBeNull();
    expect(retried.jobs[0].apifyRunId).toBeTruthy();
    expect(retried.jobs[0].itemCount).toBeGreaterThan(0);
    expect(retried.results.length).toBeGreaterThan(0);

    const stored = await db.job.findUniqueOrThrow({
      where: { id: created.jobs[0].id },
    });
    expect(stored.status).toBe("succeeded");
  });

  it("rejects a run whose jobs are still active", async () => {
    const plan = twoStepPlan();
    const created = await createQueryFromPlan("founders in Berlin fintech", plan);
    const error = await retryFailedJobs(created.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/still in progress/),
    });
  });

  it("rejects an already-successful query with nothing to retry", async () => {
    const synced = await runJobsQueryToCompletion();
    const error = await retryFailedJobs(synced.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      message: "No failed steps to retry.",
    });
  });

  it("throws 404 for an unknown query", async () => {
    const error = await retryFailedJobs("nope").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("rerunQuery", () => {
  it("clones the finished query under a new id", async () => {
    const synced = await runJobsQueryToCompletion();
    const rerun = await rerunQuery(synced.id);
    expect(rerun.id).not.toBe(synced.id);
    expect(rerun.text).toBe(synced.text);
    expect(rerun.jobs.map((job) => job.connectorId)).toEqual(
      synced.jobs.map((job) => job.connectorId),
    );
    expect(await db.query.findUnique({ where: { id: synced.id } })).not.toBeNull();
  });
});

describe("abortQuery", () => {
  it("aborts active Apify runs and marks every job and the query aborted", async () => {
    const created = await createQueryFromPlan("abort me", parallelPlan());
    const runIds = (await db.job.findMany({ where: { queryId: created.id } }))
      .map((job) => job.apifyRunId)
      .filter(Boolean) as string[];
    expect(runIds.length).toBe(2);

    const aborted = await abortQuery(created.id);
    expect(aborted.status).toBe("aborted");
    expect(aborted.jobs.every((job) => job.status === "aborted")).toBe(true);

    const { getApify } = await import("@/lib/apify/client");
    for (const runId of runIds) {
      expect((await getApify().getRun(runId)).status).toBe("ABORTED");
    }
  });
});

describe("deleteQuery", () => {
  it("aborts active runs and removes the query and its rows", async () => {
    const created = await createQueryFromPlan("delete me", parallelPlan());
    const runIds = (await db.job.findMany({ where: { queryId: created.id } }))
      .map((job) => job.apifyRunId)
      .filter(Boolean) as string[];

    const result = await deleteQuery(created.id);
    expect(result).toEqual({ id: created.id });
    expect(await db.query.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await db.job.count({ where: { queryId: created.id } })).toBe(0);

    const { getApify } = await import("@/lib/apify/client");
    for (const runId of runIds) {
      expect((await getApify().getRun(runId)).status).toBe("ABORTED");
    }
  });

  it("throws 404 when the query does not exist", async () => {
    const error = await deleteQuery("missing").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("YC sparse-result broaden recovery", () => {
  it("requeues sparse YC runs with a broaden notice and still succeeds", async () => {
    const created = await createQueryFromPlan(
      "YC companies hiring in fintech",
      heuristicPlan("YC companies hiring in fintech"),
    );
    const synced = await syncQuery(created.id);

    expect(synced.status).toBe("succeeded");
    expect(synced.results.length).toBeGreaterThan(0);
    expect(
      synced.results.filter((result) => result.sourceType === "yc").length,
    ).toBeGreaterThan(0);

    const job = synced.jobs[0];
    const input = job.input as {
      _broadenAttempt?: number;
      _notice?: string;
      _ingested?: boolean;
    };
    expect(input._ingested).toBe(true);
    expect(input._broadenAttempt).toBeGreaterThanOrEqual(1);
    expect(input._notice).toBeTruthy();
    // The sparse-run notice is appended to the interpreted brief and explains
    // which filter was dropped to recover from the too-narrow run.
    expect(synced.interpretation).toContain("Only a few companies matched");
    expect(synced.interpretation).toContain(input._notice as string);
  });
});

describe("claimQueuedWork", () => {
  it("claims queued and orphaned jobs across queries", async () => {
    const first = await createQueryFromPlan(
      "senior backend roles in Berlin",
      heuristicPlan("senior backend roles in Berlin"),
    );
    const second = await createQueryFromPlan(
      "senior backend roles in Berlin",
      heuristicPlan("senior backend roles in Berlin"),
    );
    // Reset both to a pre-claim state; orphan the second job (running, no run).
    await db.job.updateMany({
      where: { queryId: first.id },
      data: { status: "queued", apifyRunId: null },
    });
    await db.job.updateMany({
      where: { queryId: second.id },
      data: { status: "running", apifyRunId: null },
    });

    const claim = await claimQueuedWork(5);
    expect(claim.queryIds).toHaveLength(2);
    expect(claim.claimed).toBeGreaterThanOrEqual(1);

    const jobs = await db.job.findMany({
      where: { queryId: { in: [first.id, second.id] } },
    });
    expect(jobs.every((job) => job.status === "running")).toBe(true);
    expect(jobs.every((job) => job.apifyRunId)).toBe(true);
  });
});

describe("stale status reconciliation on read", () => {
  it("getQuery repairs a stored status that finished long ago", async () => {
    const synced = await runJobsQueryToCompletion();
    await db.query.update({
      where: { id: synced.id },
      data: { status: "queued" },
    });

    const fresh = await getQuery(synced.id);
    expect(fresh.status).toBe("succeeded");
    expect(
      (await db.query.findUniqueOrThrow({ where: { id: synced.id } })).status,
    ).toBe("succeeded");
  });

  it("listQueries surfaces the reconciled status without rewriting the row", async () => {
    const synced = await runJobsQueryToCompletion();
    await db.query.update({
      where: { id: synced.id },
      data: { status: "queued" },
    });

    const listed = await listQueries();
    expect(listed.find((query) => query.id === synced.id)?.status).toBe(
      "succeeded",
    );
  });
});
