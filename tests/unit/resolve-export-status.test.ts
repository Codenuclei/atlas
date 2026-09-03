import { describe, expect, it } from "vitest";
import { dedupeRecords, mergeKeyFor, mergeRecords } from "@/lib/resolve";
import { recordsToCsv } from "@/lib/export";
import {
  mapApifyStatus,
  deriveQueryStatus,
  reconcileQueryStatus,
} from "@/lib/status";
import { defaultWorkspaceTab } from "@/lib/view-model";
import type { ScrapedRecord } from "@/lib/normalize";

const ada: ScrapedRecord = {
  sourceType: "profile",
  externalId: "1",
  title: "Ada Lovelace",
  subtitle: "Founder",
  url: "https://www.linkedin.com/in/ada-lovelace",
  location: "SF",
  imageUrl: "",
  raw: { a: 1 },
};

const adaAgain: ScrapedRecord = {
  ...ada,
  externalId: "2",
  subtitle: "Founder & CEO at Analytical Engines",
  raw: { b: 2 },
};

describe("dedupe and merge", () => {
  it("uses the LinkedIn slug as a merge key", () => {
    expect(mergeKeyFor(ada)).toBe("profile:ada-lovelace");
  });

  it("merges two records for the same person", () => {
    const merged = mergeRecords(ada, adaAgain);
    expect(merged.subtitle).toContain("Analytical Engines");
    expect(merged.raw).toMatchObject({ a: 1, b: 2 });
  });

  it("dedupes a list", () => {
    expect(dedupeRecords([ada, adaAgain])).toHaveLength(1);
  });
});

describe("csv export", () => {
  it("quotes commas, quotes, and nested raw JSON", () => {
    const csv = recordsToCsv([
      {
        ...ada,
        title: 'Lovelace, "Ada"',
        raw: { note: "a,b" },
      },
    ]);
    expect(csv.split("\n")[0]).toContain("sourceType");
    expect(csv).toContain('"Lovelace, ""Ada"""');
    expect(csv).toContain('""note""');
  });
});

describe("apify status mapping", () => {
  it("maps transitional and hyphenated states", () => {
    expect(mapApifyStatus("ABORTING")).toBe("aborting");
    expect(mapApifyStatus("TIMING-OUT")).toBe("timing_out");
    expect(mapApifyStatus("TIMED-OUT")).toBe("timed_out");
    expect(mapApifyStatus("SUCCEEDED")).toBe("succeeded");
    expect(mapApifyStatus("READY")).toBe("running");
  });

  it("derives query status from jobs", () => {
    expect(deriveQueryStatus(["succeeded", "succeeded"])).toBe("succeeded");
    expect(deriveQueryStatus(["succeeded", "failed"])).toBe("failed");
    expect(deriveQueryStatus(["running", "queued"])).toBe("running");
  });

  it("promotes a stale queued query when every job already finished", () => {
    expect(reconcileQueryStatus("queued", ["succeeded"])).toBe("succeeded");
    expect(reconcileQueryStatus("running", ["succeeded", "failed"])).toBe(
      "failed",
    );
    expect(reconcileQueryStatus("queued", ["running"])).toBe("queued");
    expect(reconcileQueryStatus("succeeded", ["failed"])).toBe("succeeded");
  });
});

describe("workspace landing tab", () => {
  it("opens evidence for YC and other non-creative runs", () => {
    expect(
      defaultWorkspaceTab({
        hasContentRecords: false,
        hasEvidence: true,
        hasContentJobs: false,
        running: false,
      }),
    ).toBe("evidence");
    expect(
      defaultWorkspaceTab({
        hasContentRecords: false,
        hasEvidence: true,
        hasContentJobs: false,
        running: true,
      }),
    ).toBe("evidence");
  });

  it("opens creatives only for social-content searches", () => {
    expect(
      defaultWorkspaceTab({
        hasContentRecords: true,
        hasEvidence: true,
        hasContentJobs: true,
        running: false,
      }),
    ).toBe("creatives");
    expect(
      defaultWorkspaceTab({
        hasContentRecords: false,
        hasEvidence: false,
        hasContentJobs: true,
        running: true,
      }),
    ).toBe("creatives");
  });
});

describe("YC Apify connector", () => {
  it("builds an Apify run instead of an HTTP Algolia call", async () => {
    const { getConnector } = await import("@/lib/connectors/registry");
    const run = getConnector("yc-companies").buildRun({
      query: "fintech",
      isHiring: true,
      maxItems: 25,
    });
    expect(run.executor).toBe("apify");
    expect(run.actorId).toBe("haketa/ycombinator-companies-scraper");
    expect(run.input).toMatchObject({
      query: "fintech",
      hiringOnly: true,
      maxRecords: 25,
    });
  });

  it("sends AI-orchestrated structured filters without pitch text", async () => {
    const { getConnector } = await import("@/lib/connectors/registry");
    const run = getConnector("yc-companies").buildRun({
      query: "",
      industry: "Fintech",
      isHiring: true,
      batches: ["Winter 2024"],
      maxItems: 50,
      _orchestrated: true,
    });
    expect(run.input).toMatchObject({
      query: "",
      hiringOnly: true,
      industries: ["Fintech"],
      batches: ["Winter 2024"],
      maxRecords: 50,
    });
  });
});
