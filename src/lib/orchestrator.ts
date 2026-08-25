import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getApify } from "@/lib/apify/client";
import { getConnector } from "@/lib/connectors/registry";
import { validatePlan } from "@/lib/ai/planner";
import { estimatePlanCost } from "@/lib/ai/cost";
import { generateBrief, scoreResults } from "@/lib/ai/synthesize";
import { logClaude, logClaudeError } from "@/lib/ai/claude-log";
import { extractLinkedInUrls, mergeKeyFor, mergeRecords } from "@/lib/resolve";
import {
  expandYcFounders,
  enrichYcCompaniesInput,
  ycCompanyNames,
  type YcCompaniesInput,
} from "@/lib/connectors/yc-companies";
import type { ScrapePlan } from "@/lib/ai/plan-schema";
import { sanitizeForSqliteJson, type ScrapedRecord } from "@/lib/normalize";
import {
  deriveQueryStatus,
  isActiveJobStatus,
  isTerminalJobStatus,
  isTerminalQueryStatus,
  mapApifyStatus,
} from "@/lib/status";
import { AppError } from "@/lib/errors";
import {
  LIST_HASH_KEY,
  detailHashKey,
  dropDataHash,
  touchDataHash,
} from "@/lib/data-hash";
import {
  collectOwnedBrandSignals,
  deriveContentExampleQueries,
  deriveInstagramExampleHashtags,
  isOwnedBrandCreative,
} from "@/lib/content-research";

function parseParams(connectorId: string, params: unknown) {
  return getConnector(connectorId).inputSchema.parse(params);
}

export async function createQueryFromPlan(text: string, planInput: ScrapePlan) {
  const plan = validatePlan(planInput);
  // Never trust empty Claude yc-companies params — derive batch/industry/keywords
  // from the user request so we don't fall back to dumping raw text into Apify.
  for (const step of plan.steps) {
    if (step.connectorId !== "yc-companies") continue;
    step.params = enrichYcCompaniesInput(
      step.params as YcCompaniesInput,
      text,
    ) as Record<string, unknown>;
  }
  const estimate = estimatePlanCost(plan);
  const query = await db.query.create({
    data: {
      text,
      interpretation: plan.interpretation,
      plan: plan as unknown as Prisma.InputJsonValue,
      status: "queued",
      costEstimateUsd: estimate.usd,
      jobs: {
        create: plan.steps.map((step, index) => ({
          connectorId: getConnector(step.connectorId).id,
          stepIndex: index,
          status: "queued",
          input: step.params as Prisma.InputJsonValue,
        })),
      },
    },
    include: { jobs: true },
  });
  await touchDataHash(LIST_HASH_KEY, detailHashKey(query.id));
  await kickReadyJobs(query.id);
  return db.query.findUniqueOrThrow({
    where: { id: query.id },
    include: { jobs: { orderBy: { stepIndex: "asc" } }, results: true },
  });
}

function stepReady(
  job: { connectorId: string; stepIndex: number },
  allJobs: Array<{ connectorId: string; status: string; stepIndex: number }>,
  plan: ScrapePlan,
) {
  const step = plan.steps[job.stepIndex];
  if (!step) return job.stepIndex === 0;
  if (!step.dependsOn.length) return true;
  return step.dependsOn.every((dep) =>
    allJobs.some(
      (other) => other.connectorId === dep && other.status === "succeeded",
    ),
  );
}

function failedDependency(
  job: { stepIndex: number },
  allJobs: Array<{ connectorId: string; status: string }>,
  plan: ScrapePlan,
) {
  const step = plan.steps[job.stepIndex];
  return step?.dependsOn.find((dependency) =>
    allJobs.some(
      (candidate) =>
        candidate.connectorId === dependency &&
        isTerminalJobStatus(candidate.status) &&
        candidate.status !== "succeeded",
    ),
  );
}

async function kickReadyJobs(queryId: string): Promise<boolean> {
  const plan = (
    await db.query.findUniqueOrThrow({
      where: { id: queryId },
    })
  ).plan as ScrapePlan;

  let changed = false;
  let progressed = true;
  while (progressed) {
    progressed = false;
    const jobs = await db.job.findMany({
      where: { queryId },
      orderBy: { stepIndex: "asc" },
    });
    for (const job of jobs) {
      if (job.status !== "queued") continue;
      if (job.apifyRunId) continue;
      const blockedBy = failedDependency(job, jobs, plan);
      if (blockedBy) {
        await db.job.update({
          where: { id: job.id },
          data: {
            status: "failed",
            error: `Dependency ${blockedBy} did not succeed.`,
            finishedAt: new Date(),
          },
        });
        progressed = true;
        changed = true;
        continue;
      }
      if (!stepReady(job, jobs, plan)) continue;
      if (await startJob(job.id)) {
        progressed = true;
        changed = true;
      }
    }
  }
  return changed;
}

