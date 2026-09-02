import { describe, expect, it } from "vitest";
import { clampMaxItems } from "@/lib/utils";

describe("clampMaxItems", () => {
  it("always returns at least 1", () => {
    expect(clampMaxItems(0)).toBeGreaterThanOrEqual(1);
    expect(clampMaxItems(-1)).toBeGreaterThanOrEqual(1);
    expect(clampMaxItems(undefined)).toBeGreaterThanOrEqual(1);
    expect(clampMaxItems(null)).toBeGreaterThanOrEqual(1);
    expect(clampMaxItems("0")).toBeGreaterThanOrEqual(1);
  });

  it("uses fallback 100 for YC-style zero/missing", () => {
    expect(clampMaxItems(0, 100)).toBe(100);
    expect(clampMaxItems(undefined, 100)).toBe(100);
    expect(clampMaxItems(25, 100)).toBe(25);
  });

  it("never returns zero even if fallback is zero", () => {
    expect(clampMaxItems(0, 0)).toBeGreaterThanOrEqual(1);
  });
});
