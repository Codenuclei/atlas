import type { ScrapedRecord } from "@/lib/normalize";

export const CONTENT_PILLARS = [
  {
    label: "Business case-study series",
    pattern:
      /case study|how .{0,40}built|building|business|strategy|mistake|fail/i,
    searchQuery: "business case study startup strategy explained",
    instagramHashtags: ["businesscasestudy", "startupstory"],
    format: "8–12 minute YouTube episode + 3 result-first Shorts/Reels",
    hook: '"The decision that made this business work was not what you expect."',
    structure: "result → turning point → evidence → transferable lesson",
  },
  {
    label: "Practitioner masterclasses",
    pattern:
      /masterclass|founder|ceo|expert|secrets|explains|interview|marketing|clients/i,
    searchQuery: "founder operator masterclass business playbook",
    instagramHashtags: ["founderstory", "businessmasterclass"],
    format: "Expert-led long-form conversation + quote-led vertical clips",
    hook: '"Most people learn this too late—here is the operator’s playbook."',
    structure:
      "high-stakes question → operator story → framework → action list",
  },
  {
    label: "Build-and-pitch challenges",
    pattern: /challenge|project|pitch|startup|build in|venture/i,
    searchQuery: "startup pitch challenge build in public",
    instagramHashtags: ["startupchallenge", "buildinpublic"],
    format: "Episodic build-in-public video + daily progress Reels",
    hook: '"They had one deadline, one constraint, and no finished product."',
    structure: "constraint → attempts → setback → pitch/result → reflection",
  },
  {
    label: "Money and career breakdowns",
    pattern: /finance|money|career|salary|job|wealth|20s|30s/i,
    searchQuery: "finance career masterclass young professionals",
    instagramHashtags: ["careeradvice", "financialeducation"],
    format: "Number-led explainer + carousel checklist + 30-second myth-buster",
    hook: '"If you are in your 20s, this one number changes the decision."',
    structure: "surprising number → common mistake → breakdown → next action",
  },
  {
    label: "AI and design explainers",
    pattern: /\bai\b|artificial intelligence|design|technology|product/i,
    searchQuery: "AI design product practical explainer",
    instagramHashtags: ["artificialintelligence", "productdesign"],
    format: "Screen-led demonstration + before/after Reel",
    hook: '"AI is not replacing this skill—it is changing the minimum standard."',
    structure: "before → live workflow → after → limits and takeaway",
  },
  {
    label: "Behind-the-scenes proof",
    pattern: /behind.the.scenes|day in|campus|student|inside|life at/i,
    searchQuery: "student entrepreneur day in life behind the scenes",
    instagramHashtags: ["studentlife", "studententrepreneur"],
    format:
      "First-person Reel/Short + monthly documentary-style YouTube episode",
    hook: '"Here is what a real day looks like when the cameras are not staged."',
    structure:
      "cold open → real moments → friction → outcome → candid reflection",
  },
] as const;

const AUDIENCES = [
  {
    label: "Ambitious students and prospective applicants",
    pattern: /student|campus|college|class|placement|admission|learn/i,
    need: "credible proof of outcomes, experience, and belonging",
  },
  {
    label: "Aspiring founders and early-stage operators",
    pattern: /startup|founder|pitch|business|venture|build|entrepreneur/i,
    need: "practical playbooks, access to operators, and build-in-public proof",
  },
  {
    label: "Early-career professionals",
    pattern: /career|finance|salary|job|20s|30s|leadership|management/i,
    need: "career leverage, financial fluency, and accelerated progression",
  },
  {
    label: "Product, design, and technology learners",
    pattern: /\bai\b|design|technology|product|marketing|creator/i,
    need: "current tools, demonstrated workflows, and practitioner insight",
  },
] as const;

export function numericMetric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const match = value
    .replaceAll(",", "")
    .trim()
    .toLowerCase()
    .match(/^([\d.]+)\s*([kmb])?/);
  if (!match) return 0;
  const multiplier =
    match[2] === "k"
      ? 1_000
      : match[2] === "m"
        ? 1_000_000
        : match[2] === "b"
          ? 1_000_000_000
          : 1;
  return Number(match[1]) * multiplier;
}

export function contentViews(record: ScrapedRecord) {
  const raw = record.raw;
  return numericMetric(
    raw.viewCount ?? raw.views ?? raw.videoViewCount ?? raw.videoPlayCount,
  );
}

