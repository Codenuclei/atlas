import { createHash, randomBytes } from "node:crypto";
import { ensureCohesivitySchema } from "@/lib/cohesivity/ensure-schema";
import { pgBatch, pgQuery, type PgRow } from "@/lib/cohesivity/postgres";
import { AppError } from "@/lib/errors";

function newId() {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

function asJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseJson(value: unknown) {
  if (value == null) return value;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function asDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapQuery(row: PgRow) {
  return {
    id: String(row.id),
    text: String(row.text),
    interpretation: String(row.interpretation),
    plan: parseJson(row.plan),
    status: String(row.status),
    summary: row.summary == null ? null : String(row.summary),
    progressiveBrief: parseJson(row.progressiveBrief),
    synthesisStartedAt: asDate(row.synthesisStartedAt),
    costEstimateUsd: Number(row.costEstimateUsd),
    createdAt: asDate(row.createdAt) ?? new Date(0),
    updatedAt: asDate(row.updatedAt) ?? new Date(0),
  };
}

function mapJob(row: PgRow) {
  return {
    id: String(row.id),
    queryId: String(row.queryId),
    connectorId: String(row.connectorId),
    stepIndex: Number(row.stepIndex),
    status: String(row.status),
    input: parseJson(row.input),
    apifyRunId: row.apifyRunId == null ? null : String(row.apifyRunId),
    apifyDatasetId: row.apifyDatasetId == null ? null : String(row.apifyDatasetId),
    itemCount: Number(row.itemCount ?? 0),
    error: row.error == null ? null : String(row.error),
    startedAt: asDate(row.startedAt) ?? new Date(0),
    finishedAt: asDate(row.finishedAt),
  };
}

function mapResult(row: PgRow) {
  return {
    id: String(row.id),
    queryId: String(row.queryId),
    jobId: String(row.jobId),
    sourceType: String(row.sourceType),
    externalId: String(row.externalId),
    mergeKey: String(row.mergeKey),
    score: row.score == null ? null : Number(row.score),
    data: parseJson(row.data),
  };
}

function mapDataHash(row: PgRow) {
  return {
    key: String(row.key),
    hash: String(row.hash),
    updatedAt: asDate(row.updatedAt) ?? new Date(0),
  };
}

async function ready() {
  await ensureCohesivitySchema();
}

function notFound(model: string): never {
  throw new AppError("NOT_FOUND", `${model} not found.`, 404);
}

type IncludeJobs =
  | boolean
  | { orderBy?: { stepIndex?: "asc" | "desc" } };
type IncludeResults =
  | boolean
  | { orderBy?: { score?: "asc" | "desc" } };

type QueryInclude = {
  jobs?: IncludeJobs;
  results?: IncludeResults;
};

async function loadJobs(queryId: string, include?: IncludeJobs) {
  const order =
    typeof include === "object" && include.orderBy?.stepIndex === "desc"
      ? `"stepIndex" DESC`
      : `"stepIndex" ASC`;
  const result = await pgQuery(
    `SELECT * FROM "Job" WHERE "queryId" = $1 ORDER BY ${order}`,
    [queryId],
  );
  return result.rows.map(mapJob);
}

async function loadResults(queryId: string, include?: IncludeResults) {
  const order =
    typeof include === "object" && include.orderBy?.score === "asc"
      ? `"score" ASC NULLS LAST`
      : `"score" DESC NULLS LAST`;
  const result = await pgQuery(
    `SELECT * FROM "Result" WHERE "queryId" = $1 ORDER BY ${order}`,
    [queryId],
  );
  return result.rows.map(mapResult);
}

async function withQueryIncludes<T extends ReturnType<typeof mapQuery>>(
  query: T,
  include?: QueryInclude,
) {
  if (!include) return query;
  const out: T & { jobs?: ReturnType<typeof mapJob>[]; results?: ReturnType<typeof mapResult>[] } =
    { ...query };
  if (include.jobs) out.jobs = await loadJobs(query.id, include.jobs);
  if (include.results) out.results = await loadResults(query.id, include.results);
  return out;
}

function buildSetClause(
  data: Record<string, unknown>,
  startIndex = 1,
): { sql: string; params: unknown[]; nextIndex: number } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let index = startIndex;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (key === "plan" || key === "input" || key === "data" || key === "progressiveBrief") {
      parts.push(`"${key}" = $${index}::jsonb`);
      params.push(asJson(value));
    } else if (value instanceof Date) {
      parts.push(`"${key}" = $${index}`);
      params.push(value.toISOString());
    } else {
      parts.push(`"${key}" = $${index}`);
      params.push(value);
    }
    index += 1;
  }
  return { sql: parts.join(", "), params, nextIndex: index };
}