async function startJob(jobId: string): Promise<boolean> {
  const job = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { query: { include: { results: true, jobs: true } } },
  });
  const claimed = await db.job.updateMany({
    where: { id: jobId, status: "queued", apifyRunId: null },
    data: { status: "running", error: null },
  });
  if (claimed.count === 0) return false;
  try {
  const connector = getConnector(job.connectorId);
  const plan = job.query.plan as ScrapePlan;
  const stepDependsOn = plan.steps[job.stepIndex]?.dependsOn ?? [];
  let params = hydrateDetailParams(
    connector.id,
    job.input,
    job.query.results.map((row) => row.data as ScrapedRecord),
    stepDependsOn,
  );
    if (connector.id === "yc-companies") {
      params = enrichYcCompaniesInput(
        params as YcCompaniesInput,
        job.query.text,
      ) as Record<string, unknown>;
    }
    if (connector.id === "youtube-content-examples") {
      const examples = { ...(params as Record<string, unknown>) };
      const existingQueries = Array.isArray(examples.searchQueries)
        ? examples.searchQueries
        : [];
      if (existingQueries.length === 0) {
        examples.searchQueries = deriveContentExampleQueries(
          job.query.results.map((row) => row.data as ScrapedRecord),
          brandHintFromQuery(job.query),
        );
      }
      params = examples;
    }
    if (connector.id === "instagram-content-examples") {
      const examples = { ...(params as Record<string, unknown>) };
      const existingHashtags = Array.isArray(examples.hashtags)
        ? examples.hashtags
        : [];
      if (existingHashtags.length === 0) {
        examples.hashtags = deriveInstagramExampleHashtags(
          job.query.results.map((row) => row.data as ScrapedRecord),
          brandHintFromQuery(job.query),
        );
      }
      params = examples;
    }
  const parsed = parseParams(connector.id, params);
  const prepared = connector.buildRun(parsed as never);
  if (connector.kind === "detail" && prepared.maxItems === 0) {
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        itemCount: 0,
        finishedAt: new Date(),
        input: prepared.input as Prisma.InputJsonValue,
      },
    });
    return true;
  }
    const run = await getApify().startActor(
      prepared.actorId!,
      prepared.input,
      { maxItems: prepared.maxItems },
    );
    await db.job.update({
      where: { id: job.id },
      data: {
        status: mapApifyStatus(run.status),
        apifyRunId: run.id,
        apifyDatasetId: run.defaultDatasetId ?? null,
        input: prepared.input as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "failed",
        error: error instanceof Error ? error.message : "Could not start actor",
        finishedAt: new Date(),
      },
    });
  }
  return true;
}

function hydrateDetailParams(
  connectorId: string,
  input: unknown,
  existing: ScrapedRecord[],
  dependsOn: string[] = [],
) {
  const params = { ...(input as Record<string, unknown>) };
  if (connectorId === "linkedin-profile") {
    const queries = Array.isArray(params.queries) ? params.queries.map(String) : [];
    if (queries.length === 0) {
      params.queries = extractLinkedInUrls(existing, "profile");
    }
  }
  if (connectorId === "linkedin-company") {
    const companies = Array.isArray(params.companies) ? params.companies.map(String) : [];
    if (companies.length === 0) {
      params.companies = extractLinkedInUrls(existing, "company");
    }
  }
  if (connectorId === "linkedin-profile-search") {
    const companies = Array.isArray(params.currentCompanies)
      ? params.currentCompanies.map(String).filter(Boolean)
      : [];
    const ycNames = ycCompanyNames(existing);
    // Prefer YC company titles when empty, or when this step depends on yc-companies.
    if (
      ycNames.length > 0 &&
      (companies.length === 0 || dependsOn.includes("yc-companies"))
    ) {
      params.currentCompanies = ycNames.slice(0, 15);
    }
    const titles = Array.isArray(params.currentJobTitles)
      ? params.currentJobTitles.map(String).filter(Boolean)
      : [];
    if (titles.length === 0) {
      params.currentJobTitles = ["Founder", "Co-Founder", "CEO"];
    }
  }
  return params;
}

