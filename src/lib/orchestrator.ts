import { Prisma } from "@prisma/client";
import { db, dbProvider } from "@/lib/db";
import { getApify } from "@/lib/apify/client";
import { getConnector } from "@/lib/connectors/registry";
import { validatePlan } from "@/lib/ai/planner";
import { estimatePlanCost } from "@/lib/ai/cost";
import { generateBrief, scoreResults } from "@/lib/ai/synthesize";
import { logClaude, logClaudeError } from "@/lib/ai/claude-log";
import { extractLinkedInUrls, mergeKeyFor, mergeRecords } from "@/lib/resolve";
import {
  broadenYcCompaniesInput,
  enrichYcCompaniesInput,
  ycCompaniesInputFromJobInput,
  ycCompanyNames,
  withExpandedYcFounders,
  ycFounderExpandCompanyLimit,
  MIN_YC_COMPANIES_BEFORE_BROADEN,
  type YcCompaniesInput,
} from "@/lib/connectors/yc-companies";
import { orchestrateYcSearch } from "@/lib/ai/yc-search-orchestrator";
import type { ScrapePlan } from "@/lib/ai/plan-schema";
import { sanitizeForSqliteJson, type ScrapedRecord } from "@/lib/normalize";
import {
  deriveQueryStatus,
  isActiveJobStatus,
  isTerminalJobStatus,
  isTerminalQueryStatus,
  jobNeedsDatasetIngest,
  mapApifyStatus,
  reconcileQueryStatus,
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
import { clampMaxItems, isTestMode } from "@/lib/utils";
import type { CohesivityDb } from "@/lib/db/cohesivity-client";

function parseParams(connectorId: string, params: unknown) {
  return getConnector(connectorId).inputSchema.parse(params);
}

async function claimJobStart(jobId: string): Promise<boolean> {
  if (dbProvider === "cohesivity") {
    const claimed = await (
      db as unknown as CohesivityDb
    ).job.claimStart(jobId);
    return Boolean(claimed);
  }
  const result = await db.job.updateMany({
    where: {
      id: jobId,
      apifyRunId: null,
      status: { in: ["queued", "running"] },
    },
    data: { status: "running", error: null },
  });
  return result.count > 0;
}

export async function createQueryFromPlan(text: string, planInput: ScrapePlan) {
  const plan = validatePlan(planInput);
  // YC params must come from the AI tool orchestrator — never heuristic enrich
  // outside SCRAPER_TEST_MODE / vitest.
  for (const step of plan.steps) {
    if (step.connectorId !== "yc-companies") continue;
    if (step.params && (step.params as { _orchestrated?: boolean })._orchestrated) {
      continue;
    }
    if (isTestMode()) {
      step.params = {
        ...enrichYcCompaniesInput(step.params as YcCompaniesInput, text),
        _orchestrated: true,
      } as Record<string, unknown>;
      continue;
    }
    const orchestrated = await orchestrateYcSearch(
      text,
      step.params as YcCompaniesInput,
    );
    step.params = orchestrated.params as Record<string, unknown>;
    if (
      orchestrated.rationale &&
      !plan.interpretation.includes(orchestrated.rationale)
    ) {
      plan.interpretation = `${plan.interpretation}\n\nYC filters: ${orchestrated.rationale}`;
    }
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
  try {
    await kickReadyJobs(query.id);
  } catch (error) {
    console.error("kickReadyJobs after create failed", error);
  }
  const jobs = await db.job.findMany({
    where: { queryId: query.id },
    orderBy: { stepIndex: "asc" },
  });
  await db.query.update({
    where: { id: query.id },
    data: { status: deriveQueryStatus(jobs.map((job) => job.status)) },
  });
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
  const step = plan.steps?.[job.stepIndex];
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
  const step = plan.steps?.[job.stepIndex];
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
      // Queued, or claimed-but-never-started (running with no Apify run).
      const orphan = job.status === "running" && !job.apifyRunId;
      if (job.status !== "queued" && !orphan) continue;
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

/** Pick up every queued / orphaned job and start Apify for its query. */
export async function claimQueuedWork(limit = 20) {
  const queued = await db.job.findMany({
    where: { status: "queued" },
    orderBy: { stepIndex: "asc" },
  });
  const orphans = await db.job.findMany({
    where: { status: "running", apifyRunId: null },
    orderBy: { stepIndex: "asc" },
  });
  // Cap work before kickReadyJobs to stay under the ephemeral SQL budget.
  const queryIds = [
    ...new Set(
      [...queued, ...orphans]
        .map((job) => job.queryId)
        .filter(Boolean),
    ),
  ].slice(0, Math.max(1, Math.floor(limit)));
  let claimed = 0;
  for (const queryId of queryIds) {
    try {
      await db.query.update({
        where: { id: queryId },
        data: { status: "running" },
      });
      if (await kickReadyJobs(queryId)) claimed += 1;
    } catch (error) {
      console.error("claimQueuedWork failed", queryId, error);
    }
  }
  return { queryIds, claimed };
}

async function startJob(jobId: string): Promise<boolean> {
  const job = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { query: { include: { results: true, jobs: true } } },
  });
  if (job.apifyRunId) return false;
  if (job.status !== "queued" && job.status !== "running") return false;
  // Atomic claim — Cohesivity updateMany rowCount is unreliable; RETURNING is not.
  if (!(await claimJobStart(jobId))) return false;
  await db.query.update({
    where: { id: job.queryId },
    data: { status: "running" },
  });
  try {
  const connector = getConnector(job.connectorId);
  const plan = job.query.plan as ScrapePlan;
  const stepDependsOn = plan.steps?.[job.stepIndex]?.dependsOn ?? [];
  const existingResults = (job.query.results ?? []).map(
    (row) => row.data as ScrapedRecord,
  );
  let params = hydrateDetailParams(
    connector.id,
    job.input,
    existingResults,
    stepDependsOn,
  );
    let ycMeta: ReturnType<typeof ycCompaniesInputFromJobInput> | null = null;
    if (connector.id === "yc-companies") {
      const raw = params as Record<string, unknown>;
      const meta = ycCompaniesInputFromJobInput(raw);
      ycMeta = meta;
      // Broadened retries and already-orchestrated plans must not be re-polluted
      // from the raw user pitch.
      if (meta._broadenAttempt || raw._orchestrated || meta._orchestrated) {
        params = {
          query: meta.query,
          batch: meta.batch,
          batches: meta.batches,
          industry: meta.industry,
          tags: meta.tags,
          isHiring: meta.isHiring,
          maxItems: clampMaxItems(meta.maxItems, 100),
          _orchestrated: true,
          ...(meta._broadenAttempt
            ? { _broadenAttempt: meta._broadenAttempt, _notice: meta._notice }
            : {}),
        };
      } else if (isTestMode()) {
        params = {
          ...enrichYcCompaniesInput(meta, job.query.text),
          _orchestrated: true,
        } as Record<string, unknown>;
      } else {
        const orchestrated = await orchestrateYcSearch(
          job.query.text,
          meta,
        );
        params = orchestrated.params as Record<string, unknown>;
      }
      ycMeta = {
        ...ycCompaniesInputFromJobInput(params as Record<string, unknown>),
        _orchestrated: true,
        _broadenAttempt:
          typeof (params as Record<string, unknown>)._broadenAttempt === "number"
            ? ((params as Record<string, unknown>)._broadenAttempt as number)
            : meta._broadenAttempt,
        _notice:
          typeof (params as Record<string, unknown>)._notice === "string"
            ? ((params as Record<string, unknown>)._notice as string)
            : meta._notice,
      };
    }
    if (connector.id === "youtube-content-examples") {
      const examples = { ...(params as Record<string, unknown>) };
      const existingQueries = Array.isArray(examples.searchQueries)
        ? examples.searchQueries
        : [];
      if (existingQueries.length === 0) {
        examples.searchQueries = deriveContentExampleQueries(
          existingResults,
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
          existingResults,
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
    const platformMaxItems = Math.max(
      1,
      prepared.maxItems ??
        (typeof (prepared.input as Record<string, unknown>).maxResults === "number"
          ? ((prepared.input as Record<string, unknown>).maxResults as number)
          : 100),
    );
    const run = await getApify().startActor(
      prepared.actorId!,
      prepared.input,
      { maxItems: platformMaxItems },
    );
    const storedInput =
      connector.id === "yc-companies" && ycMeta
        ? {
            ...prepared.input,
            _orchestrated: true,
            ...(ycMeta._broadenAttempt != null
              ? {
                  _broadenAttempt: ycMeta._broadenAttempt,
                  _notice: ycMeta._notice,
                }
              : {}),
          }
        : prepared.input;
    const startedStatus = mapApifyStatus(run.status);
    await db.job.update({
      where: { id: job.id },
      data: {
        status: startedStatus,
        apifyRunId: run.id,
        apifyDatasetId: run.defaultDatasetId ?? null,
        input: storedInput as Prisma.InputJsonValue,
        finishedAt: isTerminalJobStatus(startedStatus) ? new Date() : null,
      },
    });
    if (startedStatus === "succeeded") {
      await ingestDataset(job.id);
    }
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

/** Fix jobs that ingested rows but never persisted itemCount (Cohesivity SQL budget/timeouts). */
export async function repairJobItemCounts(
  jobs: Array<{
    id: string;
    status: string;
    itemCount: number;
    input: unknown;
    finishedAt: Date | null;
  }>,
): Promise<boolean> {
  let dirty = false;
  for (const job of jobs) {
    if (job.status !== "succeeded" || job.itemCount > 0) continue;
    const counted = await db.result.count({ where: { jobId: job.id } });
    if (counted <= 0) continue;
    const priorInput = (job.input ?? {}) as Record<string, unknown>;
    await db.job.update({
      where: { id: job.id },
      data: {
        itemCount: counted,
        input: { ...priorInput, _ingested: true } as Prisma.InputJsonValue,
        finishedAt: job.finishedAt ?? new Date(),
      },
    });
    job.itemCount = counted;
    dirty = true;
  }
  return dirty;
}

export async function ingestRecords(
  queryId: string,
  jobId: string,
  records: ScrapedRecord[],
) {
  if (records.length === 0) return;

  const existingRows = await db.result.findMany({
    where: { queryId },
    select: { mergeKey: true, data: true },
  });
  const existingByKey = new Map<string, ScrapedRecord>(
    existingRows.map((row) => [row.mergeKey, row.data as ScrapedRecord]),
  );

  const mergedRows: Array<{
    queryId: string;
    jobId: string;
    sourceType: string;
    externalId: string;
    mergeKey: string;
    data: ScrapedRecord;
  }> = [];

  for (const record of records) {
    const mergeKey = mergeKeyFor(record);
    const existing = existingByKey.get(mergeKey);
    const next = sanitizeForSqliteJson(
      existing ? mergeRecords(existing, record) : record,
    );
    existingByKey.set(mergeKey, next);
    mergedRows.push({
      queryId,
      jobId,
      sourceType: next.sourceType,
      externalId: next.externalId,
      mergeKey,
      data: next,
    });
  }

  // Cohesivity ephemeral Postgres (~18 HTTP SQL/min): one batched upsert
  // instead of N per-row round-trips (100 companies would exhaust the budget alone).
  if (dbProvider === "cohesivity") {
    await (db as unknown as CohesivityDb).result.upsertMany(mergedRows);
    return;
  }

  const jobRow = await db.job.findUnique({
    where: { id: jobId },
    select: { input: true },
  });
  const priorInput = (jobRow?.input ?? {}) as Record<string, unknown>;
  const checkpointEvery = records.length + 1;

  for (let i = 0; i < mergedRows.length; i += 1) {
    const row = mergedRows[i];
    await db.result.upsert({
      where: { queryId_mergeKey: { queryId, mergeKey: row.mergeKey } },
      create: {
        queryId: row.queryId,
        jobId: row.jobId,
        sourceType: row.sourceType,
        externalId: row.externalId,
        mergeKey: row.mergeKey,
        data: row.data as unknown as Prisma.InputJsonValue,
      },
      update: {
        data: row.data as unknown as Prisma.InputJsonValue,
        sourceType: row.sourceType,
        externalId: row.externalId,
        jobId: row.jobId,
      },
    });

    if ((i + 1) % checkpointEvery === 0) {
      try {
        await db.job.update({
          where: { id: jobId },
          data: {
            itemCount: i + 1,
            input: {
              ...priorInput,
              _ingested: false,
            } as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        console.error("ingest checkpoint failed", jobId, error);
      }
    }
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
  const priorResults = (job.query.results ?? []).map(
    (row) => row.data as ScrapedRecord,
  );
  const ownedSignals =
    connector.id === "youtube-content-examples" ||
    connector.id === "instagram-content-examples"
      ? collectOwnedBrandSignals(
          priorResults,
          brandHintFromQuery(job.query),
        )
      : [];
  do {
    const page = await apify.listDatasetItems(job.apifyDatasetId, {
      limit: pageSize,
      offset,
    });
    const items = page.items ?? [];
    total = page.total ?? items.length;
    records.push(
      ...items
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
    offset += items.length;
    if (items.length === 0) break;
  } while (offset < total);
  if (connector.id === "yc-companies") {
    const companyCount = records.filter((record) => record.sourceType === "yc").length;
    // Broaden on sparse hits too — Education∩AI∩past-year often returns 1 company
    // and used to stop there because broaden only ran on zero.
    if (companyCount < MIN_YC_COMPANIES_BEFORE_BROADEN) {
      const current = ycCompaniesInputFromJobInput(
        (job.input ?? {}) as Record<string, unknown>,
      );
      const attempt = Number(current._broadenAttempt ?? 0);
      if (attempt < 4) {
        const queued = await queueYcBroadenRetry(job, current, attempt, {
          sparse: companyCount > 0,
          companyCount,
        });
        if (queued) return;
      }
    }
    // Cohesivity: expand founders for a capped company count (see
    // ycFounderExpandCompanyLimit). Batched upsertMany keeps SQL budget OK;
    // remaining founders stay nested on company.raw.founders.
    // Copy into a new array first: withExpandedYcFounders(records, 0) returns
    // the same reference, and `records.length = 0` would wipe companies before push.
    const next = withExpandedYcFounders(
      records,
      ycFounderExpandCompanyLimit(dbProvider),
    );
    const materialized = next === records ? records.slice() : next;
    records.length = 0;
    records.push(...materialized);
  }
  await ingestRecords(job.queryId, job.id, records);
  const priorInput = (job.input ?? {}) as Record<string, unknown>;
  // Only mark ingested when we actually have rows (or confirmed empty dataset).
  // Marking _ingested with itemCount=0 blocked retries after the cohesivity
  // founder-expand alias wipe.
  await db.job.update({
    where: { id: job.id },
    data: {
      itemCount: records.length,
      finishedAt: job.finishedAt ?? new Date(),
      input: {
        ...priorInput,
        _ingested: records.length > 0,
      } as Prisma.InputJsonValue,
    },
  });
}

async function queueYcBroadenRetry(
  job: {
    id: string;
    queryId: string;
    query: { text: string; interpretation: string };
  },
  current: YcCompaniesInput & { _broadenAttempt?: number; _notice?: string },
  attempt: number,
  options: { sparse?: boolean; companyCount?: number } = {},
): Promise<boolean> {
  const base: YcCompaniesInput = {
    query: current.query,
    batch: current.batch,
    batches: current.batches,
    industry: current.industry,
    tags: current.tags,
    isHiring: current.isHiring,
    maxItems: clampMaxItems(current.maxItems, 100),
  };

  let next: YcCompaniesInput | null = null;
  let notice = "";
  const sparse = Boolean(options.sparse);

  // Prefer a fast deterministic widen so empty/sparse runs recover without waiting on Claude.
  const deterministic = broadenYcCompaniesInput(base, { sparse });
  if (deterministic) {
    next = deterministic.input;
    notice = deterministic.notice;
    console.info("[yc] deterministic broaden", {
      attempt: attempt + 1,
      companyCount: options.companyCount ?? 0,
      sparse,
      from: base,
      to: next,
      notice,
    });
  } else if (!isTestMode()) {
    try {
      const broadened = await orchestrateYcSearch(job.query.text, base, {
        mode: "broaden",
        previousFilters: base,
      });
      const sameFilters =
        JSON.stringify({
          q: broadened.params.query ?? "",
          batch: broadened.params.batch ?? null,
          batches: broadened.params.batches ?? [],
          industry: broadened.params.industry ?? null,
          tags: broadened.params.tags ?? [],
          isHiring: Boolean(broadened.params.isHiring),
        }) ===
        JSON.stringify({
          q: base.query ?? "",
          batch: base.batch ?? null,
          batches: base.batches ?? [],
          industry: base.industry ?? null,
          tags: base.tags ?? [],
          isHiring: Boolean(base.isHiring),
        });
      if (!sameFilters) {
        next = broadened.params;
        notice =
          broadened.rationale ||
          (sparse
            ? `Previous YC filters only returned ${options.companyCount ?? 0} companies; AI broadened the search.`
            : "Previous YC filters returned no companies; AI broadened the search.");
        console.info("[yc] AI broaden", {
          attempt: attempt + 1,
          companyCount: options.companyCount ?? 0,
          to: next,
          notice,
        });
      }
    } catch (error) {
      console.error("YC AI broaden failed", error);
    }
  }

  if (!next) return false;

  // Drop stale rows from the previous empty/narrow attempt so Evidence
  // cannot show leftovers while the job reports 0 items.
  await db.result.deleteMany({ where: { jobId: job.id } });

  const nextInterpretation = job.query.interpretation.includes(notice)
    ? job.query.interpretation
    : `${job.query.interpretation}\n\n${notice}`;
  await db.query.update({
    where: { id: job.queryId },
    data: {
      interpretation: nextInterpretation,
      status: "running",
      summary: null,
      synthesisStartedAt: null,
    },
  });
  await db.job.update({
    where: { id: job.id },
    data: {
      status: "queued",
      apifyRunId: null,
      apifyDatasetId: null,
      itemCount: 0,
      finishedAt: null,
      error: null,
      input: {
        ...next,
        _orchestrated: true,
        _broadenAttempt: attempt + 1,
        _notice: notice,
        _ingested: false,
      } as Prisma.InputJsonValue,
    },
  });
  return true;
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
      if (!job.apifyRunId) continue;
      if (isTerminalJobStatus(job.status)) {
        // Fast Apify runs can finish inside startJob before the next sync poll.
        // Re-ingest any connector that succeeded with a dataset but never counted items.
        if (jobNeedsDatasetIngest(job)) {
          await ingestDataset(job.id);
          dirty = true;
        } else if (
          job.status === "succeeded" &&
          job.itemCount === 0
        ) {
          await repairJobItemCounts([job]);
          dirty = true;
        }
        continue;
      }
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
  if (await repairJobItemCounts(fresh.jobs)) dirty = true;

  const nextStatus = deriveQueryStatus(fresh.jobs.map((job) => job.status));
  if (nextStatus !== fresh.status) {
    await db.query.update({
      where: { id: queryId },
      data: { status: nextStatus },
    });
    dirty = true;
  }

  // Results are in DB first. Only then schedule brief persistence (async).
  // SSE / regenerate share the same persistQueryBrief writer.
  if (
    nextStatus === "succeeded" &&
    fresh.results.length > 0 &&
    !fresh.summary &&
    !fresh.synthesisStartedAt
  ) {
    scheduleQueryBrief(queryId);
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
  let query = await db.query.findUnique({
    where: { id: queryId },
    include: {
      jobs: { orderBy: { stepIndex: "asc" } },
      results: { orderBy: { score: "desc" } },
    },
  });
  if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);

  if (await repairJobItemCounts(query.jobs)) {
    query = await db.query.findUnique({
      where: { id: queryId },
      include: {
        jobs: { orderBy: { stepIndex: "asc" } },
        results: { orderBy: { score: "desc" } },
      },
    });
    if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
  }

  const status = reconcileQueryStatus(
    query.status,
    query.jobs.map((job) => job.status),
  );
  if (status === query.status) return query;
  // Persist the correction so list/history stop showing stale Queued forever.
  // Best-effort: a 429 here must not hide the already-loaded query.
  try {
    await db.query.update({
      where: { id: queryId },
      data: { status },
    });
  } catch (error) {
    console.error("getQuery status persist failed", queryId, error);
  }
  return { ...query, status };
}

export async function rerunQuery(queryId: string) {
  const query = await db.query.findUnique({ where: { id: queryId } });
  if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
  return createQueryFromPlan(query.text, query.plan as ScrapePlan);
}

export async function persistQueryBrief(
  queryId: string,
  options: {
    force?: boolean;
    onDelta?: (delta: string) => void;
    trigger?: "auto" | "regenerate" | "manual";
  } = {},
): Promise<{ summary: string; cached: boolean; scoresUpdated: number }> {
  const force = Boolean(options.force);
  const trigger = options.trigger ?? "auto";
  const onDelta = options.onDelta;

  const query = await db.query.findUnique({
    where: { id: queryId },
    include: { results: true, jobs: { orderBy: { stepIndex: "asc" } } },
  });
  if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);

  const status = reconcileQueryStatus(
    query.status,
    query.jobs.map((job) => job.status),
  );
  if (!isTerminalQueryStatus(status)) {
    throw new AppError("BAD_REQUEST", "Run is still in progress.", 400);
  }
  if (query.results.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      "No collected results to synthesize a brief from.",
      400,
    );
  }

  if (query.summary && !force) {
    return { summary: query.summary, cached: true, scoresUpdated: 0 };
  }

  if (force && query.summary) {
    await db.query.update({
      where: { id: queryId },
      data: { summary: null, synthesisStartedAt: null },
    });
  }

  // Another worker may already be writing the brief — wait for DB, don't race SSE.
  if (!force && query.synthesisStartedAt && !query.summary) {
    for (let i = 0; i < 45; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const latest = await db.query.findUnique({
        where: { id: queryId },
        select: { summary: true, synthesisStartedAt: true },
      });
      if (latest?.summary) {
        if (onDelta) onDelta(latest.summary);
        return { summary: latest.summary, cached: true, scoresUpdated: 0 };
      }
      if (!latest?.synthesisStartedAt) break;
    }
  }

  const claim = await db.query.updateMany({
    where: { id: queryId, summary: null, synthesisStartedAt: null },
    data: { synthesisStartedAt: new Date() },
  });
  if (claim.count === 0) {
    const latest = await db.query.findUnique({
      where: { id: queryId },
      select: { summary: true },
    });
    if (latest?.summary) {
      return { summary: latest.summary, cached: true, scoresUpdated: 0 };
    }
    throw new AppError(
      "BAD_REQUEST",
      "A brief is already being generated.",
      409,
    );
  }

  logClaude("persist_brief.start", {
    queryId,
    trigger,
    resultCount: query.results.length,
    force,
  });

  try {
    const records = query.results.map((row) => row.data as ScrapedRecord);
    const ctx = { queryId, trigger };
    const [brief, synthesis] = await Promise.all([
      generateBrief(query.text, records, ctx).catch(() => ""),
      scoreResults(query.text, records, ctx),
    ]);
    let summary = brief.length > 400 ? brief : synthesis.summary;
    if (!summary.trim()) {
      summary = synthesis.summary;
    }
    if (onDelta && summary) onDelta(summary);

    let scoresUpdated = 0;
    for (const score of synthesis.scores) {
      const match = query.results.find(
        (row) => row.externalId === score.externalId,
      );
      if (!match) continue;
      await db.result.update({
        where: { id: match.id },
        data: { score: score.score },
      });
      scoresUpdated += 1;
    }

    // DB write is the source of truth — always before returning to SSE/client.
    await db.query.update({
      where: { id: queryId },
      data: { summary, synthesisStartedAt: null },
    });
    await touchDataHash(LIST_HASH_KEY, detailHashKey(queryId));

    logClaude("persist_brief.done", {
      queryId,
      trigger,
      summaryLength: summary.length,
      scoresUpdated,
      source: brief.length > 400 ? "stream" : "structured",
    });

    return { summary, cached: false, scoresUpdated };
  } catch (error) {
    logClaudeError("persist_brief.failed", error, { queryId, trigger });
    await db.query.update({
      where: { id: queryId },
      data: { synthesisStartedAt: null },
    });
    throw error;
  }
}

/** Fire-and-forget brief after results are safely in DB. */
export function scheduleQueryBrief(queryId: string) {
  void persistQueryBrief(queryId, { trigger: "auto" }).catch((error) => {
    console.error("scheduleQueryBrief failed", queryId, error);
  });
}

export async function regenerateBrief(queryId: string) {
  await persistQueryBrief(queryId, { force: true, trigger: "regenerate" });
  return getQuery(queryId);
}

export async function retryFailedJobs(queryId: string) {
  const query = await db.query.findUnique({
    where: { id: queryId },
    include: { jobs: { orderBy: { stepIndex: "asc" } } },
  });
  if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
  const status = reconcileQueryStatus(
    query.status,
    query.jobs.map((job) => job.status),
  );
  if (!isTerminalQueryStatus(status)) {
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
  const queries = await db.query.findMany({
    orderBy: { createdAt: "desc" },
    include: { jobs: { orderBy: { stepIndex: "asc" } } },
    take: 30,
  });
  return queries.map((query) => {
    const status = reconcileQueryStatus(
      query.status,
      (query.jobs ?? []).map((job) => job.status),
    );
    return status === query.status ? query : { ...query, status };
  });
}
