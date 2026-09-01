import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/synthesize", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/synthesize")>(
    "@/lib/ai/synthesize",
  );
  return {
    ...actual,
    generateBrief: vi.fn(async () => "COMPANIES BY INDUSTRY\n\nTest brief from persist."),
    scoreResults: vi.fn(async () => ({
      scores: [],
      summary: "COMPANIES BY INDUSTRY\n\nStructured fallback.",
    })),
  };
});

describe("persistQueryBrief contract", () => {
  it("exports scheduleQueryBrief and persistQueryBrief from orchestrator", async () => {
    const mod = await import("@/lib/orchestrator");
    expect(typeof mod.persistQueryBrief).toBe("function");
    expect(typeof mod.scheduleQueryBrief).toBe("function");
  });
});
