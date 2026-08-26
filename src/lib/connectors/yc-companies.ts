import { z } from "zod";
import { clampMaxItems } from "@/lib/utils";
import { firstText, type ScrapedRecord } from "@/lib/normalize";
import type { Connector } from "@/lib/connectors/types";

export const ycCompaniesSchema = z.object({
  query: z.string().optional(),
  batch: z.string().optional(),
  /** Multiple YC seasons (e.g. past-year window). Takes precedence over batch when set. */
  batches: z.array(z.string()).optional(),
  industry: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isHiring: z.boolean().optional(),
  maxItems: z.number().optional(),
  /** Set by the tool-calling YC orchestrator — startJob must not re-pollute. */
  _orchestrated: z.boolean().optional(),
});

export type YcCompaniesInput = z.infer<typeof ycCompaniesSchema>;

/** Apify actor with founders + LinkedIn (fullDetails / extractFounders). */
export const YC_ACTOR_ID = "apivault_labs/yc-companies-scraper";

const STOP_WORDS =
  /\b(yc|y combinator|ycombinator|companies|company|startups?|startup|hiring|hire|hired|looking|find|show|list|get|the|and|for|with|that|who|went|through|from|into|in|on|at|of|to|a|an|current|latest|batch|batches|winter|summer|spring|fall|founders?|linkedin|scope|combinator|research|researched|analyze|analys(?:is|e|ing)|compare|comparing|market|markets|growth|roles?|exact|matching|return|creatives?|please|help|me|us|our|their)\b/gi;

/** Allowed YC directory industry values (Apify vocabulary — not search heuristics). */
export const YC_DIRECTORY_INDUSTRIES = [
  "Fintech",
  "Healthcare",
  "Education",
  "Consumer",
  "B2B",
  "Industrials",
  "Real Estate and Construction",
  "Government",
] as const;

/** Allowed YC directory tag values (Apify vocabulary — not search heuristics). */
export const YC_DIRECTORY_TAGS = [
  "AI",
  "Education",
  "Developer Tools",
  "Marketplace",
  "Crypto",
] as const;

/**
 * Test/heuristic-only aliases. Live YC filters are chosen by the AI tool
 * orchestrator — do not use these to decide production search params.
 */
const INDUSTRY_ALIASES: Array<[RegExp, string]> = [
  [/\bfintech\b|\bfinance\b|\bpayments?\b/i, "Fintech"],
  [/\bhealth ?care\b|\bbiotech\b|\bhealthtech\b/i, "Healthcare"],
  [/\bedtech\b|\beducation\b|\bteaching\b|\bteachers?\b|\bclassroom\b|\bcurriculum\b|\blesson\s*plans?\b|\bassessments?\b|\bschools?\b|\bstudents?\b/i, "Education"],
  [/\bconsumer\b|\bd2c\b|\bb2c\b/i, "Consumer"],
  [/\bb2b\b|\bsaas\b|\benterprise\b/i, "B2B"],
  [/\bclimate\b|\bindustrial/i, "Industrials"],
  [/\breal.?estate\b|\bproptech\b/i, "Real Estate and Construction"],
  [/\bgovernment\b|\bgovtech\b/i, "Government"],
];

const TAG_ALIASES: Array<[RegExp, string]> = [
  [/\bai\b|\bartificial intelligence\b|\bmachine learning\b|\bml\b|\bai-powered\b/i, "AI"],
  [/\bedtech\b|\beducation\b|\bteaching\b|\blesson\b/i, "Education"],
  [/\bdeveloper tools?\b|\bdevtools?\b|\binfra(?:structure)?\b/i, "Developer Tools"],
  [/\bmarketplace\b/i, "Marketplace"],
  [/\bcrypto\b|\bweb3\b|\bblockchain\b/i, "Crypto"],
];

const BATCH_LONG = /\b(winter|summer|spring|fall)\s+(20\d{2})\b/i;
const BATCH_SHORT = /\b([wsf]|sp)(\d{2})\b/i;

export function currentYcBatch(now = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month >= 8) return `Fall ${year}`;
  if (month >= 5) return `Summer ${year}`;
  if (month >= 3) return `Spring ${year}`;
  return `Winter ${year}`;
}

