import type { ActorRunLike, ApifyProvider, DatasetPage } from "@/lib/apify/client";

type MockRun = ActorRunLike & {
  items: Record<string, unknown>[];
  polls: number;
};

const runs = new Map<string, MockRun>();

function sampleItems(actorId: string, input: Record<string, unknown>) {
  if (
    actorId.includes("apivault") ||
    actorId.includes("haketa") ||
    actorId.includes("ycombinator-companies") ||
    actorId.includes("yc-companies")
  ) {
    return [
      {
        id: 1,
        objectID: "1",
        name: "Ramp",
        slug: "ramp",
        url: "https://www.ycombinator.com/companies/ramp",
        website: "https://ramp.com",
        oneLiner: "Corporate cards and spend management",
        longDescription: "Ramp is a corporate card and spend management platform.",
        location: "New York, NY, USA",
        batch: "Winter 2020",
        industry: "Fintech",
        teamSize: 1200,
        status: "Active",
        isHiring: true,
        ycUrl: "https://www.ycombinator.com/companies/ramp",
        founders: [
          {
            name: "Eric Glyman",
            title: "CEO",
            bio: "Co-founder and CEO of Ramp.",
            linkedinUrl: "https://www.linkedin.com/in/eglyman",
          },
          {
            name: "Karim Atiyeh",
            title: "CTO",
            bio: "Co-founder and CTO of Ramp.",
            linkedinUrl: "https://www.linkedin.com/in/karimatiyeh",
          },
        ],
      },
    ];
  }
  if (actorId.includes("youtube")) {
    if (input.sortingOrder === "views") {
      return [
        {
          videoId: "reference-1",
          title: "How a startup grew from zero: complete business case study",
          url: "https://www.youtube.com/watch?v=reference-1",
          channelName: "Business Lab",
          viewCount: 820000,
          likes: 31000,
          commentsCount: 1200,
          publishedAt: "2026-07-12",
        },
        {
          videoId: "reference-2",
          title: "Founder masterclass: the operator playbook",
          url: "https://www.youtube.com/watch?v=reference-2",
          channelName: "Builder Stories",
          viewCount: 610000,
          likes: 24000,
          commentsCount: 940,
          publishedAt: "2026-06-20",
        },
      ];
    }
    return [
      {
        videoId: "video-1",
        title: "Founder explains how to validate an idea",
        url: "https://www.youtube.com/watch?v=video-1",
        channelName: "Example Brand",
        viewCount: 128000,
        likes: 6400,
        commentsCount: 310,
        publishedAt: "2026-08-01",
        duration: "00:08:42",
      },
      {
        videoId: "short-1",
        title: "Three startup lessons in 30 seconds",
        url: "https://www.youtube.com/shorts/short-1",
        channelName: "Example Brand",
        viewCount: 94000,
        likes: 8100,
        commentsCount: 190,
        publishedAt: "2026-08-08",
        isShort: true,
      },
    ];
  }
  if (actorId.includes("instagram")) {
    const directUrls = Array.isArray(input.directUrls)
      ? input.directUrls.map(String)
      : [];
    if (directUrls.some((url) => url.includes("/explore/tags/"))) {
      return [
        {
          id: "instagram-reference-1",
          ownerUsername: "builder.creatives",
          caption:
            "Three founder decisions that changed the outcome of this startup.",
          url: "https://www.instagram.com/reel/reference-1/",
          videoViewCount: 480000,
          likesCount: 22000,
          commentsCount: 610,
          type: "Video",
          timestamp: "2026-07-18",
        },
        {
          id: "instagram-reference-2",
          ownerUsername: "student.builds",
          caption:
            "We gave student founders seven days to build and pitch a real product.",
          url: "https://www.instagram.com/reel/reference-2/",
          videoViewCount: 320000,
          likesCount: 17000,
          commentsCount: 430,
          type: "Video",
          timestamp: "2026-07-10",
        },
      ];
    }
    return [
      {
        id: "post-1",
        shortCode: "post1",
        caption: "What students built during venture week",
        ownerUsername: "example.brand",
        url: "https://www.instagram.com/p/post1/",
        likesCount: 4200,
        commentsCount: 95,
        timestamp: "2026-08-05T10:00:00.000Z",
        productType: "carousel",
      },
      {
        id: "reel-1",
        shortCode: "reel1",
        caption: "A day behind the scenes",
        ownerUsername: "example.brand",
        url: "https://www.instagram.com/reel/reel1/",
        videoViewCount: 73000,
        likesCount: 5900,
        commentsCount: 140,
        timestamp: "2026-08-10T10:00:00.000Z",
        productType: "clips",
      },
    ];
  }
  if (actorId.includes("job")) {
    return [
      {
        id: "job-1",
        title: "Senior Backend Engineer",
        linkedinUrl: "https://www.linkedin.com/jobs/view/1",
        location: { parsed: { text: "Berlin, Germany" } },
        company: { name: "Fintech Labs", linkedinUrl: "https://www.linkedin.com/company/fintech-labs" },
        postedDate: "2026-08-01",
        employmentType: "Full-time",
      },
    ];
  }
  if (actorId.includes("company")) {
    const names = (input.companies as string[] | undefined) ??
      (input.searches as string[] | undefined) ??
      [String(input.searchQuery ?? "Ramp")];
    return names.slice(0, 3).map((name, index) => ({
      id: `company-${index + 1}`,
      name: String(name).replace(/https:\/\/www\.linkedin\.com\/company\//, ""),
      linkedinUrl: String(name).startsWith("http")
        ? String(name)
        : `https://www.linkedin.com/company/${String(name).toLowerCase().replaceAll(" ", "-")}`,
      tagline: "B2B software",
      website: "https://example.com",
      employeeCount: 240,
      locations: [{ city: "San Francisco", country: "United States", headquarter: true }],
    }));
  }
  const queries = (input.queries as string[] | undefined) ?? [String(input.searchQuery ?? "Founder")];
  return queries.slice(0, 3).map((query, index) => ({
    id: `profile-${index + 1}`,
    fullName: index === 0 ? "Ada Lovelace" : `Person ${index + 1}`,
    headline: "Founder & CEO",
    linkedinUrl: String(query).startsWith("http")
      ? String(query)
      : `https://www.linkedin.com/in/${String(query).toLowerCase().replaceAll(" ", "-")}`,
    location: "San Francisco Bay Area",
    photo: "",
    currentCompany: "YC Startup",
  }));
}

export function resetMockApify() {
  runs.clear();
}

export function getMockApify(): ApifyProvider {
  return {
    async startActor(actorId, input) {
      const id = `mock-run-${runs.size + 1}`;
      const run: MockRun = {
        id,
        status: "RUNNING",
        defaultDatasetId: `mock-ds-${id}`,
        items: sampleItems(actorId, input),
        polls: 0,
      };
      runs.set(id, run);
      return run;
    },
    async getRun(runId) {
      const run = runs.get(runId);
      if (!run) {
        return { id: runId, status: "FAILED", statusMessage: "Unknown mock run" };
      }
      run.polls += 1;
      if (run.status === "RUNNING" && run.polls >= 1) run.status = "SUCCEEDED";
      return run;
    },
    async abortRun(runId) {
      const run = runs.get(runId);
      if (!run) return { id: runId, status: "ABORTED" };
      run.status = "ABORTED";
      return run;
    },
    async listDatasetItems(datasetId, options) {
      const run = [...runs.values()].find((item) => item.defaultDatasetId === datasetId);
      const items = run?.items ?? [];
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 100;
      const slice = items.slice(offset, offset + limit);
      const page: DatasetPage = {
        items: slice,
        total: items.length,
        offset,
        count: slice.length,
        limit,
      };
      return page;
    },
  };
}

export function seedMockApifyRun(
  runId: string,
  init: Partial<MockRun> & { items?: Record<string, unknown>[] },
) {
  runs.set(runId, {
    id: runId,
    status: init.status ?? "SUCCEEDED",
    defaultDatasetId: init.defaultDatasetId ?? `mock-ds-${runId}`,
    items: init.items ?? [],
    polls: init.polls ?? 1,
    statusMessage: init.statusMessage,
  });
}
