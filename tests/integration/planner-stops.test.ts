import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/utils");
  vi.doUnmock("@/lib/ai/client");
});

async function loadPlannerWithStop(stopReason: string) {
  vi.resetModules();
  vi.doMock("@/lib/utils", async () => {
    const actual = await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
    return { ...actual, isTestMode: () => false };
  });
  vi.doMock("@/lib/ai/client", () => ({
    hasLiveAnthropicKey: () => true,
    getAnthropic: () => ({
      messages: {
        parse: async () => ({
          stop_reason: stopReason,
          parsed_output: null,
        }),
      },
    }),
    mapAnthropicError: (error: unknown) => {
      throw error;
    },
  }));
  return import("@/lib/ai/planner");
}

describe("planner stop reasons", () => {
  it("falls back safely when Claude refuses", async () => {
    const { createPlanWithSource } = await loadPlannerWithStop("refusal");
    const result = await createPlanWithSource("who is the CEO of Ramp");
    expect(result.source).toBe("heuristic");
    expect(result.plan.steps[0].connectorId).toBe("linkedin-profile-search");
  });

  it("falls back safely when Claude truncates output", async () => {
    const { createPlanWithSource } = await loadPlannerWithStop("max_tokens");
    const result = await createPlanWithSource("who is the CEO of Ramp");
    expect(result.source).toBe("heuristic");
  });
});
