import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithHash,
  invalidateCache,
  postWithHash,
  readCache,
  writeCache,
} from "@/lib/client-cache";

type Json = Record<string, unknown>;

function jsonResponse(
  body: Json | string,
  init: { status?: number; hash?: string } = {},
) {
  const headers = new Headers();
  if (init.hash) headers.set("x-data-hash", init.hash);
  if (init.status === 304) {
    // 304 responses carry no body.
    return new Response(null, { status: 304, headers });
  }
  const payload =
    typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, { status: init.status ?? 200, headers });
}

const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal(
    "localStorage",
    {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  );
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalLocalStorage) {
    vi.stubGlobal("localStorage", originalLocalStorage);
  }
});

describe("cache read/write", () => {
  it("round-trips an entry and survives corrupt or missing storage", () => {
    writeCache<Json>("key", "h1", { ok: true });
    expect(readCache<Json>("key")).toMatchObject({ hash: "h1", data: { ok: true } });
    expect(readCache<Json>("missing")).toBeNull();

    globalThis.localStorage.setItem("atlas-cache:v1:bad", "{not json");
    expect(readCache<Json>("bad")).toBeNull();
  });

  it("invalidates specific keys", () => {
    writeCache<Json>("a", "h", {});
    writeCache<Json>("b", "h", {});
    invalidateCache("a");
    expect(readCache<Json>("a")).toBeNull();
    expect(readCache<Json>("b")).not.toBeNull();
  });
});

describe("fetchWithHash", () => {
  it("sends the cached hash and returns null on 304", async () => {
    writeCache<Json>("k", "h-old", {});
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 304 }));

    const result = await fetchWithHash<Json>("k", "https://app.test/api/query");
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.test/api/query?hash=h-old",
      { cache: "no-store" },
    );
  });

  it("fetches without a hash when nothing is cached", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [1] }, { hash: "h-new" }),
    );

    const result = await fetchWithHash<Json>("k2", "https://app.test/api/list");
    expect(result).toEqual({ data: { items: [1] }, hash: "h-new" });
    expect(fetchMock).toHaveBeenCalledWith("https://app.test/api/list", {
      cache: "no-store",
    });
    expect(readCache<Json>("k2")).toMatchObject({ hash: "h-new" });
  });

  it("prefers the body hash and appends the separator correctly for parameterized URLs", async () => {
    const fetchMock = vi.mocked(fetch);
    writeCache<Json>("k3", "h-old", {});
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ hash: "h-body", value: 1 }),
    );

    const result = await fetchWithHash<Json>("k3", "https://app.test/api/list?x=1");
    expect(result?.hash).toBe("h-body");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.test/api/list?x=1&hash=h-old",
      { cache: "no-store" },
    );
  });

  it("throws a deploy-friendly error when the server returns HTML", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse("<!DOCTYPE html><html></html>"),
    );
    await expect(
      fetchWithHash<Json>("k4", "https://app.test/"),
    ).rejects.toThrow(/Server returned HTML instead of JSON/);
  });

  it("throws on invalid JSON and on non-ok responses", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse("not json"));
    await expect(
      fetchWithHash<Json>("k5", "https://app.test/"),
    ).rejects.toThrow("Invalid JSON from server");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "Rate limited" }, { status: 429 }),
    );
    await expect(
      fetchWithHash<Json>("k5", "https://app.test/"),
    ).rejects.toThrow("Rate limited");
  });
});

describe("postWithHash", () => {
  it("sends x-known-hash and returns null when unchanged", async () => {
    writeCache<Json>("pk", "h-old", {});
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ unchanged: true }));

    const result = await postWithHash<Json>("pk", "https://app.test/api/poll");
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.test/api/poll",
      { method: "POST", headers: { "x-known-hash": "h-old" } },
    );
  });

  it("stores the body hash on changed payloads", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ hash: "h2", done: true }));

    const result = await postWithHash<Json>("pk2", "https://app.test/api/poll");
    expect(result).toEqual({ data: { hash: "h2", done: true }, hash: "h2" });
    expect(readCache<Json>("pk2")?.hash).toBe("h2");
  });
});
