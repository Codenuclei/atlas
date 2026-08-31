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

async function readJsonBody<T extends Json>(
  response: Response,
): Promise<T & { hash?: string; error?: string; message?: string; unchanged?: boolean }> {
  const text = await response.text();
  if (!text) {
    return {} as T & { hash?: string; error?: string; message?: string };
  }
  try {
    return JSON.parse(text) as T & {
      hash?: string;
      error?: string;
      message?: string;
      unchanged?: boolean;
    };
  } catch {
    const looksHtml = /^\s*</.test(text) || text.includes("<!DOCTYPE");
    throw new Error(
      looksHtml
        ? `Server returned HTML instead of JSON (${response.status}). The app may be redeploying — retry in a moment.`
        : `Invalid JSON from server (${response.status}).`,
    );
  }
}

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
  const body = await readJsonBody<T>(response);
  if (!response.ok) {
    throw new Error(body.message || body.error || `Request failed (${response.status})`);
  }
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
  const body = await readJsonBody<T>(response);
  if (!response.ok) {
    throw new Error(body.message || body.error || `Request failed (${response.status})`);
  }
  if (body.unchanged) return null;
  const effectiveHash = body.hash || "";
  if (effectiveHash) writeCache(key, effectiveHash, body);
  return { data: body, hash: effectiveHash };
}
