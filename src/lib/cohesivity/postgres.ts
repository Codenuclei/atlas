import { AppError } from "@/lib/errors";

const EDGE_URL = "https://cohesivity.ai/edge/postgres";
const USER_AGENT = "AtlasResearch/1.0 (server)";

export type PgRow = Record<string, unknown>;

export type PgQueryResult = {
  rows: PgRow[];
  rowCount: number;
  truncated?: boolean;
};

function applicationKey(): string {
  const key =
    process.env.COH_APPLICATION_KEY?.trim() ||
    process.env.COHESIVITY_APPLICATION_KEY?.trim() ||
    "";
  if (!key) {
    throw new AppError(
      "UNAUTHORIZED",
      "COH_APPLICATION_KEY is required to use Cohesivity Postgres.",
      401,
    );
  }
  return key;
}

export function usesCohesivityPostgres() {
  if (process.env.SCRAPER_TEST_MODE === "1" || process.env.NODE_ENV === "test") {
    return false;
  }
  if (process.env.DATABASE_PROVIDER === "sqlite") return false;
  if (process.env.DATABASE_PROVIDER === "cohesivity") return true;
  return Boolean(
    process.env.COH_APPLICATION_KEY?.trim() ||
      process.env.COHESIVITY_APPLICATION_KEY?.trim(),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Stay under Cohesivity ephemeral Postgres (~30 HTTP SQL calls / minute). */
let sqlTokens = 18;
let sqlWindowStart = Date.now();

async function acquireSqlSlot() {
  const now = Date.now();
  if (now - sqlWindowStart >= 60_000) {
    sqlTokens = 18;
    sqlWindowStart = now;
  }
  if (sqlTokens <= 0) {
    const wait = 60_000 - (now - sqlWindowStart) + 50;
    await sleep(Math.min(wait, 15_000));
    sqlTokens = 18;
    sqlWindowStart = Date.now();
  }
  sqlTokens -= 1;
}

async function postEdge(body: unknown, attempt = 0): Promise<unknown> {
  await acquireSqlSlot();
  const key = applicationKey();
  const response = await fetch(`${EDGE_URL}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if ((response.status === 429 || response.status === 503) && attempt < 4) {
    const wait = Math.min(8000, 400 * 2 ** attempt);
    await sleep(wait);
    return postEdge(body, attempt + 1);
  }
  if (!response.ok) {
    const message =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `Cohesivity Postgres error (${response.status})`;
    throw new AppError("UPSTREAM", message, response.status >= 400 ? response.status : 502, {
      body: parsed,
    });
  }
  return parsed;
}

export async function pgQuery(
  query: string,
  params: unknown[] = [],
): Promise<PgQueryResult> {
  const result = (await postEdge({ query, params })) as PgQueryResult;
  return {
    rows: Array.isArray(result.rows) ? result.rows : [],
    rowCount: typeof result.rowCount === "number" ? result.rowCount : 0,
    truncated: Boolean(result.truncated),
  };
}

export async function pgBatch(
  statements: Array<{ query: string; params?: unknown[] }>,
): Promise<PgQueryResult[]> {
  if (statements.length === 0) return [];
  if (statements.length === 1) {
    return [await pgQuery(statements[0].query, statements[0].params ?? [])];
  }
  const result = (await postEdge({
    statements: statements.map((statement) => ({
      query: statement.query,
      params: statement.params ?? [],
    })),
  })) as { results?: PgQueryResult[] };
  const results = Array.isArray(result.results) ? result.results : [];
  return results.map((item) => ({
    rows: Array.isArray(item.rows) ? item.rows : [],
    rowCount: typeof item.rowCount === "number" ? item.rowCount : 0,
    truncated: Boolean(item.truncated),
  }));
}
