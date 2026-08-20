import { describe, expect, it } from "vitest";
import { dedupeRecords, mergeKeyFor, mergeRecords } from "@/lib/resolve";
import { recordsToCsv } from "@/lib/export";
import { mapApifyStatus, deriveQueryStatus } from "@/lib/status";
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
    expect(run.input).toMatchObject({ query: "fintech", hiringOnly: true, maxRecords: 25 });
  });

  it("strips the user sentence down to keywords and infers hiring + industry", async () => {
    const { getConnector } = await import("@/lib/connectors/registry");
    const run = getConnector("yc-companies").buildRun({
      query: "YC companies hiring in fintech",
    });
    expect(run.input).toMatchObject({
      query: "fintech",
      hiringOnly: true,
      industries: ["Fintech"],
      maxRecords: 50,
    });
  });
});
