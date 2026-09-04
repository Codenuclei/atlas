import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TtlCache,
  dropDataHash,
  hashQueryDetail,
  hashQueryList,
  hashText,
  readPooledHash,
  touchDataHash,
  writePooledHash,
} from "@/lib/data-hash";
import { db } from "@/lib/db";

function query(id: string, overrides: Partial<Parameters<typeof hashQueryList>[0][number]> = {}) {
  return {
    id,
    status: "succeeded",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(async () => {
  await db.dataHash.deleteMany({
    where: { key: { startsWith: "test:hash:" } },
  });
});

describe("hashText", () => {
  it("is stable across case and whitespace", () => {
    expect(hashText("  YC Fintech ")).toBe(hashText("yc fintech"));
    expect(hashText("" )).toBe(hashText(""));
  });
});

describe("hashQueryList", () => {
  it("is stable for identical projections", () => {
    expect(hashQueryList([query("a"), query("b")])).toBe(
      hashQueryList([query("a"), query("b")]),
    );
  });

  it("flips when job status or item counts change", () => {
    const before = hashQueryList([
      query("a", { jobs: [{ id: "j", status: "running", itemCount: 0, error: null }] }),
    ]);
    const after = hashQueryList([
      query("a", { jobs: [{ id: "j", status: "succeeded", itemCount: 7, error: null }] }),
    ]);
    expect(after).not.toBe(before);
  });

  it("ignores summary text on the list projection", () => {
    expect(hashQueryList([query("a", { summary: "long brief" })])).toBe(
      hashQueryList([query("a", { summary: null })]),
    );
  });
});

describe("hashQueryDetail", () => {
  it("flips when result scores change but not when untouched", () => {
    const base = query("a", {
      results: [{ id: "r1", score: 0.5 }],
      jobs: [{ id: "j", status: "succeeded", itemCount: 2, error: null }],
    });
    expect(hashQueryDetail(base)).toBe(hashQueryDetail({ ...base }));
    expect(
      hashQueryDetail({ ...base, results: [{ id: "r1", score: 0.9 }] }),
    ).not.toBe(hashQueryDetail(base));
  });

  it("flips when job error text changes so stale errors can be re-rendered", () => {
    const withError = query("a", {
      jobs: [{ id: "j", status: "failed", itemCount: 0, error: "Actor crashed" }],
    });
    expect(hashQueryDetail(withError)).not.toBe(
      hashQueryDetail({ ...withError, jobs: [{ id: "j", status: "failed", itemCount: 0, error: "Timeout" }] }),
    );
  });

  it("flips on summary presence", () => {
    expect(hashQueryDetail(query("a", { summary: "x" }))).not.toBe(
      hashQueryDetail(query("a", { summary: null })),
    );
  });
});

describe("TtlCache", () => {
  it("returns fresh entries and drops expired ones", () => {
    vi.useFakeTimers();
    try {
      const cache = new TtlCache<string>(1000);
      cache.set("k", "v");
      expect(cache.get("k")).toBe("v");
      vi.advanceTimersByTime(1001);
      expect(cache.get("k")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the least-recently-used entry beyond maxEntries", () => {
    const cache = new TtlCache<string>(60_000, 2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a"); // refresh recency
    cache.set("c", "3");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
  });
});

describe("db-backed hash pool", () => {
  it("round-trips write and read", async () => {
    await writePooledHash("test:hash:roundtrip", "abc123");
    expect(await readPooledHash("test:hash:roundtrip")).toBe("abc123");
    expect(await readPooledHash("test:hash:missing")).toBeNull();
  });

  it("touchDataHash rotates the version, dropDataHash deletes it", async () => {
    await touchDataHash("test:hash:rotate");
    const first = await readPooledHash("test:hash:rotate");
    await touchDataHash("test:hash:rotate");
    const second = await readPooledHash("test:hash:rotate");
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
    await dropDataHash("test:hash:rotate");
    expect(await readPooledHash("test:hash:rotate")).toBeNull();
  });
});
