import { describe, expect, it } from "vitest";
import {
  collectOwnedBrandSignals,
  deriveContentExampleQueries,
  isOwnedBrandCreative,
  selectAlignedReferences,
} from "@/lib/content-research";
import type { ScrapedRecord } from "@/lib/normalize";

function record(
  partial: Partial<ScrapedRecord> & {
    title: string;
    sourceType: ScrapedRecord["sourceType"];
  },
): ScrapedRecord {
  return {
    externalId: partial.externalId ?? partial.title,
    subtitle: partial.subtitle ?? "",
    url: partial.url ?? "https://example.com",
    location: "",
    imageUrl: "",
    raw: partial.raw ?? {},
    ...partial,
  };
}

describe("external creative exclusion", () => {
  it("builds reference searches from pillars without the owned brand name", () => {
    const owned = [
      record({
        sourceType: "youtube",
        title: "CEO Challenge at campus",
        raw: { researchRole: "owned", channelName: "Masters Union" },
      }),
      record({
        sourceType: "youtube",
        title: "Business case study series",
        raw: { researchRole: "owned", channelName: "Masters Union" },
      }),
    ];
    const queries = deriveContentExampleQueries(owned, "Masters Union");
    expect(
      queries.every(
        (query) => !query.replace(/-"[^"]+"/g, "").includes("Masters Union"),
      ),
    ).toBe(true);
    expect(queries.some((query) => query.includes('-"Masters Union"'))).toBe(
      true,
    );
    expect(
      queries.some((query) => /case study|masterclass|challenge/i.test(query)),
    ).toBe(true);
  });

  it("excludes owned-brand creatives from reference ranking", () => {
    const records = [
      record({
        sourceType: "youtube",
        title: "Owned campus film",
        raw: { researchRole: "owned", channelName: "Masters' Union" },
      }),
      record({
        sourceType: "youtube",
        title: "CEO Challenge Ep.1",
        subtitle: "Reference example · Masters' Union · 1M views",
        raw: {
          researchRole: "reference",
          channelName: "Masters' Union",
          viewCount: 1_000_000,
        },
      }),
      record({
        sourceType: "youtube",
        title: "Founder masterclass playbook",
        subtitle: "Reference example · Think School · 800k views",
        raw: {
          researchRole: "reference",
          channelName: "Think School",
          viewCount: 800_000,
        },
      }),
      record({
        sourceType: "youtube",
        title: "Startup pitch challenge documentary",
        subtitle: "Reference example · YCombinator · 500k views",
        raw: {
          researchRole: "reference",
          channelName: "YCombinator",
          viewCount: 500_000,
        },
      }),
    ];
    const signals = collectOwnedBrandSignals(records, "Masters Union");
    expect(isOwnedBrandCreative(records[1], signals)).toBe(true);
    expect(isOwnedBrandCreative(records[2], signals)).toBe(false);
    const selected = selectAlignedReferences(
      records,
      5,
      "youtube",
      "Masters Union",
    );
    expect(selected.map((item) => item.raw.channelName)).toEqual([
      "Think School",
      "YCombinator",
    ]);
  });

  it("prefers higher-view creatives when thematic alignment is similar", () => {
    const records = [
      record({
        sourceType: "youtube",
        title: "Owned campus film",
        raw: { researchRole: "owned", channelName: "Masters Union" },
      }),
      record({
        sourceType: "youtube",
        title: "Founder masterclass with low reach",
        raw: {
          researchRole: "reference",
          channelName: "Small Channel",
          viewCount: 12_000,
        },
      }),
      record({
        sourceType: "youtube",
        title: "Founder masterclass with high reach",
        raw: {
          researchRole: "reference",
          channelName: "Big Channel",
          viewCount: 2_500_000,
        },
      }),
      record({
        sourceType: "youtube",
        title: "Startup pitch challenge documentary",
        raw: {
          researchRole: "reference",
          channelName: "Mid Channel",
          viewCount: 400_000,
        },
      }),
    ];
    const selected = selectAlignedReferences(
      records,
      5,
      "youtube",
      "Masters Union",
    );
    expect(selected[0]?.raw.channelName).toBe("Big Channel");
    expect(selected.map((item) => item.raw.channelName)).toEqual([
      "Big Channel",
      "Mid Channel",
      "Small Channel",
    ]);
  });
});
