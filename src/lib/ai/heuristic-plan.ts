import type { ScrapePlan } from "@/lib/ai/plan-schema";
import {
  parseYcBatch,
  parseYcIndustry,
  ycKeywordsFrom,
} from "@/lib/connectors/yc-companies";

export function heuristicPlan(query: string): ScrapePlan {
  const text = query.toLowerCase();
  const wantsJobs = /\bjobs?\b|\broles?\b|\bopenings?\b/.test(text);
  const wantsYc = /\byc\b|y combinator|ycombinator/.test(text);
  const wantsPeople =
    /\bfounders?\b|\bengineers?\b|\bpeople\b|\bwho\b|\bceo\b|\bprofiles?\b/.test(text);
  const wantsCompanies =
    /\bcompanies\b|\bstartups?\b|\bemployers?\b/.test(text) || wantsYc;
  const wantsYoutube = /\byoutube\b|\byoutu\.be\b/.test(text);
  const wantsInstagram = /\binstagram\b|\binsta\b|\breels?\b/.test(text);
  const wantsContent =
    wantsYoutube ||
    wantsInstagram ||
    /\bcontent\b|\bchannels?\b|\bvideos?\b|\bposts?\b|\bperformance\b|\bengagement\b/.test(
      text,
    );
  const wantsDeeperLinkedin =
    /\bdeeper\s+linkedin\b|\benrich\s+profiles?\b|\blinkedin\b/.test(text);

  if (wantsContent) {
    const youtubeUrls = extractYoutubeUrls(query);
    const instagramProfiles = extractInstagramProfiles(query);
    const brandSearch = socialSearchFrom(query);
    const includeYoutube = wantsYoutube || (!wantsYoutube && !wantsInstagram);
    const includeInstagram = wantsInstagram || (!wantsYoutube && !wantsInstagram);
    const steps: ScrapePlan["steps"] = [];

    if (includeYoutube) {
      steps.push({
        connectorId: "youtube-content",
        purpose: "Collect recent YouTube videos and Shorts",
        dependsOn: [],
        params: {
          channelUrls: youtubeUrls,
          searchQueries: youtubeUrls.length ? [] : [brandSearch],
          maxItems: 30,
          includeShorts: true,
        },
      });
    }
    if (includeInstagram) {
      steps.push({
        connectorId: "instagram-content",
        purpose: "Collect recent Instagram posts and Reels",
        dependsOn: [],
        params: {
          profiles: instagramProfiles,
          search: instagramProfiles.length ? "" : brandSearch,
          maxItems: 30,
          newerThan: "6 months",
        },
      });
    }
    const ownedDependencies = steps.map((step) => step.connectorId);
    steps.push({
      connectorId: "youtube-content-examples",
      purpose: "Find aligned examples and extract reusable patterns",
      dependsOn: ownedDependencies,
      params: {
        searchQueries: [],
        maxItems: 40,
      },
    });
    steps.push({
      connectorId: "instagram-content-examples",
      purpose: "Find exact matching Instagram posts and Reels",
      dependsOn: ownedDependencies,
      params: {
        hashtags: [],
        maxItems: 40,
        newerThan: "6 months",
      },
    });

    return {
      interpretation:
        "Identify audience archetypes and content direction, then research aligned YouTube examples and extract the five strongest patterns.",
      intent: "content",
      expectedResultType: "content",
      clarificationNeeded:
        youtubeUrls.length || instagramProfiles.length
          ? ""
          : "Accounts will be discovered from the supplied brand/channel name; provide exact handles or a YouTube URL for maximum precision.",
      steps,
    };
  }

  if (wantsJobs) {
    const titleMatch = query.match(
      /(?:senior|staff|principal|junior)?\s*(backend|frontend|fullstack|software|data|product|designer|engineer)s?/i,
    );
    return {
      interpretation: `Search LinkedIn jobs matching "${query}".`,
      intent: "jobs",
      expectedResultType: "jobs",
      clarificationNeeded: "",
      steps: [
        {
          connectorId: "linkedin-jobs",
          purpose: "Find matching job listings",
          dependsOn: [],
          params: {
            jobTitles: [titleMatch?.[0]?.trim() || "software engineer"],
            locations: locationFrom(query),
            maxItems: 10,
          },
        },
      ],
    };
  }

  if (wantsYc) {
    const batch = parseYcBatch(query);
    const industry = parseYcIndustry(query);
    const cleanedQuery = ycKeywordsFrom(query);
    const isHiring = /\bhiring\b|\bhire\b/.test(text);
    const ycParams: Record<string, unknown> = {
      isHiring,
      maxItems: 50,
    };
    if (cleanedQuery && cleanedQuery.toLowerCase() !== industry?.toLowerCase()) {
      ycParams.query = cleanedQuery;
    }
    if (batch) ycParams.batch = batch;
    if (industry) ycParams.industry = industry;

    const addLinkedin =
      wantsDeeperLinkedin || (wantsPeople && /\blinkedin\b/.test(text));

    const steps: ScrapePlan["steps"] = [
      {
        connectorId: "yc-companies",
        purpose: wantsPeople
          ? "Find matching YC companies and founders"
          : "Find matching YC companies",
        dependsOn: [],
        params: ycParams,
      },
    ];

    if (addLinkedin) {
      steps.push({
        connectorId: "linkedin-profile-search",
        purpose: "Enrich founder profiles on LinkedIn",
        dependsOn: ["yc-companies"],
        params: {
          searchQuery: peopleQueryFrom(query) || "founder",
          currentJobTitles: ["Founder", "Co-Founder", "CEO"],
          currentCompanies: [],
          locations: locationFrom(query),
          maxItems: 20,
        },
      });
    }

    return {
      interpretation: addLinkedin
        ? `Find YC companies matching the query, then deepen LinkedIn research for founders.`
        : wantsPeople
          ? `Find YC companies and founders matching "${query}" (founders from the YC directory).`
          : `Search the YC directory for "${query}".`,
      intent: addLinkedin || wantsPeople ? "mixed" : "companies",
      expectedResultType: addLinkedin || wantsPeople ? "mixed" : "companies",
      clarificationNeeded: "",
      steps,
    };
  }

  if (wantsCompanies && !wantsPeople) {
    return {
      interpretation: `Search LinkedIn companies matching "${query}".`,
      intent: "companies",
      expectedResultType: "companies",
      clarificationNeeded: "",
      steps: [
        {
          connectorId: "linkedin-company-search",
          purpose: "Find matching companies",
          dependsOn: [],
          params: {
            searchQuery: companyQueryFrom(query) || query,
            locations: locationFrom(query),
            maxItems: 20,
          },
        },
      ],
    };
  }

  return {
    interpretation: `Search LinkedIn people matching "${query}".`,
    intent: "people",
    expectedResultType: "people",
    clarificationNeeded: "",
    steps: [
      {
        connectorId: "linkedin-profile-search",
        purpose: "Find matching people",
        dependsOn: [],
        params: {
          searchQuery: peopleQueryFrom(query) || query,
          locations: locationFrom(query),
          maxItems: 20,
        },
      },
    ],
  };
}

