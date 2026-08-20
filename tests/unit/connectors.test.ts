import { describe, expect, it } from "vitest";
import { getConnector } from "@/lib/connectors/registry";
import profileFixture from "../fixtures/linkedin-profile.json";
import companyFixture from "../fixtures/linkedin-company.json";
import jobFixture from "../fixtures/linkedin-job.json";
import ycFixture from "../fixtures/yc-company.json";

describe("connector schemas", () => {
  it("accepts valid profile search input and rejects empty query", () => {
    const connector = getConnector("linkedin-profile-search");
    expect(
      connector.inputSchema.parse({ searchQuery: "founders", maxItems: 10 }),
    ).toMatchObject({ searchQuery: "founders" });
    expect(() => connector.inputSchema.parse({ searchQuery: "" })).toThrow();
  });

  it("accepts jobs input and requires titles", () => {
    const connector = getConnector("linkedin-jobs");
    expect(
      connector.inputSchema.parse({
        jobTitles: ["backend engineer"],
        locations: ["Berlin"],
      }),
    ).toBeTruthy();
    expect(() => connector.inputSchema.parse({ jobTitles: [] })).toThrow();
  });

  it("allows empty internal detail targets for resolver hydration", () => {
    expect(
      getConnector("linkedin-profile").inputSchema.parse({ queries: [] }),
    ).toMatchObject({ queries: [] });
    expect(
      getConnector("linkedin-company").inputSchema.parse({ companies: [] }),
    ).toMatchObject({ companies: [] });
  });

  it("validates generic social content inputs", () => {
    expect(
      getConnector("youtube-content").inputSchema.parse({
        channelUrls: ["https://youtube.com/@example"],
        maxItems: 30,
        includeShorts: true,
      }),
    ).toMatchObject({ maxItems: 30 });
    expect(() =>
      getConnector("youtube-content").inputSchema.parse({
        channelUrls: ["javascript:alert(1)"],
      }),
    ).toThrow();
    expect(
      getConnector("instagram-content").inputSchema.parse({
        profiles: ["@example.brand"],
        maxItems: 20,
      }),
    ).toMatchObject({ profiles: ["example.brand"] });
    expect(
      getConnector("instagram-content-examples").inputSchema.parse({
        hashtags: ["studententrepreneur", "businesscasestudy"],
      }),
    ).toMatchObject({ hashtags: ["studententrepreneur", "businesscasestudy"] });
  });
});

describe("normalizers", () => {
  it("normalizes a LinkedIn profile", () => {
    const record = getConnector("linkedin-profile").normalize(profileFixture);
    expect(record.title).toBe("Ada Lovelace");
    expect(record.url).toContain("/in/ada-lovelace");
    expect(record.sourceType).toBe("profile");
  });

  it("normalizes a LinkedIn company", () => {
    const record = getConnector("linkedin-company").normalize(companyFixture);
    expect(record.title).toBe("Ramp");
    expect(record.location).toContain("New York");
  });

  it("normalizes a LinkedIn job", () => {
    const record = getConnector("linkedin-jobs").normalize(jobFixture);
    expect(record.title).toBe("Senior Backend Engineer");
    expect(record.subtitle).toContain("Fintech Labs");
    expect(record.location).toBe("Berlin, Germany");
  });

  it("normalizes a YC company", () => {
    const record = getConnector("yc-companies").normalize(ycFixture);
    expect(record.title).toBe("Stripe");
    expect(record.url).toContain("/companies/stripe");
    expect(record.sourceType).toBe("yc");
  });

  it("normalizes YouTube performance signals", () => {
    const record = getConnector("youtube-content").normalize({
      videoId: "video-1",
      title: "How founders validate ideas",
      url: "https://youtube.com/watch?v=video-1",
      channelName: "Example",
      viewCount: 120000,
      likes: 4000,
    });
    expect(record.sourceType).toBe("youtube");
    expect(record.subtitle).toContain("120000 views");
  });

  it("normalizes Instagram performance signals", () => {
    const record = getConnector("instagram-content").normalize({
      id: "post-1",
      caption: "Behind the scenes",
      ownerUsername: "example",
      likesCount: 3200,
      commentsCount: 80,
    });
    expect(record.sourceType).toBe("instagram");
    expect(record.subtitle).toContain("3200 likes");
  });

  it("marks external Instagram creatives as references", () => {
    const record = getConnector("instagram-content-examples").normalize({
      id: "reference-post",
      caption: "Founder challenge",
      url: "https://instagram.com/reel/reference-post/",
      ownerUsername: "example",
    });
    expect(record.raw.researchRole).toBe("reference");
    expect(record.subtitle).toContain("Reference creative");
  });
});

describe("cost estimates", () => {
  it("multiplies jobs maxItems by title x location pairs", () => {
    const estimate = getConnector("linkedin-jobs").costEstimate({
      jobTitles: ["backend", "frontend"],
      locations: ["Berlin", "London"],
      maxItems: 10,
    });
    expect(estimate.itemCount).toBe(40);
    expect(estimate.usd).toBeCloseTo(0.04);
  });
});
