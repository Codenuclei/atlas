import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

/**
 * Content hashes for conditional fetching. Clients send their last-known
 * hash; the server answers 304 / { unchanged: true } when nothing moved,
 * so polling and list refreshes transfer ~0 bytes in the steady state.
 */

type JobProjection = {
  id: string;
  status: string;
  itemCount: number;
  error: string | null;
};

type QueryProjection = {
  id: string;
  status: string;
  updatedAt: Date | string;
  summary?: string | null;
  progressiveBrief?: unknown;
  jobs?: JobProjection[];
  results?: Array<{ id: string; score: number | null }>;
};

function digest(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16);
}

export function hashQueryList(queries: QueryProjection[]): string {
  return digest(
    JSON.stringify(
      queries.map((query) => [
        query.id,
        query.status,
        query.updatedAt,
        (query.jobs ?? []).map((job) => [job.status, job.itemCount]),
      ]),
    ),
  );
}

export function hashQueryDetail(query: QueryProjection): string {
  return digest(
    JSON.stringify([
      query.id,
      query.status,
      query.updatedAt,
      query.summary?.length ?? 0,
      query.progressiveBrief
        ? JSON.stringify(query.progressiveBrief).length
        : 0,
      (query.jobs ?? []).map((job) => [job.id, job.status, job.itemCount, job.error]),
      (query.results ?? []).map((result) => [result.id, result.score]),
    ]),
  );
}

/** In-memory LRU with TTL — used for plan generation, keyed by prompt hash. */
export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();

  constructor(
    private ttlMs: number,
    private maxEntries = 50,
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // refresh recency
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
}

export function hashText(text: string): string {
  return digest(text.trim().toLowerCase());
}

/* ---------- DB-backed version pool ---------- */

export const LIST_HASH_KEY = "queries:list";

export function detailHashKey(queryId: string): string {
  return `query:${queryId}`;
}

/** One indexed lookup — the cheap path for unchanged checks. */
export async function readPooledHash(key: string): Promise<string | null> {
  const row = await db.dataHash.findUnique({ where: { key } });
  return row?.hash ?? null;
}

/** Store a freshly computed content hash (after a real fetch). */
export async function writePooledHash(key: string, hash: string): Promise<void> {
  await db.dataHash.upsert({
    where: { key },
    create: { key, hash },
    update: { hash },
  });
}

/**
 * Mark datasets as changed. Called only at real mutation points, so
 * steady-state polling never invalidates. A fresh random token is enough —
 * the pool is a version clock, not a content address.
 */
export async function touchDataHash(...keys: string[]): Promise<void> {
  const hash = randomBytes(8).toString("hex");
  await Promise.all(
    keys.map((key) =>
      db.dataHash.upsert({
        where: { key },
        create: { key, hash },
        update: { hash },
      }),
    ),
  );
}

export async function dropDataHash(...keys: string[]): Promise<void> {
  await db.dataHash.deleteMany({ where: { key: { in: keys } } });
}
