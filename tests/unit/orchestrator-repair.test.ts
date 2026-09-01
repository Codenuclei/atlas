import { describe, expect, it } from "vitest";
import { repairJobItemCounts } from "@/lib/orchestrator";

describe("repairJobItemCounts", () => {
  it("is exported for drift repair on read/sync", () => {
    expect(typeof repairJobItemCounts).toBe("function");
  });
});
