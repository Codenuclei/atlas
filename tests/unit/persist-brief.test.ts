import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { persistQueryBrief } from "@/lib/orchestrator";
import { generateBrief, scoreResults } from "@/lib/ai/synthesize";
import { AppError } from "@/lib/errors";
import type { ScrapedRecord } from "@/lib/normalize";

vi.mock("@/lib/ai/synthesize", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/synthesize")>(
    "@/lib/ai/synthesize",
  );
  return {
    ...actual,
    generateBrief: vi.fn(async () => "short brief"),
    scoreResults: vi.fn(async () => ({
      scores: [
        { externalId: "c1", score: 0.9, reason: "Matches fintech" },
        { externalId: "c2", score: 0.8, reason: "Matches fintech" },
      ],
      summary: "STRUCTURED SUMMARY",
    })),
  };
});

const records: ScrapedRecord[] = [
  {
    sourceType: "yc",
    externalId: "c1",
    title: "Ramp",
    subtitle: "Corporate cards",
    url: "https://www.ycombinator.com/companies/ramp",
    location: "New York",
    imageUrl: "",
    raw: {},
  },
  {
    sourceType: "yc",
    externalId: "c2",
    title: "Scale AI",
    subtitle: "Data labeling",
    url: "https://www.ycombinator.com/companies/scale-ai",
    location: "San Francisco",
    imageUrl: "",
    raw: {},
  },
];

const EMPTY_PLAN = {
  interpretation: "found",
  intent: "companies",
  expectedResultType: "companies",
  clarificationNeeded: "",
  steps: [],
};

type SeedOptions = {
  status?: string;
  jobStatus?: string;
  results?: ScrapedRecord[];
  summary?: string | null;
  synthesisStartedAt?: Date | null;
};

async function seedQuery(options: SeedOptions = {}): Promise<string> {
  const results = options.results ?? records;
  const query = await db.query.create({
    data: {
      text: "YC companies in fintech",
      interpretation: "Find YC fintech companies",
      plan: EMPTY_PLAN,
      status: options.status ?? "succeeded",
      costEstimateUsd: 1,
      summary: options.summary ?? null,
      synthesisStartedAt: options.synthesisStartedAt ?? null,
      jobs: {
        create: [
          {
            connectorId: "yc-companies",
            stepIndex: 0,
            status: options.jobStatus ?? "succeeded",
            input: {},
          },
        ],
      },
    },
    select: { id: true },
  });
  const job = await db.job.findFirstOrThrow({
    where: { queryId: query.id },
    select: { id: true },
  });
  if (results.length > 0) {
    await db.result.createMany({
      data: results.map((record) => ({
        queryId: query.id,
        jobId: job.id,
        sourceType: record.sourceType,
        externalId: record.externalId,
        mergeKey: `${record.sourceType}:${record.externalId}`,
        data: record as unknown as Prisma.InputJsonValue,
      })),
    });
  }
  return query.id;
}

afterEach(async () => {
  vi.mocked(generateBrief).mockResolvedValue("short brief");
  vi.mocked(scoreResults).mockResolvedValue({
    scores: [
      { externalId: "c1", score: 0.9, reason: "Matches fintech" },
      { externalId: "c2", score: 0.8, reason: "Matches fintech" },
    ],
    summary: "STRUCTURED SUMMARY",
  });
  await db.result.deleteMany();
  await db.job.deleteMany();
  await db.query.deleteMany();
});

describe("persistQueryBrief", () => {
  it("writes summary and scores, then serves them from cache", async () => {
    const id = await seedQuery();
    const deltas: string[] = [];

    const first = await persistQueryBrief(id, {
      trigger: "auto",
      onDelta: (delta) => deltas.push(delta),
    });
    expect(first).toEqual({
      summary: "STRUCTURED SUMMARY",
      cached: false,
      scoresUpdated: 2,
    });
    expect(deltas).toEqual(["STRUCTURED SUMMARY"]);

    const stored = await db.query.findUniqueOrThrow({ where: { id } });
    expect(stored.summary).toBe("STRUCTURED SUMMARY");
    expect(stored.synthesisStartedAt).toBeNull();
    const scored = await db.result.findMany({
      where: { queryId: id },
      select: { externalId: true, score: true },
    });
    expect(Object.fromEntries(scored.map((r) => [r.externalId, r.score]))).toEqual(
      { c1: 0.9, c2: 0.8 },
    );

    const briefCalls = vi.mocked(generateBrief).mock.calls.length;
    const second = await persistQueryBrief(id, { trigger: "auto" });
    expect(second).toEqual({
      summary: "STRUCTURED SUMMARY",
      cached: true,
      scoresUpdated: 0,
    });
    expect(vi.mocked(generateBrief).mock.calls.length).toBe(briefCalls);
  });

  it("prefers the streamed brief when it exceeds 400 characters", async () => {
    const id = await seedQuery();
    vi.mocked(generateBrief).mockResolvedValue("x".repeat(500));

    const result = await persistQueryBrief(id, { trigger: "auto" });
    expect(result.summary).toHaveLength(500);
    expect(result.cached).toBe(false);
    expect(result.scoresUpdated).toBe(2);
  });

  it("force-regenerates over an existing summary", async () => {
    const id = await seedQuery({ summary: "OLD SUMMARY" });
    const result = await persistQueryBrief(id, { force: true, trigger: "regenerate" });
    expect(result.cached).toBe(false);
    expect(result.summary).toBe("STRUCTURED SUMMARY");
  });

  it("rejects a run that is still in progress", async () => {
    const id = await seedQuery({ status: "running", jobStatus: "running" });
    const error = await persistQueryBrief(id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
      message: expect.stringMatching(/still in progress/),
    });
  });

  it("rejects a success with no collected results", async () => {
    const id = await seedQuery({ results: [] });
    const error = await persistQueryBrief(id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      message: "No collected results to synthesize a brief from.",
    });
  });

  it("rejects when another writer holds the synthesis claim", async () => {
    const id = await seedQuery({
      summary: null,
      synthesisStartedAt: new Date(),
    });
    const error = await persistQueryBrief(id, { force: true }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      status: 409,
      message: "A brief is already being generated.",
    });
  });

  it("releases the claim when synthesis fails", async () => {
    const id = await seedQuery();
    vi.mocked(scoreResults).mockRejectedValueOnce(new Error("boom"));

    await expect(persistQueryBrief(id)).rejects.toThrow("boom");
    const stored = await db.query.findUniqueOrThrow({ where: { id } });
    expect(stored.synthesisStartedAt).toBeNull();
    expect(stored.summary).toBeNull();
  });

  it("throws a 404 for an unknown query", async () => {
    const error = await persistQueryBrief("does-not-exist").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
