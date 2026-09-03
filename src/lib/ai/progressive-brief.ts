import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  buildYcEvidenceContext,
  generateBrief,
  scoreResults,
} from "@/lib/ai/synthesize";
import { buildYcFallbackBrief } from "@/lib/ai/yc-fallback-brief";
import { logClaude } from "@/lib/ai/claude-log";
import {
  detailHashKey,
  LIST_HASH_KEY,
  touchDataHash,
} from "@/lib/data-hash";
import type { ScrapedRecord } from "@/lib/normalize";
import { isTestMode } from "@/lib/utils";

/** Claude brief pass size — one pass per batch of newly ingested YC companies. */
export const YC_BRIEF_PASS_SIZE = 50;

export type ProgressiveBriefPass = {
  passNumber: number;
  itemCountAtPass: number;
  companyCount: number;
  completedAt: string;
};

export type ProgressiveBriefState = {
  passes: ProgressiveBriefPass[];
  accumulatedSummary: string;
  lastPassCompanyCount: number;
  inProgress?: boolean;
  finalVerified?: boolean;
};

export function parseProgressiveBriefState(
  raw: unknown,
): ProgressiveBriefState | null {
  if (!raw || typeof raw !== "object") return null;
  const state = raw as ProgressiveBriefState;
  if (!Array.isArray(state.passes)) return null;
  return {
    passes: state.passes,
    accumulatedSummary: state.accumulatedSummary ?? "",
    lastPassCompanyCount: state.lastPassCompanyCount ?? 0,
    inProgress: state.inProgress,
    finalVerified: state.finalVerified,
  };
}

export function countYcCompanies(records: ScrapedRecord[]): number {
  return records.filter((record) => record.sourceType === "yc").length;
}

/** True when at least YC_BRIEF_PASS_SIZE new YC companies arrived since the last pass. */
export function shouldScheduleProgressivePass(
  ycCompanyCount: number,
  state: ProgressiveBriefState | null | undefined,
): boolean {
  if (state?.inProgress || state?.finalVerified) return false;
  const last = state?.lastPassCompanyCount ?? 0;
  return ycCompanyCount >= last + YC_BRIEF_PASS_SIZE;
}

/** Slice the next batch of YC company rows for a progressive brief pass. */
export function companiesForNextPass(
  records: ScrapedRecord[],
  state: ProgressiveBriefState | null | undefined,
): ScrapedRecord[] {
  const companies = records.filter((record) => record.sourceType === "yc");
  const start = state?.lastPassCompanyCount ?? 0;
  return companies.slice(start, start + YC_BRIEF_PASS_SIZE);
}

const FINAL_VERIFY_INSTRUCTIONS = [
  "FINAL VERIFY PASS",
  "You are merging a progressive YC research brief with the full evidence set.",
  "Never remove a company that satisfies the user query in any aspect — preserve all valid matches from the progressive draft and add any newly discovered matches.",
  "Improve evidence quality and fill gaps; do not shrink the matched set.",
].join("\n");

function testModePassSummary(
  query: string,
  batch: ScrapedRecord[],
  passNumber: number,
): string {
  const names = batch
    .filter((record) => record.sourceType === "yc")
    .map((record) => record.title)
    .slice(0, 5)
    .join(", ");
  return `Pass ${passNumber} (${batch.length} records) for "${query}": ${names || "no companies"}.`;
}