function isRelevantOwnedSocialRecord(
  connectorId: string,
  input: unknown,
  record: ScrapedRecord,
) {
  if (!["youtube-content", "instagram-content"].includes(connectorId)) {
    return true;
  }
  const params = input as Record<string, unknown>;
  const explicitTargets =
    connectorId === "youtube-content"
      ? (params.startUrls as unknown[] | undefined)
      : (params.directUrls as unknown[] | undefined);
  if (explicitTargets?.length) return true;

  const query =
    connectorId === "youtube-content"
      ? firstTextValue((params.searchQueries as unknown[] | undefined)?.[0])
      : firstTextValue(params.search);
  const stop = new Set([
    "brand",
    "channel",
    "content",
    "official",
    "youtube",
    "instagram",
    "return",
    "exact",
    "matching",
    "creatives",
    "creative",
    "examples",
    "example",
    "best",
    "top",
    "five",
    "analyze",
    "analyse",
    "across",
    "find",
    "show",
    "list",
  ]);
  const terms = (query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(
    (term) => !stop.has(term),
  );
  // Prefer the first brand tokens only so instruction leftovers cannot wipe owned results.
  const brandTerms = terms.slice(0, 3);
  if (!brandTerms.length) return true;

  const candidate = [
    record.title,
    record.subtitle,
    record.raw.channelName,
    record.raw.channelTitle,
    record.raw.ownerUsername,
    record.raw.username,
  ]
    .map(firstTextValue)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  const matches = brandTerms.filter((term) => candidate.includes(term)).length;
  return matches >= Math.max(1, Math.ceil(brandTerms.length * 0.5));
}

function firstTextValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function brandHintFromQuery(query: {
  text: string;
  jobs?: Array<{ connectorId: string; input: unknown }>;
}) {
  for (const job of query.jobs ?? []) {
    if (job.connectorId === "youtube-content") {
      const input = job.input as Record<string, unknown>;
      const search = firstTextValue(
        (input.searchQueries as unknown[] | undefined)?.[0],
      );
      if (search) return search.replace(/\b(return|exact|matching|creatives?)\b/gi, " ").replace(/\s+/g, " ").trim();
    }
    if (job.connectorId === "instagram-content") {
      const input = job.input as Record<string, unknown>;
      const search = firstTextValue(input.search);
      if (search) return search.replace(/\b(return|exact|matching|creatives?)\b/gi, " ").replace(/\s+/g, " ").trim();
    }
  }
  return query.text
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(
      /\b(analy[sz]e|all|channels?|across|youtube|instagram|and|return|exact|matching|creatives?|examples?|identify|audience|archetypes?|content|direction|then|find|extract|best|five)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function ingestRecords(
  queryId: string,
  jobId: string,
  records: ScrapedRecord[],
) {
  for (const record of records) {
    const mergeKey = mergeKeyFor(record);
    const existing = await db.result.findUnique({
      where: { queryId_mergeKey: { queryId, mergeKey } },
    });
    const next = sanitizeForSqliteJson(
      existing
        ? mergeRecords(existing.data as ScrapedRecord, record)
        : record,
    );
    await db.result.upsert({
      where: { queryId_mergeKey: { queryId, mergeKey } },
      create: {
        queryId,
        jobId,
        sourceType: next.sourceType,
        externalId: next.externalId,
        mergeKey,
        data: next as unknown as Prisma.InputJsonValue,
      },
      update: {
        data: next as unknown as Prisma.InputJsonValue,
        sourceType: next.sourceType,
        externalId: next.externalId,
      },
    });
  }
}

async function ingestDataset(jobId: string) {
  const job = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      query: {
        include: {
          results: true,
          jobs: true,
        },
      },
    },
  });
  if (!job.apifyDatasetId) return;
  const connector = getConnector(job.connectorId);
  const apify = getApify();
  const pageSize = 100;
  let offset = 0;
  let total = 0;
  const records: ScrapedRecord[] = [];
  const ownedSignals =
    connector.id === "youtube-content-examples" ||
    connector.id === "instagram-content-examples"
      ? collectOwnedBrandSignals(
          job.query.results.map((row) => row.data as ScrapedRecord),
          brandHintFromQuery(job.query),
        )
      : [];
  do {
    const page = await apify.listDatasetItems(job.apifyDatasetId, {
      limit: pageSize,
      offset,
    });
    total = page.total;
    records.push(
      ...page.items
        .map((item) => connector.normalize(item))
        .filter((record) =>
          isRelevantOwnedSocialRecord(connector.id, job.input, record),
        )
        .filter(
          (record) =>
            ownedSignals.length === 0 ||
            !isOwnedBrandCreative(record, ownedSignals),
        ),
    );
    offset += page.items.length;
    if (page.items.length === 0) break;
  } while (offset < total);
  if (connector.id === "yc-companies") {
    const founders = records.flatMap((record) => expandYcFounders(record));
    records.push(...founders);
  }
  await ingestRecords(job.queryId, job.id, records);
  await db.job.update({
    where: { id: job.id },
    data: { itemCount: records.length },
  });
}

