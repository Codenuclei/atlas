import { describe, expect, it } from "vitest";
import {
  displayStatus,
  engagementOf,
  formatAge,
  formatCompact,
  formatRate,
  isContentConnector,
  isContentRecord,
  jobStageLabel,
  platformLabel,
  platformOfConnector,
  roleForConnector,
} from "@/lib/view-model";
import type { ScrapedRecord } from "@/lib/normalize";

function record(overrides: Partial<ScrapedRecord> = {}): ScrapedRecord {
  return {
    sourceType: "youtube",
    externalId: "v1",
    title: "Video",
    subtitle: "Example Brand",
    url: "https://www.youtube.com/watch?v=v1",
    location: "",
    imageUrl: "",
    raw: {},
    ...overrides,
  };
}

describe("displayStatus", () => {
  it("labels planning states neutrally", () => {
    expect(displayStatus("planning")).toMatchObject({
      label: "Planning",
      tone: "neutral",
    });
    expect(displayStatus("queued")).toMatchObject({ label: "Queued" });
  });

  it("says Matching once any job has progressed, else Scanning", () => {
    expect(
      displayStatus("running", [{ status: "queued" }, { status: "queued" }]),
    ).toMatchObject({ label: "Scanning" });
    expect(
      displayStatus("running", [{ status: "running" }, { status: "queued" }]),
    ).toMatchObject({ label: "Matching" });
    expect(
      displayStatus("running", [{ status: "succeeded" }, { status: "queued" }]),
    ).toMatchObject({ label: "Matching" });
  });

  it("distinguishes zero-result success from a full success", () => {
    expect(displayStatus("succeeded", [], 0)).toMatchObject({
      label: "No matches",
      tone: "warning",
    });
    expect(displayStatus("succeeded", [], 12)).toMatchObject({
      label: "Complete",
      tone: "success",
    });
  });

  it("surfaces partial failures when at least one job succeeded", () => {
    expect(
      displayStatus("failed", [{ status: "succeeded" }, { status: "failed" }]),
    ).toMatchObject({ label: "Partial", tone: "warning" });
    expect(
      displayStatus("failed", [{ status: "failed" }, { status: "failed" }]),
    ).toMatchObject({ label: "Failed", tone: "danger" });
  });

  it("labels aborted and timed out runs distinctly", () => {
    expect(displayStatus("aborted")).toMatchObject({ label: "Stopped" });
    expect(displayStatus("timed_out")).toMatchObject({ label: "Timed out" });
  });
});

describe("engagementOf", () => {
  it("parses compact strings with K/M suffixes and commas", () => {
    const engagement = engagementOf(
      record({
        raw: { viewCount: "1.2M", likeCount: "12,500", commentsCount: "3.4K" },
      }),
    );
    expect(engagement.views).toBe(1_200_000);
    expect(engagement.likes).toBe(12_500);
    expect(engagement.comments).toBe(3_400);
  });

  it("falls back across raw field aliases and to numeric values directly", () => {
    const engagement = engagementOf(
      record({
        raw: { videoViewCount: 200, likesCount: 40, commentCount: 5 },
      }),
    );
    expect(engagement.views).toBe(200);
    expect(engagement.likes).toBe(40);
    expect(engagement.comments).toBe(5);
  });

  it("computes rate as interactions per view and zeros unknowns", () => {
    const engagement = engagementOf(
      record({ raw: { viewCount: 100, likes: 25, comments: 15 } }),
    );
    expect(engagement.rate).toBeCloseTo(0.4);
    expect(
      engagementOf(record({ raw: { likes: 25, comments: 15 } })).rate,
    ).toBe(0);
  });

  it("reads creator from platform-specific raw fields before subtitle", () => {
    expect(
      engagementOf(record({ raw: { ownerUsername: "brand" } })).creator,
    ).toBe("brand");
    expect(engagementOf(record({})).creator).toBe("Example Brand");
  });
});

describe("format helpers", () => {
  it("compacts counts with K/M/B thresholds", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(1000)).toBe("1.0K");
    expect(formatCompact(9999)).toBe("10.0K");
    expect(formatCompact(2_500_000)).toBe("2.5M");
    expect(formatCompact(1_250_000_000)).toBe("1.3B");
  });

  it("formats rates as percentages with an em-dash for zero", () => {
    expect(formatRate(0)).toBe("—");
    expect(formatRate(0.125)).toBe("12.5%");
  });

  it("formats ages in days, months, and years", () => {
    const now = Date.now();
    const hours = 3_600_000;
    expect(formatAge(new Date(now - 2 * hours).toISOString())).toBe("today");
    expect(formatAge(new Date(now - 26 * hours).toISOString())).toBe("1d ago");
    expect(formatAge(new Date(now - 5 * 86_400_000).toISOString())).toBe(
      "5d ago",
    );
    expect(formatAge(new Date(now - 60 * 86_400_000).toISOString())).toBe(
      "2mo ago",
    );
    expect(formatAge(new Date(now - 730 * 86_400_000).toISOString())).toBe(
      "2y ago",
    );
  });

  it("returns an empty string for empty or invalid dates", () => {
    expect(formatAge("")).toBe("");
    expect(formatAge("not-a-date")).toBe("");
  });
});

describe("record roles and labels", () => {
  it("assigns owned/external/reference roles by connector", () => {
    expect(roleForConnector("youtube-content")).toBe("owned");
    expect(roleForConnector("instagram-content")).toBe("owned");
    expect(roleForConnector("youtube-content-examples")).toBe("external");
    expect(roleForConnector("instagram-content-examples")).toBe("external");
    expect(roleForConnector("yc-companies")).toBe("reference");
    expect(roleForConnector(undefined)).toBe("reference");
  });

  it("recognizes content records by source type", () => {
    expect(isContentRecord(record())).toBe(true);
    expect(
      isContentRecord(record({ sourceType: "instagram" })),
    ).toBe(true);
    expect(isContentRecord(record({ sourceType: "yc" }))).toBe(false);
  });

  it("maps platform labels including LinkedIn variants", () => {
    expect(platformLabel(record())).toBe("YouTube");
    expect(platformLabel(record({ sourceType: "instagram" }))).toBe(
      "Instagram",
    );
    expect(platformLabel(record({ sourceType: "yc" }))).toBe("YC");
    expect(platformLabel(record({ sourceType: "job" }))).toBe("LinkedIn Jobs");
    expect(platformLabel(record({ sourceType: "company" }))).toBe("LinkedIn");
    expect(platformLabel(record({ sourceType: "profile" }))).toBe("LinkedIn");
  });

  it("derives platform and content-ness from connector ids", () => {
    expect(platformOfConnector("youtube-content")).toBe("youtube");
    expect(platformOfConnector("instagram-content-examples")).toBe(
      "instagram",
    );
    expect(platformOfConnector("yc-companies")).toBe("other");
    expect(isContentConnector("youtube-content-examples")).toBe(true);
    expect(isContentConnector("linkedin-jobs")).toBe(false);
  });

  it("labels job stages with human names", () => {
    expect(jobStageLabel("yc-companies")).toBe("YC companies");
    expect(jobStageLabel("linkedin-profile")).toBe("LinkedIn profiles");
    expect(jobStageLabel("unknown-connector")).toBe("unknown-connector");
  });
});