const SEASON_ORDER = ["Winter", "Spring", "Summer", "Fall"] as const;

/** Pure calendar helper — AI tools call this with a count the model chooses. */
export function recentYcBatches(count: number, now = new Date()): string[] {
  const safeCount = Math.min(Math.max(Math.floor(count) || 1, 1), 16);
  const current = currentYcBatch(now);
  const [season, yearRaw] = current.split(" ");
  let seasonIdx = SEASON_ORDER.indexOf(season as (typeof SEASON_ORDER)[number]);
  let year = Number(yearRaw);
  const out: string[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    out.push(`${SEASON_ORDER[seasonIdx]} ${year}`);
    seasonIdx -= 1;
    if (seasonIdx < 0) {
      seasonIdx = SEASON_ORDER.length - 1;
      year -= 1;
    }
  }
  return out;
}

/** All four seasons for a calendar year (Winter → Fall). */
export function ycBatchesForYear(year: number): string[] {
  const y = String(year);
  return [`Winter ${y}`, `Spring ${y}`, `Summer ${y}`, `Fall ${y}`];
}

/**
 * Seasons covering roughly the last N months (4 YC seasons ≈ 12 months).
 * AI passes the time window; this only does calendar math.
 */
export function ycBatchesForMonths(months: number, now = new Date()): string[] {
  const safeMonths = Math.min(Math.max(Math.floor(months) || 1, 1), 48);
  return recentYcBatches(Math.ceil(safeMonths / 3), now);
}

export function parseYcBatch(text: string, now = new Date()): string | undefined {
  if (/\b(current|latest)\s+batch\b|\bcurrent\s+yc\b|\blatest\s+yc\b/i.test(text)) {
    return currentYcBatch(now);
  }
  const long = text.match(BATCH_LONG);
  if (long) {
    const season = long[1][0].toUpperCase() + long[1].slice(1).toLowerCase();
    return `${season} ${long[2]}`;
  }
  const short = text.match(BATCH_SHORT);
  if (short) {
    const code = short[1].toLowerCase();
    const yy = short[2];
    const year = Number(yy) >= 70 ? `19${yy}` : `20${yy}`;
    const season =
      code === "w"
        ? "Winter"
        : code === "s"
          ? "Summer"
          : code === "f"
            ? "Fall"
            : "Spring";
    return `${season} ${year}`;
  }
  return undefined;
}

export function parseYcIndustry(text: string): string | undefined {
  return INDUSTRY_ALIASES.find(([pattern]) => pattern.test(text))?.[1];
}

export function parseYcTags(text: string): string[] {
  return TAG_ALIASES.filter(([pattern]) => pattern.test(text)).map(([, tag]) => tag);
}

/**
 * Topical keywords only. Batch / industry / hiring / YC boilerplate are stripped
 * so the Apify free-text field stays a real search term — or empty when filters
 * already express the request.
 */