export async function syncQuery(queryId: string) {
  const query = await db.query.findUnique({
    where: { id: queryId },
    include: { jobs: { orderBy: { stepIndex: "asc" } }, results: true },
  });
  if (!query) {
    throw new AppError("NOT_FOUND", "Query not found.", 404);
  }

  const apify = getApify();
  let dirty = false;
  for (let round = 0; round < 6; round += 1) {
    const jobs = await db.job.findMany({ where: { queryId } });
    for (const job of jobs) {
      if (!job.apifyRunId || isTerminalJobStatus(job.status)) continue;
      const run = await apify.getRun(job.apifyRunId);
      const status = mapApifyStatus(run.status);
      if (status !== job.status) dirty = true;
      await db.job.update({
        where: { id: job.id },
        data: {
          status,
          apifyDatasetId: run.defaultDatasetId ?? job.apifyDatasetId,
          error: status === "failed" ? run.statusMessage ?? "Actor run failed" : job.error,
          finishedAt: isTerminalJobStatus(status) ? new Date() : null,
        },
      });
      if (status === "succeeded") {
        await ingestDataset(job.id);
        dirty = true;
      }
    }
    if (await kickReadyJobs(queryId)) dirty = true;
    const remaining = await db.job.count({
      where: { queryId, status: { in: ["queued", "running"] } },
    });
    if (remaining === 0) break;
  }

  const fresh = await db.query.findUniqueOrThrow({
    where: { id: queryId },
    include: { jobs: { orderBy: { stepIndex: "asc" } }, results: true },
  });
  const nextStatus = deriveQueryStatus(fresh.jobs.map((job) => job.status));
  if (
    nextStatus === "succeeded" &&
    !fresh.summary
  ) {
    const claim = await db.query.updateMany({
      where: { id: queryId, summary: null, synthesisStartedAt: null },
      data: { synthesisStartedAt: new Date(), status: nextStatus },
    });
    if (claim.count > 0) {
      dirty = true;
      try {
        const records = fresh.results.map((row) => row.data as ScrapedRecord);
        const ctx = { queryId, trigger: "auto" as const };
        const [brief, synthesis] = await Promise.all([
          generateBrief(fresh.text, records, ctx).catch(() => ""),
          scoreResults(fresh.text, records, ctx),
        ]);
        const summary =
          brief.length > 400 ? brief : synthesis.summary;
        for (const score of synthesis.scores) {
          const match = fresh.results.find(
            (row) => row.externalId === score.externalId,
          );
          if (match) {
            await db.result.update({
              where: { id: match.id },
              data: { score: score.score },
            });
          }
        }
        await db.query.update({
          where: { id: queryId },
          data: { summary, status: nextStatus },
        });
      } catch (error) {
        console.error("Result synthesis failed", error);
        await db.query.update({
          where: { id: queryId },
          data: { synthesisStartedAt: null, status: nextStatus },
        });
      }
    } else {
      if (nextStatus !== fresh.status) dirty = true;
      await db.query.update({
        where: { id: queryId },
        data: { status: nextStatus },
      });
    }
  } else {
    if (nextStatus !== fresh.status) dirty = true;
    await db.query.update({
      where: { id: queryId },
      data: { status: nextStatus },
    });
  }

  if (dirty) {
    await touchDataHash(LIST_HASH_KEY, detailHashKey(queryId));
  }

  return db.query.findUniqueOrThrow({
    where: { id: queryId },
    include: { jobs: { orderBy: { stepIndex: "asc" } }, results: { orderBy: { score: "desc" } } },
  });
}

export async function getQuery(queryId: string) {
  const query = await db.query.findUnique({
    where: { id: queryId },
    include: {
      jobs: { orderBy: { stepIndex: "asc" } },
      results: { orderBy: { score: "desc" } },
    },
  });
  if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
  return query;
}

export async function rerunQuery(queryId: string) {
  const query = await db.query.findUnique({ where: { id: queryId } });
  if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
  return createQueryFromPlan(query.text, query.plan as ScrapePlan);
}