export async function runProgressiveBriefPass(
  queryId: string,
): Promise<boolean> {
  const query = await db.query.findUnique({
    where: { id: queryId },
    include: { results: true },
  });
  if (!query) return false;

  const records = query.results.map((row) => row.data as ScrapedRecord);
  const ycCount = countYcCompanies(records);
  const state = parseProgressiveBriefState(query.progressiveBrief);
  if (!shouldScheduleProgressivePass(ycCount, state)) return false;

  const batch = companiesForNextPass(records, state);
  if (batch.length === 0) return false;

  const passNumber = (state?.passes.length ?? 0) + 1;
  if (state?.inProgress) return false;

  await db.query.update({
    where: { id: queryId },
    data: {
      progressiveBrief: {
        passes: state?.passes ?? [],
        accumulatedSummary: state?.accumulatedSummary ?? "",
        lastPassCompanyCount: state?.lastPassCompanyCount ?? 0,
        inProgress: true,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  logClaude("progressive_brief.pass.start", {
    queryId,
    passNumber,
    batchSize: batch.length,
    ycCount,
  });

  try {
    let chunk = "";
    if (isTestMode()) {
      chunk = testModePassSummary(query.text, batch, passNumber);
    } else {
      const ctx = { queryId, trigger: "auto" as const };
      const synthesis = await scoreResults(query.text, batch, ctx);
      chunk =
        synthesis.summary.trim() ||
        (await generateBrief(query.text, batch, ctx)).trim();
      if (!chunk.trim()) {
        chunk = buildYcFallbackBrief(
          query.text,
          batch,
          "empty_pass",
          ctx,
        ).summary;
      }
    }

    const accumulated = [state?.accumulatedSummary ?? "", chunk]
      .filter(Boolean)
      .join("\n\n");
    const nextState: ProgressiveBriefState = {
      passes: [
        ...(state?.passes ?? []),
        {
          passNumber,
          itemCountAtPass: query.results.length,
          companyCount: ycCount,
          completedAt: new Date().toISOString(),
        },
      ],
      accumulatedSummary: accumulated,
      lastPassCompanyCount:
        (state?.lastPassCompanyCount ?? 0) + batch.filter((r) => r.sourceType === "yc").length,
      inProgress: false,
    };

    await db.query.update({
      where: { id: queryId },
      data: {
        progressiveBrief: nextState as unknown as Prisma.InputJsonValue,
        summary: accumulated,
      },
    });
    await touchDataHash(LIST_HASH_KEY, detailHashKey(queryId));

    logClaude("progressive_brief.pass.done", {
      queryId,
      passNumber,
      summaryLength: accumulated.length,
    });
    return true;
  } catch (error) {
    console.error("runProgressiveBriefPass failed", queryId, error);
    await db.query.update({
      where: { id: queryId },
      data: {
        progressiveBrief: {
          ...(state ?? {
            passes: [],
            accumulatedSummary: "",
            lastPassCompanyCount: 0,
          }),
          inProgress: false,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    return false;
  }
}

/** Fire-and-forget progressive pass when ingest crosses a 50-company threshold. */
export function scheduleProgressiveBrief(queryId: string) {
  void runProgressiveBriefPass(queryId).catch((error) => {
    console.error("scheduleProgressiveBrief failed", queryId, error);
  });
}

/**
 * Final verify pass when the query reaches terminal success.
 * Preserves progressive matches; yc-fallback-brief remains the safety net on failure.
 */
export async function runFinalBriefVerify(
  queryId: string,
  queryText: string,
  records: ScrapedRecord[],
  state: ProgressiveBriefState | null,
): Promise<string> {
  if (state?.finalVerified && state.accumulatedSummary.trim()) {
    return state.accumulatedSummary;
  }

  const ctx = { queryId, trigger: "auto" as const };
  let verified = "";
  if (isTestMode()) {
    verified =
      state?.accumulatedSummary ||
      `Verified ${countYcCompanies(records)} YC companies for "${queryText}".`;
  } else {
    try {
      const draft = state?.accumulatedSummary?.trim() ?? "";
      const evidence = buildYcEvidenceContext(records, queryText, 50);
      const prompt = [
        `Query: ${queryText}`,
        FINAL_VERIFY_INSTRUCTIONS,
        draft ? `Progressive draft to preserve valid matches from:\n${draft}` : "",
        "Structured evidence (curated fields only — never raw Apify JSON):",
        JSON.stringify(evidence),
      ]
        .filter(Boolean)
        .join("\n\n");
      verified = (await generateBrief(prompt, records, ctx)).trim();
      if (!verified) {
        const synthesis = await scoreResults(queryText, records, ctx);
        verified = synthesis.summary.trim();
      }
    } catch (error) {
      console.error("runFinalBriefVerify failed", queryId, error);
      verified =
        state?.accumulatedSummary ||
        buildYcFallbackBrief(queryText, records, "verify_failed", ctx).summary;
    }
  }

  const nextState: ProgressiveBriefState = {
    passes: state?.passes ?? [],
    accumulatedSummary: verified,
    lastPassCompanyCount: countYcCompanies(records),
    finalVerified: true,
    inProgress: false,
  };
  await db.query.update({
    where: { id: queryId },
    data: {
      progressiveBrief: nextState as unknown as Prisma.InputJsonValue,
      summary: verified,
    },
  });
  return verified;
}