export function contentPerformance(record: ScrapedRecord) {
  const raw = record.raw;
  const views = contentViews(record);
  const likes = numericMetric(raw.likes ?? raw.likeCount ?? raw.likesCount);
  const comments = numericMetric(
    raw.commentsCount ?? raw.commentCount ?? raw.comments,
  );
  // Views dominate: high-reach aligned creatives are usually the better reference.
  return (
    3 * Math.log10(views + 1) +
    1.2 * Math.log10(likes + 1) +
    1.5 * Math.log10(comments + 1)
  );
}

export function rankedContent(records: ScrapedRecord[]) {
  return [...records].sort(
    (left, right) => contentPerformance(right) - contentPerformance(left),
  );
}

function asText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeSignal(value: string) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Collect brand/channel identity from owned research so references can exclude it. */
export function collectOwnedBrandSignals(
  records: ScrapedRecord[],
  brandHint = "",
) {
  const signals = new Set<string>();
  const addPhrase = (value: string) => {
    const normalized = normalizeSignal(value);
    if (normalized.length >= 3) signals.add(normalized);
  };
  const addHandle = (value: string) => {
    const normalized = normalizeSignal(value.replace(/^@/, ""));
    if (normalized.length >= 3) signals.add(normalized);
  };

  if (brandHint.trim()) addPhrase(brandHint);
  for (const record of records) {
    if (record.raw.researchRole === "reference") continue;
    addPhrase(asText(record.raw.channelName));
    addPhrase(asText(record.raw.channelTitle));
    addHandle(asText(record.raw.ownerUsername));
    addHandle(asText(record.raw.username));
  }
  return [...signals];
}

export function isOwnedBrandCreative(
  record: ScrapedRecord,
  ownedSignals: string[],
) {
  if (!ownedSignals.length) return false;
  const channel = normalizeSignal(
    asText(record.raw.channelName) ||
      asText(record.raw.channelTitle) ||
      asText(record.raw.ownerUsername) ||
      asText(record.raw.username),
  );
  if (!channel) return false;

  return ownedSignals.some((signal) => {
    if (!signal) return false;
    // Match owned channel/handle identity only — title mentions of the brand
    // on another creator's video are still valid external references.
    return (
      channel === signal ||
      channel.includes(signal) ||
      signal.includes(channel)
    );
  });
}

function creatorKey(record: ScrapedRecord) {
  return (
    normalizeSignal(
      asText(record.raw.channelName) ||
        asText(record.raw.channelTitle) ||
        asText(record.raw.ownerUsername) ||
        asText(record.raw.username) ||
        record.subtitle,
    ) || record.externalId
  );
}

export function deriveContentDirection(records: ScrapedRecord[]) {
  const owned = records.filter(
    (record) => record.raw.researchRole !== "reference",
  );
  const sample = rankedContent(owned).slice(0, 30);
  const pillars = CONTENT_PILLARS.map((pillar) => {
    const matches = sample.filter((record) =>
      pillar.pattern.test(record.title),
    );
    return {
      ...pillar,
      score: matches.reduce(
        (sum, record) => sum + Math.max(contentPerformance(record), 1),
        0,
      ),
      evidence: matches[0],
    };
  })
    .sort((left, right) => right.score - left.score)
    .filter((pillar) => pillar.score > 0);

  const audiences = AUDIENCES.map((audience) => ({
    ...audience,
    score: sample.reduce(
      (sum, record) =>
        sum +
        (audience.pattern.test(`${record.title} ${record.subtitle}`)
          ? Math.max(contentPerformance(record), 1)
          : 0),
      0,
    ),
  }))
    .sort((left, right) => right.score - left.score)
    .filter((audience) => audience.score > 0);

  return {
    pillars: pillars.slice(0, 4),
    audiences: audiences.slice(0, 3),
  };
}