function locationFrom(query: string): string[] {
  const match = query.match(
    /\b(sf|san francisco|nyc|new york|berlin|london|seattle|austin|boston|remote)\b/i,
  );
  if (!match) return [];
  const aliases: Record<string, string> = {
    sf: "San Francisco",
    nyc: "New York",
  };
  const key = match[1].toLowerCase();
  return [aliases[key] ?? match[1]];
}

function peopleQueryFrom(query: string) {
  return query
    .replace(/\b(yc|y combinator|who went through|companies|startups)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function companyQueryFrom(query: string) {
  return query
    .replace(/\b(founders?|engineers?|people|who|ceo|roles?|jobs?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractYoutubeUrls(query: string) {
  return (
    query.match(
      /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s,]+/gi,
    ) ?? []
  ).map((url) => url.replace(/[.)]+$/, ""));
}

function extractInstagramProfiles(query: string) {
  const urls =
    query.match(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+\/?/gi) ??
    [];
  const handles = [...query.matchAll(/@([A-Za-z0-9._]{2,30})/g)].map(
    (match) => match[1],
  );
  return [...new Set([...urls, ...handles])];
}

function socialSearchFrom(query: string) {
  const primaryIntent = query.split(
    /,|\bthen\b|\band\s+(?:recommend|identify|find|extract|tell|suggest|return|show|list|get)\b/i,
  )[0];
  const cleaned = primaryIntent
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/@[A-Za-z0-9._]+/g, " ")
    .replace(
      /\b(analy[sz]e|check|find|all|and|channels?|content|videos?|posts?|reels?|across|on|under|youtube|instagram|performance|suggestions?|recommendations?|recommend|works?|working|related|given|which|what|to|publish|next|return|exact|matching|creatives?|best|top|five|audience|archetypes?|direction|identify|extract)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "brand content";
}
