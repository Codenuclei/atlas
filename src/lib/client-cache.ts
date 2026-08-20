"use client";

/**
 * Stale-while-revalidate cache backed by localStorage, keyed per page.
 * Each entry stores the server-issued data hash; revalidation sends the
 * hash back and the server answers 304 / { unchanged: true } when nothing
 * changed, so steady-state polling moves almost no data.
 */

const PREFIX = "atlas-cache:v1:";

type Entry<T> = { hash: string; data: T; at: number };

export function readCache<T>(key: string): Entry<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as Entry<T>;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, hash: string, data: T): void {
  try {
    localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ hash, data, at: Date.now() } satisfies Entry<T>),
    );
  } catch {
    // storage full or private mode — caching is best-effort
  }
}

export function invalidateCache(...keys: string[]): void {
  try {
    for (const key of keys) localStorage.removeItem(PREFIX + key);
  } catch {
    // best-effort
  }
}

type Json = Record<string, unknown>;

/**
 * GET with conditional hash. Returns parsed body on 200, null on 304.
 * Automatically stores the hash for the next round trip.
 */
export async function fetchWithHash<T extends Json>(
  key: string,
  url: string,
): Promise<{ data: T; hash: string } | null> {
  const cached = readCache<T>(key);
  const separator = url.includes("?") ? "&" : "?";
  const response = await fetch(
    cached ? `${url}${separator}hash=${cached.hash}` : url,
    { cache: "no-store" },
  );
  if (response.status === 304 && cached) return null;
  const hash = response.headers.get("x-data-hash") ?? "";
  const body = (await response.json()) as T & { hash?: string };
  const effectiveHash = body.hash || hash;
  if (effectiveHash) writeCache(key, effectiveHash, body);
  return { data: body, hash: effectiveHash };
}

/**
 * POST with a known hash (used by run polling). Returns null when the
 * server reports the payload is unchanged.
 */
export async function postWithHash<T extends Json>(
  key: string,
  url: string,
): Promise<{ data: T; hash: string } | null> {
  const cached = readCache<T>(key);
  const response = await fetch(url, {
    method: "POST",
    headers: cached ? { "x-known-hash": cached.hash } : undefined,
  });
  const body = (await response.json()) as T & { hash?: string; unchanged?: boolean };
  if (body.unchanged) return null;
  const effectiveHash = body.hash || "";
  if (effectiveHash) writeCache(key, effectiveHash, body);
  return { data: body, hash: effectiveHash };
}