function youtubeExclusionClause(brandHint: string) {
  const brand = brandHint.trim();
  if (!brand) return "";
  const variants = [
    brand,
    brand.replace(/'/g, ""),
    brand.replace(/\s+/g, ""),
  ].filter((value, index, all) => value && all.indexOf(value) === index);
  return variants.map((value) => `-"${value}"`).join(" ");
}

/**
 * External reference searches must follow the researched pillars/audience,
 * not the owned brand name — otherwise YouTube returns the same channel.
 */
export function deriveContentExampleQueries(
  records: ScrapedRecord[],
  brandHint = "",
) {
  const direction = deriveContentDirection(records);
  const audienceHint = direction.audiences[0]?.label
    .replace(/and prospective applicants|and early-stage operators/i, "")
    .trim();
  const exclusion = youtubeExclusionClause(brandHint);
  const queries = direction.pillars.slice(0, 4).map((pillar) =>
    [pillar.searchQuery, audienceHint, exclusion].filter(Boolean).join(" "),
  );
  if (queries.length) return [...new Set(queries)];
  return [
    ["business case study startup strategy", exclusion]
      .filter(Boolean)
      .join(" "),
    ["founder masterclass operator playbook", exclusion]
      .filter(Boolean)
      .join(" "),
  ];
}

export function deriveInstagramExampleHashtags(
  records: ScrapedRecord[],
  brandHint = "",
) {
  const direction = deriveContentDirection(records);
  const hashtags = direction.pillars.flatMap(
    (pillar) => pillar.instagramHashtags,
  );
  const unique = [...new Set(hashtags)].slice(0, 8);
  if (unique.length) return unique;
  const brandTag = brandHint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 30);
  return [
    ...(brandTag ? [brandTag] : []),
    "businesscasestudy",
    "founderstory",
    "studententrepreneur",
  ].slice(0, 8);
}

export function selectAlignedReferences(
  records: ScrapedRecord[],
  limit = 5,
  sourceType?: "youtube" | "instagram",
  brandHint = "",
) {
  const ownedSignals = collectOwnedBrandSignals(records, brandHint);
  const references = records.filter(
    (record) =>
      record.raw.researchRole === "reference" &&
      (!sourceType || record.sourceType === sourceType) &&
      !isOwnedBrandCreative(record, ownedSignals),
  );
  const direction = deriveContentDirection(records);
  const ranked = [...references]
    .map((record) => {
      const pillarAlignment = direction.pillars.reduce(
        (score, pillar) => score + (pillar.pattern.test(record.title) ? 1 : 0),
        0,
      );
      const audienceAlignment = direction.audiences.reduce(
        (score, audience) =>
          score +
          (audience.pattern.test(`${record.title} ${record.subtitle}`) ? 1 : 0),
        0,
      );
      const thematic = pillarAlignment + audienceAlignment;
      const views = contentViews(record);
      return {
        record,
        thematic,
        views,
        // Soft thematic gate + strong reach signal. High views help only when
        // the creative still fits the researched pillars/audience.
        score:
          thematic * 10 +
          contentPerformance(record) * 5 +
          Math.log10(views + 1) * 4,
      };
    });

  const aligned = ranked.filter((item) => item.thematic > 0);
  const pool = (aligned.length >= 3 ? aligned : ranked).sort((left, right) => {
    // Prefer clear view gaps first among thematically aligned creatives.
    if (left.thematic > 0 && right.thematic > 0) {
      const viewGap = Math.log10(right.views + 1) - Math.log10(left.views + 1);
      if (Math.abs(viewGap) >= 0.35) return viewGap > 0 ? 1 : -1;
    }
    return right.score - left.score;
  });

  // If several high-reach aligned creatives exist, surface a few more than five.
  const highReach = pool.filter((item) => {
    const floor = sourceType === "instagram" ? 5_000 : 100_000;
    return item.thematic > 0 && item.views >= floor;
  }).length;
  const effectiveLimit = Math.min(
    pool.length,
    highReach >= 6 ? Math.max(limit, 8) : limit,
  );

  // Prefer distinct creators so the top set is not one channel repeated.
  const selected: ScrapedRecord[] = [];
  const seenCreators = new Set<string>();
  for (const item of pool) {
    const key = creatorKey(item.record);
    if (seenCreators.has(key)) continue;
    seenCreators.add(key);
    selected.push(item.record);
    if (selected.length >= effectiveLimit) break;
  }
  if (selected.length < effectiveLimit) {
    for (const item of pool) {
      if (selected.includes(item.record)) continue;
      selected.push(item.record);
      if (selected.length >= effectiveLimit) break;
    }
  }
  return selected;
}