export function ycKeywordsFrom(text: string): string {
  const cleaned = text
    .replace(/\bscope\s*:\s*[^\n]*/gi, " ")
    // Drop product-pitch lead-ins ("X is an AI-powered…") so we keep topical nouns.
    .replace(
      /\b[A-Z][A-Za-z0-9.+-]{1,32}\s+is\s+an?\s+[^.!?\n]{0,160}/gi,
      " ",
    )
    .replace(/\b(yc|y combinator|ycombinator)\b/gi, " ")
    .replace(/\b(winter|summer|spring|fall)\s+20\d{2}\b/gi, " ")
    .replace(/\b([wsf]|sp)\d{2}\b/gi, " ")
    .replace(/\b(current|latest)\s+batch\b/gi, " ")
    .replace(/\b(past|last)\s+(one\s+)?year\b/gi, " ")
    .replace(/\b(past|last)\s+\d+\s+years?\b/gi, " ")
    .replace(/\b(past|last)\s+12\s+months?\b/gi, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(STOP_WORDS, " ")
    .replace(/[^\w+#.\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Keep a short topical phrase — long leftovers are pitch debris.
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length <= 4) return cleaned;
  return tokens.slice(0, 4).join(" ");
}

/**
 * Fill missing structured YC filters from the user request. Prefer batch /
 * industry / tags over dumping the raw sentence into `query` (which made the
 * actor return thin, off-batch hits).
 */
export function enrichYcCompaniesInput(
  input: YcCompaniesInput,
  contextQuery = "",
): YcCompaniesInput {
  const context = [input.query, contextQuery].filter(Boolean).join("\n");
  const recentBatches =
    input.batches && input.batches.length > 0 ? input.batches : undefined;
  const batch =
    recentBatches?.[0] || input.batch?.trim() || parseYcBatch(context);
  const industry = input.industry?.trim() || parseYcIndustry(context);
  const isHiring =
    input.isHiring ??
    /\b(hiring|hire|hired|jobs?|roles?|openings?)\b/i.test(context);

  const rawQuery = input.query?.trim() || "";
  const looksLikeSentence =
    !rawQuery ||
    rawQuery.length > 48 ||
    /\b(yc|y combinator|scope:|companies|founders|batch|similar)\b/i.test(
      rawQuery,
    ) ||
    /\b(winter|summer|spring|fall)\s+20\d{2}\b/i.test(rawQuery) ||
    /\bis\s+an?\s+/i.test(rawQuery);

  let query = looksLikeSentence
    ? ycKeywordsFrom(context || rawQuery)
    : ycKeywordsFrom(rawQuery);

  // Industry label duplicated in query is redundant — filters are stronger.
  if (industry && query.toLowerCase() === industry.toLowerCase()) {
    query = "";
  }
  // Drop leftover sentence debris once batch/industry already express the ask.
  if (
    (batch || industry || (recentBatches && recentBatches.length > 0)) &&
    (query.split(/\s+/).filter(Boolean).length > 3 || query.length < 2)
  ) {
    query = "";
  }
  if ((batch || industry) && query.length < 2) {
    query = "";
  }

  const tags = input.tags?.length
    ? input.tags
    : parseYcTags(context);
  return {
    query: query || undefined,
    batch: recentBatches?.length ? undefined : batch || undefined,
    batches: recentBatches?.length ? recentBatches : undefined,
    industry: industry || undefined,
    tags: tags.length ? [...new Set(tags)] : undefined,
    isHiring,
    maxItems: input.maxItems,
  };
}

/**
 * Loosen YC filters when Apify returns zero companies so users still get a
 * useful directory hit instead of an empty succeeded run.
 * Order: clear free-text → drop hiring-only → drop batch (keep industry).
 */

/** Read connector-shaped or actor-shaped job.input into YcCompaniesInput. */
export function ycCompaniesInputFromJobInput(
  input: Record<string, unknown>,
): YcCompaniesInput & { _broadenAttempt?: number; _notice?: string } {
  const batchesFromActor = Array.isArray(input.batches)
    ? input.batches.map(String).map((value) => value.trim()).filter(Boolean)
    : [];
  const industryFromActor = Array.isArray(input.industries)
    ? String(input.industries[0] ?? "").trim()
    : "";
  const maxFromActor =
    typeof input.maxResults === "number"
      ? input.maxResults
      : typeof input.maxItems === "number"
        ? input.maxItems
        : undefined;
  const connectorBatches =
    Array.isArray(input.batches) &&
    !("fullDetails" in input || "maxResults" in input || "extractFounders" in input)
      ? input.batches.map(String).filter(Boolean)
      : [];
  const batches =
    connectorBatches.length > 0
      ? connectorBatches
      : batchesFromActor.length > 0
        ? batchesFromActor
        : undefined;
  return {
    query: typeof input.query === "string" ? input.query : undefined,
    batch:
      (typeof input.batch === "string" && input.batch.trim()) ||
      (batches && batches.length === 1 ? batches[0] : undefined) ||
      undefined,
    batches: batches && batches.length ? batches : undefined,
    industry:
      (typeof input.industry === "string" && input.industry.trim()) ||
      industryFromActor ||
      undefined,
    tags: Array.isArray(input.tags)
      ? input.tags.map(String).filter(Boolean)
      : undefined,
    isHiring: typeof input.isHiring === "boolean" ? input.isHiring : undefined,
    maxItems: maxFromActor,
    _broadenAttempt:
      typeof input._broadenAttempt === "number" ? input._broadenAttempt : undefined,
    _notice: typeof input._notice === "string" ? input._notice : undefined,
  };
}

export function broadenYcCompaniesInput(
  input: YcCompaniesInput,
): { input: YcCompaniesInput; notice: string } | null {
  const query = input.query?.trim();
  if (query) {
    return {
      input: { ...input, query: undefined },
      notice:
        "No companies matched the free-text filter, so the search was broadened to directory filters only.",
    };
  }
  if (input.tags && input.tags.length) {
    return {
      input: { ...input, tags: undefined },
      notice:
        "No companies matched those tags, so the tag filters were removed while keeping industry/batch.",
    };
  }
  if (input.isHiring) {
    return {
      input: { ...input, isHiring: false },
      notice:
        "No companies were marked hiring for those filters, so the hiring-only constraint was removed.",
    };
  }
  if ((input.batch || (input.batches && input.batches.length)) && input.industry) {
    const label = input.batch || input.batches?.join(", ");
    return {
      input: { ...input, batch: undefined, batches: undefined },
      notice: `No companies matched batch ${label}; showing ${input.industry} companies across YC batches instead.`,
    };
  }
  if (input.batch || (input.batches && input.batches.length)) {
    const label = input.batch || input.batches?.join(", ");
    // Keep a residual topical query so we never scrape the entire YC directory.
    return {
      input: {
        ...input,
        batch: undefined,
        batches: undefined,
        query: input.query || "startup",
      },
      notice: `No companies matched batch ${label}; widened beyond that season window.`,
    };
  }
  // Never drop the last industry filter — empty filters scrape the whole directory.
  return null;
}

/**
 * Convert orchestrator/AI filters into the Apify actor payload.
 * Does NOT re-derive filters from free text — the tool orchestrator owns that.
 */
export function prepareYcActorInput(input: YcCompaniesInput) {
  const batches =
    input.batches && input.batches.length > 0
      ? input.batches
      : input.batch
        ? [input.batch]
        : [];
  const filteredTags = (input.tags ?? []).filter(
    (tag) => tag.toLowerCase() !== input.industry?.toLowerCase(),
  );
  const maxItems = clampMaxItems(input.maxItems, 50);
  const query = (input.query ?? "").trim();

  return {
    query: query.split(/\s+/).filter(Boolean).length > 4 ? "" : query,
    batches,
    industries: input.industry ? [input.industry] : [],
    tags: filteredTags,
    isHiring: Boolean(input.isHiring),
    maxResults: maxItems,
    fullDetails: true,
    extractIndustry: true,
    extractBatch: true,
    extractLocation: true,
    extractTeamSize: true,
    extractStatus: true,
    extractSocials: true,
    extractTags: true,
    extractFounders: true,
    extractLongDescription: true,
    extractLogo: true,
  };
}

function companyMeta(raw: Record<string, unknown>) {
  const batch = firstText(raw.batch, raw.batchCode);
  const industry = firstText(
    raw.industry,
    raw.subindustry,
    Array.isArray(raw.industries) ? String(raw.industries[0] ?? "") : "",
  );
  const oneLiner = firstText(
    raw.oneLiner,
    raw.one_liner,
    raw.description,
    raw.longDescription,
  );
  const parts = [batch, industry, oneLiner].filter(Boolean);
  return { batch, industry, oneLiner, subtitle: parts.join(" · ") };
}

export function normalizeYcCompany(raw: Record<string, unknown>): ScrapedRecord {
  const slug = firstText(raw.slug, raw.objectID);
  const meta = companyMeta(raw);
  return {
    sourceType: "yc",
    externalId:
      firstText(raw.companyId, raw.id, raw.objectID, slug, raw.name) || "yc",
    title: firstText(raw.name) || "YC company",
    subtitle: meta.subtitle || meta.oneLiner || meta.industry,
    url:
      firstText(raw.url, raw.ycProfileUrl, raw.ycUrl) ||
      (slug
        ? `https://www.ycombinator.com/companies/${slug}`
        : firstText(raw.website)),
    location: firstText(raw.location, raw.city, raw.country, raw.all_locations),
    imageUrl: firstText(raw.logoUrl, raw.small_logo_thumb_url, raw.logo),
    raw,
  };
}

type FounderRaw = {
  name?: unknown;
  title?: unknown;
  bio?: unknown;
  linkedinUrl?: unknown;
  linkedin?: unknown;
  twitterUrl?: unknown;
  twitter?: unknown;
};

/** Expand YC company founders into LinkedIn-ready profile records. */
export function expandYcFounders(company: ScrapedRecord): ScrapedRecord[] {
  const founders = Array.isArray(company.raw.founders)
    ? (company.raw.founders as FounderRaw[])
    : [];
  const meta = companyMeta(company.raw);
  const out: ScrapedRecord[] = [];

  for (const founder of founders) {
    const name = firstText(founder.name);
    if (!name) continue;
    const linkedin = firstText(founder.linkedinUrl, founder.linkedin);
    const title = firstText(founder.title) || "Founder";
    const bio = firstText(founder.bio);
    out.push({
      sourceType: "profile",
      externalId:
        linkedin ||
        `yc-founder:${company.externalId}:${name.toLowerCase().replace(/\s+/g, "-")}`,
      title: name,
      subtitle: [title, company.title, meta.batch, meta.industry]
        .filter(Boolean)
        .join(" · "),
      url: linkedin,
      location: company.location,
      imageUrl: "",
      raw: {
        researchRole: "yc-founder",
        companyName: company.title,
        companyUrl: company.url,
        companyBatch: meta.batch,
        companyIndustry: meta.industry,
        founderTitle: title,
        bio,
        linkedinUrl: linkedin,
        twitterUrl: firstText(founder.twitterUrl, founder.twitter),
        source: "yc-companies",
      },
    });
  }
  return out;
}

export function ycFounderLinkedInUrls(records: ScrapedRecord[]): string[] {
  const urls = new Set<string>();
  for (const record of records) {
    if (record.sourceType === "profile" && record.url.includes("linkedin.com/in/")) {
      urls.add(record.url);
    }
    if (record.sourceType !== "yc") continue;
    const founders = Array.isArray(record.raw.founders)
      ? (record.raw.founders as FounderRaw[])
      : [];
    for (const founder of founders) {
      const linkedin = firstText(founder.linkedinUrl, founder.linkedin);
      if (linkedin.includes("linkedin.com/in/")) urls.add(linkedin);
    }
  }
  return [...urls];
}

export function ycCompanyNames(records: ScrapedRecord[]): string[] {
  return [
    ...new Set(
      records
        .filter((record) => record.sourceType === "yc" && record.title)
        .map((record) => record.title),
    ),
  ];
}

export function countYcFounderLinkedIns(records: ScrapedRecord[]): number {
  return ycFounderLinkedInUrls(records).length;
}

export const ycCompaniesConnector: Connector<YcCompaniesInput> = {
  id: "yc-companies",
  label: "Y Combinator companies",
  sourceType: "yc",
  kind: "search",
  actorId: YC_ACTOR_ID,
  usdPerThousand: 5,
  capability:
    "Search YC companies via Apify actor apivault_labs/yc-companies-scraper with fullDetails + extractFounders. Draft params lightly (maxItems ~50, isHiring if obvious). Leave batch window, industry, tags, and short query for the YC tool orchestrator — do not invent season lists or industry/tag mappings here. Never put the full user sentence or Scope lines in query. Founders with LinkedIn URLs come back on each company — do not add linkedin-profile-search unless the user asks for deeper LinkedIn-only research.",
  inputSchema: ycCompaniesSchema,
  buildRun(input) {
    const actorInput = prepareYcActorInput(input);
    return {
      executor: "apify",
      actorId: YC_ACTOR_ID,
      maxItems: actorInput.maxResults,
      input: actorInput,
    };
  },
  normalize(raw): ScrapedRecord {
    return normalizeYcCompany(raw);
  },
  costEstimate(input) {
    const actorInput = prepareYcActorInput(input);
    const filterBits = [
      actorInput.batches[0],
      actorInput.industries[0],
      actorInput.tags[0],
      actorInput.query ? `q="${actorInput.query}"` : null,
    ].filter(Boolean);
    return {
      usd: (actorInput.maxResults / 1000) * 5,
      itemCount: actorInput.maxResults,
      note: `YC via Apify · ${filterBits.join(" · ") || "all"}${actorInput.isHiring ? " · hiring only" : ""} · founders+socials`,
    };
  },
};