function buildWhere(
  where: Record<string, unknown>,
  startIndex = 1,
): { sql: string; params: unknown[]; nextIndex: number } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let index = startIndex;

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (key === "queryId_mergeKey" && value && typeof value === "object") {
      const compound = value as { queryId: string; mergeKey: string };
      parts.push(`"queryId" = $${index}`);
      params.push(compound.queryId);
      index += 1;
      parts.push(`"mergeKey" = $${index}`);
      params.push(compound.mergeKey);
      index += 1;
      continue;
    }
    if (value === null) {
      parts.push(`"${key}" IS NULL`);
      continue;
    }
    if (value && typeof value === "object" && "in" in (value as object)) {
      const list = (value as { in: unknown[] }).in;
      if (!list.length) {
        parts.push("FALSE");
        continue;
      }
      const placeholders = list.map(() => {
        const placeholder = `$${index}`;
        index += 1;
        return placeholder;
      });
      params.push(...list);
      parts.push(`"${key}" IN (${placeholders.join(", ")})`);
      continue;
    }
    parts.push(`"${key}" = $${index}`);
    params.push(value);
    index += 1;
  }

  return {
    sql: parts.length ? parts.join(" AND ") : "TRUE",
    params,
    nextIndex: index,
  };
}

export function createCohesivityDb() {
  const queryApi = {
    async create(args: {
      data: Record<string, unknown> & {
        jobs?: { create: Array<Record<string, unknown>> };
      };
      include?: QueryInclude;
    }) {
      await ready();
      const id = String(args.data.id ?? newId());
      const now = new Date().toISOString();
      const jobs = args.data.jobs?.create ?? [];
      const statements = [
        {
          query: `INSERT INTO "Query" (
            "id","text","interpretation","plan","status","summary","progressiveBrief","synthesisStartedAt","costEstimateUsd","createdAt","updatedAt"
          ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
          params: [
            id,
            args.data.text,
            args.data.interpretation,
            asJson(args.data.plan),
            args.data.status,
            args.data.summary ?? null,
            asJson(args.data.progressiveBrief ?? null),
            args.data.synthesisStartedAt
              ? new Date(String(args.data.synthesisStartedAt)).toISOString()
              : null,
            args.data.costEstimateUsd,
            now,
            now,
          ],
        },
        ...jobs.map((job, stepIndex) => ({
          query: `INSERT INTO "Job" (
            "id","queryId","connectorId","stepIndex","status","input","apifyRunId","apifyDatasetId","itemCount","error","startedAt","finishedAt"
          ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12)`,
          params: [
            String(job.id ?? newId()),
            id,
            job.connectorId,
            job.stepIndex ?? stepIndex,
            job.status ?? "queued",
            asJson(job.input ?? {}),
            job.apifyRunId ?? null,
            job.apifyDatasetId ?? null,
            job.itemCount ?? 0,
            job.error ?? null,
            now,
            job.finishedAt
              ? new Date(String(job.finishedAt)).toISOString()
              : null,
          ],
        })),
      ];
      await pgBatch(statements);
      const created = await queryApi.findUnique({ where: { id }, include: args.include });
      if (!created) notFound("Query");
      return created;
    },

    async findUnique(args: { where: Record<string, unknown>; include?: QueryInclude }) {
      await ready();
      const where = buildWhere(args.where);
      const result = await pgQuery(
        `SELECT * FROM "Query" WHERE ${where.sql} LIMIT 1`,
        where.params,
      );
      if (!result.rows[0]) return null;
      return withQueryIncludes(mapQuery(result.rows[0]), args.include);
    },

    async findUniqueOrThrow(args: {
      where: Record<string, unknown>;
      include?: QueryInclude;
    }) {
      const row = await queryApi.findUnique(args);
      if (!row) notFound("Query");
      return row;
    },

    async findMany(args: {
      orderBy?: { createdAt?: "asc" | "desc" };
      include?: QueryInclude;
      take?: number;
    } = {}) {
      await ready();
      const order =
        args.orderBy?.createdAt === "asc" ? `"createdAt" ASC` : `"createdAt" DESC`;
      const take = args.take && args.take > 0 ? Math.floor(args.take) : undefined;
      const result = await pgQuery(
        `SELECT * FROM "Query" ORDER BY ${order}${take ? ` LIMIT ${take}` : ""}`,
      );
      const mapped = result.rows.map(mapQuery);
      if (!args.include?.jobs && !args.include?.results) return mapped;
      // One jobs fetch for the page instead of N+1 (avoids Cohesivity 30 req/min cap).
      const ids = mapped.map((row) => row.id);
      const jobsByQuery = new Map<string, ReturnType<typeof mapJob>[]>();
      if (args.include.jobs && ids.length) {
        const order =
          typeof args.include.jobs === "object" &&
          args.include.jobs.orderBy?.stepIndex === "desc"
            ? `"stepIndex" DESC`
            : `"stepIndex" ASC`;
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
        const jobRows = await pgQuery(
          `SELECT * FROM "Job" WHERE "queryId" IN (${placeholders}) ORDER BY ${order}`,
          ids,
        );
        for (const job of jobRows.rows.map(mapJob)) {
          const list = jobsByQuery.get(job.queryId) ?? [];
          list.push(job);
          jobsByQuery.set(job.queryId, list);
        }
      }
      const resultsByQuery = new Map<string, ReturnType<typeof mapResult>[]>();
      if (args.include?.results && ids.length) {
        const order =
          typeof args.include.results === "object" &&
          args.include.results.orderBy?.score === "asc"
            ? `"score" ASC NULLS LAST`
            : `"score" DESC NULLS LAST`;
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
        const resultRows = await pgQuery(
          `SELECT * FROM "Result" WHERE "queryId" IN (${placeholders}) ORDER BY ${order}`,
          ids,
        );
        for (const row of resultRows.rows.map(mapResult)) {
          const list = resultsByQuery.get(row.queryId) ?? [];
          list.push(row);
          resultsByQuery.set(row.queryId, list);
        }
      }
      return mapped.map((row) => ({
        ...row,
        ...(args.include?.jobs
          ? { jobs: jobsByQuery.get(row.id) ?? [] }
          : {}),
        ...(args.include?.results
          ? { results: resultsByQuery.get(row.id) ?? [] }
          : {}),
      }));
    },

    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      await ready();
      const data = { ...args.data, updatedAt: new Date() };
      const set = buildSetClause(data);
      if (!set.sql) {
        return queryApi.findUniqueOrThrow({ where: args.where });
      }
      const result = await pgQuery(
        `UPDATE "Query" SET ${set.sql} WHERE "id" = $${set.nextIndex} RETURNING *`,
        [...set.params, args.where.id],
      );
      if (!result.rows[0]) notFound("Query");
      return mapQuery(result.rows[0]);
    },

    async updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) {
      await ready();
      const data = { ...args.data, updatedAt: new Date() };
      const set = buildSetClause(data);
      const where = buildWhere(args.where, set.nextIndex);
      const result = await pgQuery(
        `UPDATE "Query" SET ${set.sql} WHERE ${where.sql} RETURNING "id"`,
        [...set.params, ...where.params],
      );
      return { count: result.rows.length || result.rowCount };
    },

    async delete(args: { where: { id: string } }) {
      await ready();
      const existing = await queryApi.findUnique({ where: args.where });
      if (!existing) notFound("Query");
      await pgQuery(`DELETE FROM "Query" WHERE "id" = $1`, [args.where.id]);
      return existing;
    },

    async deleteMany() {
      await ready();
      const result = await pgQuery(`DELETE FROM "Query"`);
      return { count: result.rowCount };
    },
  };

  const jobApi = {
    async findMany(args: {
      where?: Record<string, unknown>;
      orderBy?: { stepIndex?: "asc" | "desc" };
    } = {}) {
      await ready();
      const where = buildWhere(args.where ?? {});
      const order =
        args.orderBy?.stepIndex === "desc" ? `"stepIndex" DESC` : `"stepIndex" ASC`;
      const result = await pgQuery(
        `SELECT * FROM "Job" WHERE ${where.sql} ORDER BY ${order}`,
        where.params,
      );
      return result.rows.map(mapJob);
    },

    async findUniqueOrThrow(args: {
      where: { id: string };
      include?: {
        query?: boolean | { include?: { results?: boolean; jobs?: boolean } };
      };
    }) {
      await ready();
      const result = await pgQuery(`SELECT * FROM "Job" WHERE "id" = $1 LIMIT 1`, [
        args.where.id,
      ]);
      if (!result.rows[0]) notFound("Job");
      const job = mapJob(result.rows[0]);
      if (!args.include?.query) return job;
      const queryInclude =
        typeof args.include.query === "object" ? args.include.query.include : undefined;
      const query = await queryApi.findUniqueOrThrow({
        where: { id: job.queryId },
        include: {
          jobs: queryInclude?.jobs
            ? { orderBy: { stepIndex: "asc" } }
            : undefined,
          results: queryInclude?.results ? true : undefined,
        },
      });
      return { ...job, query };
    },

    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      await ready();
      const set = buildSetClause(args.data);
      if (!set.sql) {
        const current = await pgQuery(`SELECT * FROM "Job" WHERE "id" = $1`, [
          args.where.id,
        ]);
        if (!current.rows[0]) notFound("Job");
        return mapJob(current.rows[0]);
      }
      const result = await pgQuery(
        `UPDATE "Job" SET ${set.sql} WHERE "id" = $${set.nextIndex} RETURNING *`,
        [...set.params, args.where.id],
      );
      if (!result.rows[0]) notFound("Job");
      return mapJob(result.rows[0]);
    },

    /**
     * Atomic start claim: only one worker can take a queued/orphan job.
     * Uses UPDATE … RETURNING so Cohesivity rowCount quirks cannot double-start Apify.
     */
    async claimStart(id: string) {
      await ready();
      const result = await pgQuery(
        `UPDATE "Job"
         SET "status" = 'running', "error" = NULL
         WHERE "id" = $1
           AND "apifyRunId" IS NULL
           AND "status" IN ('queued', 'running')
         RETURNING *`,
        [id],
      );
      return result.rows[0] ? mapJob(result.rows[0]) : null;
    },

    async updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) {
      await ready();
      const set = buildSetClause(args.data);
      const where = buildWhere(args.where, set.nextIndex);
      const result = await pgQuery(
        `UPDATE "Job" SET ${set.sql} WHERE ${where.sql} RETURNING "id"`,
        [...set.params, ...where.params],
      );
      return { count: result.rows.length || result.rowCount };
    },

    async count(args: { where?: Record<string, unknown> } = {}) {
      await ready();
      const where = buildWhere(args.where ?? {});
      const result = await pgQuery(
        `SELECT COUNT(*)::int AS count FROM "Job" WHERE ${where.sql}`,
        where.params,
      );
      return Number(result.rows[0]?.count ?? 0);
    },

    async deleteMany() {
      await ready();
      const result = await pgQuery(`DELETE FROM "Job"`);
      return { count: result.rowCount };
    },
  };

  const resultApi = {
    async findUnique(args: { where: Record<string, unknown> }) {
      await ready();
      const where = buildWhere(args.where);
      const result = await pgQuery(
        `SELECT * FROM "Result" WHERE ${where.sql} LIMIT 1`,
        where.params,
      );
      return result.rows[0] ? mapResult(result.rows[0]) : null;
    },

    async findMany(args: {
      where?: Record<string, unknown>;
      select?: Record<string, boolean>;
    } = {}) {
      await ready();
      const where = buildWhere(args.where ?? {});
      const result = await pgQuery(
        `SELECT * FROM "Result" WHERE ${where.sql}`,
        where.params,
      );
      const mapped = result.rows.map(mapResult);
      if (!args.select) return mapped;
      return mapped.map((row) => {
        const out: Record<string, unknown> = {};
        for (const [key, on] of Object.entries(args.select!)) {
          if (!on) continue;
          if (key in row) out[key] = row[key as keyof typeof row];
        }
        return out;
      });
    },

    async upsert(args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) {
      await ready();
      // One HTTP SQL round-trip per row — prefer upsertMany for bulk ingest.
      const id = String(args.create.id ?? newId());
      const result = await pgQuery(
        `INSERT INTO "Result" (
          "id","queryId","jobId","sourceType","externalId","mergeKey","score","data"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
        ON CONFLICT ("queryId", "mergeKey") DO UPDATE SET
          "jobId" = EXCLUDED."jobId",
          "sourceType" = EXCLUDED."sourceType",
          "externalId" = EXCLUDED."externalId",
          "score" = COALESCE(EXCLUDED."score", "Result"."score"),
          "data" = EXCLUDED."data"
        RETURNING *`,
        [
          id,
          args.create.queryId,
          args.create.jobId,
          args.create.sourceType,
          args.create.externalId,
          args.create.mergeKey,
          args.create.score ?? null,
          asJson(args.create.data),
        ],
      );
      if (!result.rows[0]) notFound("Result");
      return mapResult(result.rows[0]);
    },

    /**
     * Multi-row INSERT … ON CONFLICT in one (or few) HTTP SQL calls.
     * Chunks stay under payload limits; pgBatch uses a single rate-limit token.
     */
    async upsertMany(
      rows: Array<{
        queryId: string;
        jobId: string;
        sourceType: string;
        externalId: string;
        mergeKey: string;
        score?: number | null;
        data: unknown;
        id?: string;
      }>,
    ) {
      await ready();
      if (!rows.length) return { count: 0 };
      const CHUNK = 40;
      const statements: Array<{ query: string; params: unknown[] }> = [];
      for (let offset = 0; offset < rows.length; offset += CHUNK) {
        const chunk = rows.slice(offset, offset + CHUNK);
        const values: string[] = [];
        const params: unknown[] = [];
        let index = 1;
        for (const row of chunk) {
          values.push(
            `($${index},$${index + 1},$${index + 2},$${index + 3},$${index + 4},$${index + 5},$${index + 6},$${index + 7}::jsonb)`,
          );
          params.push(
            String(row.id ?? newId()),
            row.queryId,
            row.jobId,
            row.sourceType,
            row.externalId,
            row.mergeKey,
            row.score ?? null,
            asJson(row.data),
          );
          index += 8;
        }
        statements.push({
          query: `INSERT INTO "Result" (
            "id","queryId","jobId","sourceType","externalId","mergeKey","score","data"
          ) VALUES ${values.join(", ")}
          ON CONFLICT ("queryId", "mergeKey") DO UPDATE SET
            "jobId" = EXCLUDED."jobId",
            "sourceType" = EXCLUDED."sourceType",
            "externalId" = EXCLUDED."externalId",
            "score" = COALESCE(EXCLUDED."score", "Result"."score"),
            "data" = EXCLUDED."data"`,
          params,
        });
      }
      await pgBatch(statements);
      return { count: rows.length };
    },

    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      await ready();
      const set = buildSetClause(args.data);
      const result = await pgQuery(
        `UPDATE "Result" SET ${set.sql} WHERE "id" = $${set.nextIndex} RETURNING *`,
        [...set.params, args.where.id],
      );
      if (!result.rows[0]) notFound("Result");
      return mapResult(result.rows[0]);
    },

    async deleteMany(args: { where?: Record<string, unknown> } = {}) {
      await ready();
      const where = buildWhere(args.where ?? {});
      const result = await pgQuery(
        `DELETE FROM "Result" WHERE ${where.sql}`,
        where.params,
      );
      return { count: result.rowCount };
    },

    async count(args: { where?: Record<string, unknown> } = {}) {
      await ready();
      const where = buildWhere(args.where ?? {});
      const result = await pgQuery(
        `SELECT COUNT(*)::int AS count FROM "Result" WHERE ${where.sql}`,
        where.params,
      );
      return Number(result.rows[0]?.count ?? 0);
    },
  };

  const dataHashApi = {
    async findUnique(args: { where: { key: string } }) {
      await ready();
      const result = await pgQuery(
        `SELECT * FROM "DataHash" WHERE "key" = $1 LIMIT 1`,
        [args.where.key],
      );
      return result.rows[0] ? mapDataHash(result.rows[0]) : null;
    },

    async upsert(args: {
      where: { key: string };
      create: { key: string; hash: string };
      update: { hash: string };
    }) {
      await ready();
      const now = new Date().toISOString();
      const result = await pgQuery(
        `INSERT INTO "DataHash" ("key","hash","updatedAt")
         VALUES ($1,$2,$3)
         ON CONFLICT ("key") DO UPDATE SET "hash" = EXCLUDED."hash", "updatedAt" = EXCLUDED."updatedAt"
         RETURNING *`,
        [args.create.key, args.update.hash ?? args.create.hash, now],
      );
      return mapDataHash(result.rows[0]);
    },

    async deleteMany(args: { where: { key: { in: string[] } } }) {
      await ready();
      const keys = args.where.key.in;
      if (!keys.length) return { count: 0 };
      const where = buildWhere({ key: { in: keys } });
      const result = await pgQuery(
        `DELETE FROM "DataHash" WHERE ${where.sql}`,
        where.params,
      );
      return { count: result.rowCount };
    },
  };

  return {
    query: queryApi,
    job: jobApi,
    result: resultApi,
    dataHash: dataHashApi,
    /** Used only to satisfy occasional Prisma typing casts. */
    $fingerprint: createHash("sha1").update("cohesivity-postgres").digest("hex"),
  };
}

export type CohesivityDb = ReturnType<typeof createCohesivityDb>;