export async function regenerateBrief(queryId: string) {
  const query = await db.query.findUnique({
    where: { id: queryId },
    include: { results: true, jobs: { orderBy: { stepIndex: "asc" } } },
  });
  if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
  if (!isTerminalQueryStatus(query.status)) {
    throw new AppError("BAD_REQUEST", "Run is still in progress.", 400);
  }
  if (query.results.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "No collected results to synthesize a brief from.",
      400,
    );
  }

  logClaude("regenerate_brief.start", {
    queryId,
    queryStatus: query.status,
    resultCount: query.results.length,
    hadSummary: Boolean(query.summary),
  });

  await db.query.update({
    where: { id: queryId },
    data: { summary: null, synthesisStartedAt: new Date() },
  });

  try {
    const records = query.results.map((row) => row.data as ScrapedRecord);
    const ctx = { queryId, trigger: "regenerate" as const };
    const [brief, synthesis] = await Promise.all([
      generateBrief(query.text, records, ctx).catch(() => ""),
      scoreResults(query.text, records, ctx),
    ]);
    const summary = brief.length > 400 ? brief : synthesis.summary;

    for (const score of synthesis.scores) {
      const match = query.results.find(
        (row) => row.externalId === score.externalId,
      );
      if (match) {
        await db.result.update({
          where: { id: match.id },
          data: { score: score.score },
        });
      }
    }

    await db.query.update({
      where: { id: queryId },
      data: { summary, synthesisStartedAt: null },
    });

    await touchDataHash(LIST_HASH_KEY, detailHashKey(queryId));

    logClaude("regenerate_brief.done", {
      queryId,
      summaryLength: summary.length,
      scoreCount: synthesis.scores.length,
      usedFallback: summary.includes("Claude synthesis was unavailable"),
      source: brief.length > 400 ? "stream" : "structured",
    });

    return getQuery(queryId);
  } catch (error) {
    logClaudeError("regenerate_brief.failed", error, { queryId });
    await db.query.update({
      where: { id: queryId },
      data: { synthesisStartedAt: null },
    });
    throw error;
  }
}

export async function retryFailedJobs(queryId: string) {
  const query = await db.query.findUnique({
    where: { id: queryId },
    include: { jobs: { orderBy: { stepIndex: "asc" } } },
  });
  if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
  if (!isTerminalQueryStatus(query.status)) {
    throw new AppError("BAD_REQUEST", "Run is still in progress.", 400);
  }

  const retryable = query.jobs.filter(
    (job) => job.status === "failed" || job.status === "timed_out",
  );
  if (!retryable.length) {
    throw new AppError("BAD_REQUEST", "No failed steps to retry.", 400);
  }

  const retryIds = retryable.map((job) => job.id);

  await db.result.deleteMany({
    where: { jobId: { in: retryIds } },
  });

  await db.job.updateMany({
    where: { id: { in: retryIds } },
    data: {
      status: "queued",
      apifyRunId: null,
      apifyDatasetId: null,
      error: null,
      finishedAt: null,
      itemCount: 0,
    },
  });

  await db.query.update({
    where: { id: queryId },
    data: {
      status: "running",
      summary: null,
      synthesisStartedAt: null,
    },
  });

  await touchDataHash(LIST_HASH_KEY, detailHashKey(queryId));
  await kickReadyJobs(queryId);
  return syncQuery(queryId);
}

export async function deleteQuery(queryId: string) {
  const query = await db.query.findUnique({
    where: { id: queryId },
    include: { jobs: true },
  });
  if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
  const apify = getApify();
  for (const job of query.jobs) {
    if (job.apifyRunId && isActiveJobStatus(job.status)) {
      await apify.abortRun(job.apifyRunId).catch(() => undefined);
    }
  }
  await db.query.delete({ where: { id: queryId } });
  await touchDataHash(LIST_HASH_KEY);
  await dropDataHash(detailHashKey(queryId));
  return { id: queryId };
}

export async function abortQuery(queryId: string) {
  const query = await db.query.findUnique({
    where: { id: queryId },
    include: { jobs: true },
  });
  if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
  const apify = getApify();
  for (const job of query.jobs) {
    if (!isActiveJobStatus(job.status)) continue;
    if (job.apifyRunId) {
      await apify.abortRun(job.apifyRunId);
    }
    await db.job.update({
      where: { id: job.id },
      data: { status: "aborted", finishedAt: new Date() },
    });
  }
  await db.query.update({
    where: { id: queryId },
    data: { status: "aborted" },
  });
  await touchDataHash(LIST_HASH_KEY, detailHashKey(queryId));
  return syncQuery(queryId);
}

export async function listQueries() {
  return db.query.findMany({
    orderBy: { createdAt: "desc" },
    include: { jobs: { orderBy: { stepIndex: "asc" } } },
    take: 30,
  });
}
