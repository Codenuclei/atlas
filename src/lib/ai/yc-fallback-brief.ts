import { logClaude } from "@/lib/ai/claude-log";
import type { ScrapedRecord } from "@/lib/normalize";
import type { Synthesis, SynthesisContext } from "@/lib/ai/synthesize";

const SECTION_HEADERS = [
  "COMPANIES BY INDUSTRY",
  "BATCH SNAPSHOT",
  "REPEATING PATTERNS",
  "EMERGING / NEW PATTERNS",
  "FOUNDERS TO CONTACT",
  "RESEARCH NOTES",
] as const;

const MAX_COMPANIES = 30;

/** Common South Asian given names / surnames for soft nationality heuristics only. */
const SOUTH_ASIAN_NAME_TOKENS = new Set(
  [
    "aaditya",
    "aakash",
    "aarav",
    "abhishek",
    "aditya",
    "agrawal",
    "agarwal",
    "ahmed",
    "ajay",
    "akash",
    "amit",
    "anand",
    "ananya",
    "anika",
    "ankit",
    "anuj",
    "anupam",
    "arjun",
    "arora",
    "aryan",
    "ashish",
    "asif",
    "banerjee",
    "basu",
    "bhat",
    "bhatt",
    "bhattacharya",
    "bose",
    "chakrabarti",
    "chakraborty",
    "chand",
    "chandra",
    "chatterjee",
    "chopra",
    "das",
    "desai",
    "dhar",
    "dutta",
    "gupta",
    "iyer",
    "iyengar",
    "jain",
    "joshi",
    "kapoor",
    "kaur",
    "khan",
    "khanna",
    "kohli",
    "kumar",
    "lahiri",
    "malhotra",
    "mehta",
    "menon",
    "mishra",
    "mukherjee",
    "nair",
    "nayar",
    "neha",
    "pandey",
    "patel",
    "pillai",
    "prakash",
    "prasad",
    "priya",
    "rahul",
    "raj",
    "raja",
    "rajesh",
    "ramesh",
    "ramaswamy",
    "rao",
    "reddy",
    "rohan",
    "saha",
    "saini",
    "sanjay",
    "sanjana",
    "saxena",
    "sen",
    "shah",
    "sharma",
    "shukla",
    "singh",
    "sinha",
    "srinivasan",
    "subramanian",
    "suresh",
    "thakur",
    "varma",
    "verma",
    "vijay",
    "vikram",
    "virat",
    "vishnu",
    "yadav",
  ].map((s) => s.toLowerCase()),
);

const INDIA_LOCATION_RE =
  /\b(india|indian|bangalore|bengaluru|mumbai|delhi|new delhi|hyderabad|chennai|pune|kolkata|gurgaon|gurugram|noida|ahmedabad|jaipur|iit|nit|bits)\b/i;

const STOP_QUERY_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "yc",
  "ycombinator",
  "companies",
  "company",
  "startups",
  "startup",
  "founders",
  "founder",
  "looking",
  "find",
  "show",
  "list",
  "get",
  "who",
  "that",
  "have",
  "has",
  "are",
  "is",
  "was",
  "were",
]);

const KEYWORD_CLUSTERS: Array<{ label: string; pattern: RegExp }> = [
  { label: "AI / ML", pattern: /\b(ai|artificial intelligence|machine learning|\bml\b|llm|generative)\b/i },
  { label: "Infrastructure", pattern: /\b(infra(?:structure)?|devops|cloud|platform|developer tools?|devtools?)\b/i },
  { label: "Marketplace", pattern: /\b(marketplace|two-sided|network effects?)\b/i },
  { label: "Fintech / payments", pattern: /\b(fintech|payments?|banking|lending|billing)\b/i },
  { label: "Healthcare", pattern: /\b(health ?care|biotech|healthtech|clinical)\b/i },
  { label: "B2B SaaS", pattern: /\b(b2b|saas|enterprise|workflow)\b/i },
  { label: "Crypto / web3", pattern: /\b(crypto|web3|blockchain|defi)\b/i },
  { label: "Education", pattern: /\b(edtech|education|learning|students?)\b/i },
];

export type IndiaSignal = {
  matched: boolean;
  reasons: string[];
  /** Soft label only — never assert nationality. */
  caveat: string;
};

export type FounderInfo = {
  name: string;
  title?: string;
  bio?: string;
  linkedinUrl?: string;
};

export type ScoredYcCompany = {
  record: ScrapedRecord;
  name: string;
  industry: string;
  batch: string;
  oneLiner: string;
  website: string;
  ycUrl: string;
  teamSize?: number;
  status: string;
  location: string;
  founders: FounderInfo[];
  score: number;
  reasons: string[];
  india: IndiaSignal;
};

export type YcPattern = {
  name: string;
  detail: string;
  examples: string[];
};

function textField(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function parseFounders(value: unknown): FounderInfo[] {
  if (!Array.isArray(value)) return [];
  const out: FounderInfo[] = [];
  for (const founder of value) {
    if (!founder || typeof founder !== "object") continue;
    const raw = founder as Record<string, unknown>;
    const name = textField(raw.name);
    if (!name) continue;
    out.push({
      name,
      title: textField(raw.title) || undefined,
      bio: textField(raw.bio) || undefined,
      linkedinUrl: textField(raw.linkedinUrl, raw.linkedin) || undefined,
    });
  }
  return out;
}

function companyFields(record: ScrapedRecord) {
  const raw = record.raw;
  const founders =
    record.sourceType === "yc"
      ? parseFounders(raw.founders)
      : [
          {
            name: record.title,
            title: textField(raw.founderTitle) || undefined,
            bio: textField(raw.bio) || undefined,
            linkedinUrl: textField(raw.linkedinUrl, record.url) || undefined,
          },
        ];
  const name =
    record.sourceType === "yc"
      ? record.title
      : textField(raw.companyName) || record.title;
  const industry = textField(
    raw.industry,
    raw.companyIndustry,
    record.sourceType === "yc" ? undefined : raw.companyIndustry,
  );
  const batch = textField(raw.batch, raw.companyBatch);
  const oneLiner = textField(
    raw.oneLiner,
    raw.one_liner,
    raw.description,
    raw.companyOneLiner,
    record.subtitle,
  );
  const website = textField(raw.website, raw.companyWebsite);
  const ycUrl = textField(
    raw.ycUrl,
    raw.ycProfileUrl,
    raw.companyYcUrl,
    raw.companyUrl,
    /ycombinator\.com\/companies\//i.test(record.url) ? record.url : "",
  );
  const teamSizeRaw = raw.teamSize ?? raw.team_size ?? raw.companyTeamSize;
  const teamSize =
    typeof teamSizeRaw === "number" && Number.isFinite(teamSizeRaw)
      ? teamSizeRaw
      : undefined;
  const status = textField(raw.status, raw.companyStatus);
  const location = textField(record.location, raw.location, raw.all_locations);

  return {
    name,
    industry: industry || "Uncategorized",
    batch: batch || "Unknown",
    oneLiner,
    website,
    ycUrl,
    teamSize,
    status,
    location,
    founders: founders.filter((f) => f.name),
  };
}

export function detectIndiaSignals(input: {
  names?: string[];
  bios?: string[];
  locations?: string[];
}): IndiaSignal {
  const reasons: string[] = [];
  const names = input.names ?? [];
  const bios = input.bios ?? [];
  const locations = input.locations ?? [];

  for (const name of names) {
    const tokens = name
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean);
    const hits = tokens.filter((t) => SOUTH_ASIAN_NAME_TOKENS.has(t));
    if (hits.length) {
      reasons.push(`name token(s) ${hits.join(", ")} match common South Asian name patterns`);
    }
  }

  for (const bio of bios) {
    if (INDIA_LOCATION_RE.test(bio)) {
      const match = bio.match(INDIA_LOCATION_RE)?.[0];
      reasons.push(`bio mentions ${match ?? "India-related term"}`);
    }
  }

  for (const location of locations) {
    if (INDIA_LOCATION_RE.test(location)) {
      const match = location.match(INDIA_LOCATION_RE)?.[0];
      reasons.push(`location mentions ${match ?? "India-related term"}`);
    }
  }

  const matched = reasons.length > 0;
  return {
    matched,
    reasons,
    caveat: matched
      ? "name/location signal suggests possible India connection (heuristic only — not verified nationality)"
      : "no India-related name/location signals in evidence",
  };
}

export type QueryIntent = {
  tokens: string[];
  wantsIndia: boolean;
  wantsHiring: boolean;
  wantsAi: boolean;
  preferRecent: boolean;
  years: number[];
  industryHints: string[];
};

export function parseQueryIntent(query: string): QueryIntent {
  const lower = query.toLowerCase();
  const tokens = (lower.match(/[a-z0-9]{2,}/g) ?? []).filter(
    (t) => !STOP_QUERY_WORDS.has(t),
  );
  const years = [...lower.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  const preferRecent =
    /last\s+2\s+years|past\s+2\s+years|recent|2024|2025|2026/i.test(query) ||
    years.some((y) => y >= 2024);
  const industryHints: string[] = [];
  for (const cluster of KEYWORD_CLUSTERS) {
    if (cluster.pattern.test(query)) industryHints.push(cluster.label);
  }
  if (/\bfintech\b/i.test(query)) industryHints.push("Fintech");
  if (/\bhealth/i.test(query)) industryHints.push("Healthcare");
  if (/\beducation|edtech\b/i.test(query)) industryHints.push("Education");
  if (/\bconsumer\b/i.test(query)) industryHints.push("Consumer");
  if (/\bb2b|saas\b/i.test(query)) industryHints.push("B2B");

  return {
    tokens: [...new Set(tokens)],
    wantsIndia: /\bindian?\b|\bindia\b/i.test(query),
    wantsHiring: /\bhiring|hire|jobs?\b/i.test(query),
    wantsAi: /\bai\b|artificial intelligence|machine learning|\bml\b/i.test(query),
    preferRecent,
    years,
    industryHints: [...new Set(industryHints)],
  };
}

function batchYear(batch: string): number | null {
  const m = batch.match(/(20\d{2})/);
  return m ? Number(m[1]) : null;
}

function isRecentBatch(batch: string, now = new Date()): boolean {
  const year = batchYear(batch);
  if (year == null) return false;
  // Roughly last ~8 YC seasons ≈ 2 years.
  return year >= now.getFullYear() - 2;
}

export function scoreYcCompanyRelevance(
  query: string,
  record: ScrapedRecord,
): ScoredYcCompany {
  const intent = parseQueryIntent(query);
  const fields = companyFields(record);
  const india = detectIndiaSignals({
    names: fields.founders.map((f) => f.name),
    bios: fields.founders.map((f) => f.bio ?? "").filter(Boolean),
    locations: [fields.location, ...fields.founders.map((f) => f.bio ?? "")].filter(
      Boolean,
    ),
  });

  let score = 0.35;
  const reasons: string[] = [];
  const haystack = [
    fields.name,
    fields.industry,
    fields.oneLiner,
    fields.batch,
    fields.location,
    ...fields.founders.flatMap((f) => [f.name, f.title ?? "", f.bio ?? ""]),
  ]
    .join(" ")
    .toLowerCase();

  let tokenHits = 0;
  for (const token of intent.tokens) {
    if (token.length < 3) continue;
    if (haystack.includes(token)) {
      tokenHits += 1;
      score += 0.06;
    }
  }
  if (tokenHits) {
    reasons.push(`matched query terms (${tokenHits})`);
  }

  if (intent.industryHints.length) {
    const industryLower = fields.industry.toLowerCase();
    const oneLinerLower = fields.oneLiner.toLowerCase();
    for (const hint of intent.industryHints) {
      const key = hint.toLowerCase().split(/[^a-z]+/)[0] ?? "";
      if (
        industryLower.includes(key) ||
        oneLinerLower.includes(key) ||
        KEYWORD_CLUSTERS.find((c) => c.label === hint)?.pattern.test(
          `${fields.industry} ${fields.oneLiner}`,
        )
      ) {
        score += 0.12;
        reasons.push(`industry/one-liner aligns with ${hint}`);
        break;
      }
    }
  }

  if (intent.wantsAi && /\b(ai|ml|llm|machine learning)\b/i.test(haystack)) {
    score += 0.1;
    reasons.push("AI-related language in evidence");
  }

  if (intent.wantsHiring && /hiring|isHiring|jobs/i.test(JSON.stringify(record.raw))) {
    score += 0.05;
    reasons.push("hiring signal in evidence");
  }

  if (intent.wantsIndia && india.matched) {
    score += 0.28;
    reasons.push(india.caveat);
  } else if (intent.wantsIndia && !india.matched) {
    score -= 0.05;
  }

  if (intent.preferRecent) {
    const year = batchYear(fields.batch);
    if (year != null) {
      if (intent.years.some((y) => y === year) || year >= 2024) {
        score += 0.14;
        reasons.push(`batch ${fields.batch} matches recent-window preference`);
      } else if (year < 2022) {
        score -= 0.08;
        reasons.push(`older batch ${fields.batch} deprioritized for recent query`);
      }
    }
  }

  if (!reasons.length) {
    reasons.push("present in YC evidence set for this query");
  }

  score = Math.max(0.05, Math.min(0.99, score));

  return {
    record,
    ...fields,
    score,
    reasons,
    india,
  };
}

export function groupByIndustry(
  companies: ScoredYcCompany[],
): Map<string, ScoredYcCompany[]> {
  const groups = new Map<string, ScoredYcCompany[]>();
  const sorted = [...companies].sort((a, b) => b.score - a.score);
  for (const company of sorted) {
    const key = company.industry || "Uncategorized";
    const list = groups.get(key) ?? [];
    list.push(company);
    groups.set(key, list);
  }
  // Order industries by best company score inside the group.
  return new Map(
    [...groups.entries()].sort((a, b) => {
      const aMax = a[1][0]?.score ?? 0;
      const bMax = b[1][0]?.score ?? 0;
      return bMax - aMax;
    }),
  );
}

function teamSizeBand(size?: number): string | null {
  if (size == null || !Number.isFinite(size)) return null;
  if (size <= 5) return "1–5";
  if (size <= 15) return "6–15";
  if (size <= 50) return "16–50";
  if (size <= 200) return "51–200";
  return "200+";
}

export function extractPatterns(companies: ScoredYcCompany[]): YcPattern[] {
  const patterns: YcPattern[] = [];

  // CEO/CTO co-title pairs
  const ceoCtoExamples: string[] = [];
  for (const company of companies) {
    const titles = company.founders.map((f) => (f.title ?? "").toLowerCase());
    const hasCeo = titles.some((t) => /\bceo\b|chief executive/.test(t));
    const hasCto = titles.some((t) => /\bcto\b|chief technology/.test(t));
    if (hasCeo && hasCto) ceoCtoExamples.push(company.name);
  }
  if (ceoCtoExamples.length >= 2) {
    patterns.push({
      name: "CEO + CTO founding pairs",
      detail: `${ceoCtoExamples.length} companies list both CEO and CTO titles among founders, suggesting a common commercial/technical split.`,
      examples: ceoCtoExamples.slice(0, 4),
    });
  }

  // Industry concentration
  const industryCounts = new Map<string, ScoredYcCompany[]>();
  for (const company of companies) {
    const list = industryCounts.get(company.industry) ?? [];
    list.push(company);
    industryCounts.set(company.industry, list);
  }
  const topIndustries = [...industryCounts.entries()]
    .filter(([name]) => name !== "Uncategorized")
    .sort((a, b) => b[1].length - a[1].length);
  if (topIndustries[0] && topIndustries[0][1].length >= 2) {
    const [name, list] = topIndustries[0];
    patterns.push({
      name: `${name} concentration`,
      detail: `${list.length} of ${companies.length} companies fall in ${name}, the densest industry bucket in this evidence set.`,
      examples: list.slice(0, 4).map((c) => c.name),
    });
  }
  if (topIndustries[1] && topIndustries[1][1].length >= 2) {
    const [name, list] = topIndustries[1];
    patterns.push({
      name: `${name} secondary cluster`,
      detail: `${list.length} companies also cluster in ${name}.`,
      examples: list.slice(0, 3).map((c) => c.name),
    });
  }

  // One-liner keyword clusters
  for (const cluster of KEYWORD_CLUSTERS) {
    const hits = companies.filter((c) =>
      cluster.pattern.test(`${c.oneLiner} ${c.industry} ${c.name}`),
    );
    if (hits.length >= 2) {
      patterns.push({
        name: `${cluster.label} language`,
        detail: `${hits.length} companies use ${cluster.label.toLowerCase()} wording in name, industry, or one-liner.`,
        examples: hits.slice(0, 4).map((c) => c.name),
      });
    }
    if (patterns.length >= 6) break;
  }

  // Geography clusters
  const geo = new Map<string, ScoredYcCompany[]>();
  for (const company of companies) {
    const loc = company.location.trim();
    if (!loc) continue;
    const key = loc.split(",")[0]?.trim() || loc;
    const list = geo.get(key) ?? [];
    list.push(company);
    geo.set(key, list);
  }
  const topGeo = [...geo.entries()].sort((a, b) => b[1].length - a[1].length);
  if (topGeo[0] && topGeo[0][1].length >= 2) {
    patterns.push({
      name: `${topGeo[0][0]} geography cluster`,
      detail: `${topGeo[0][1].length} companies share a ${topGeo[0][0]} location label in evidence.`,
      examples: topGeo[0][1].slice(0, 4).map((c) => c.name),
    });
  }

  // Team size bands
  const bands = new Map<string, ScoredYcCompany[]>();
  for (const company of companies) {
    const band = teamSizeBand(company.teamSize);
    if (!band) continue;
    const list = bands.get(band) ?? [];
    list.push(company);
    bands.set(band, list);
  }
  const topBand = [...bands.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (topBand && topBand[1].length >= 2) {
    patterns.push({
      name: `Team size band ${topBand[0]}`,
      detail: `${topBand[1].length} companies report team size in the ${topBand[0]} range.`,
      examples: topBand[1].slice(0, 4).map((c) => c.name),
    });
  }

  // Deduplicate by name, keep 3–6
  const seen = new Set<string>();
  const unique: YcPattern[] = [];
  for (const pattern of patterns) {
    if (seen.has(pattern.name)) continue;
    if (pattern.examples.length < 2) continue;
    seen.add(pattern.name);
    unique.push(pattern);
    if (unique.length >= 6) break;
  }
  return unique.slice(0, 6);
}

function emergingPatterns(companies: ScoredYcCompany[]): string[] {
  const recent = companies.filter((c) => isRecentBatch(c.batch));
  const older = companies.filter((c) => !isRecentBatch(c.batch));
  if (recent.length < 2 || older.length < 2) {
    return [
      "- Evidence set is too thin to compare recent (~last 8 seasons / ~2 years) vs older cohorts with confidence. Need more labeled batches on both sides of the cut.",
    ];
  }

  const lines: string[] = [];
  const mix = (list: ScoredYcCompany[]) => {
    const counts = new Map<string, number>();
    for (const c of list) {
      counts.set(c.industry, (counts.get(c.industry) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };
  const recentMix = mix(recent);
  const olderMix = mix(older);
  lines.push(
    `- Industry mix shift: recent cohorts lean ${recentMix
      .slice(0, 3)
      .map(([n, c]) => `${n} (${c})`)
      .join(", ") || "unclear"}; older set leans ${olderMix
      .slice(0, 3)
      .map(([n, c]) => `${n} (${c})`)
      .join(", ") || "unclear"}.`,
  );

  const aiDensity = (list: ScoredYcCompany[]) =>
    list.filter((c) =>
      /\b(ai|ml|llm|machine learning)\b/i.test(`${c.oneLiner} ${c.industry}`),
    ).length;
  const recentAi = aiDensity(recent);
  const olderAi = aiDensity(older);
  lines.push(
    `- AI density: ${recentAi}/${recent.length} recent vs ${olderAi}/${older.length} older companies show AI/ML language in industry/one-liner.`,
  );

  const geoRecent = recent.filter((c) => c.location).length;
  const geoOlder = older.filter((c) => c.location).length;
  lines.push(
    `- Geography coverage: ${geoRecent}/${recent.length} recent and ${geoOlder}/${older.length} older rows carry location labels — compare only where present.`,
  );

  const indiaRecent = recent.filter((c) => c.india.matched).length;
  const indiaOlder = older.filter((c) => c.india.matched).length;
  if (indiaRecent + indiaOlder > 0) {
    lines.push(
      `- India-related heuristic signals: ${indiaRecent}/${recent.length} recent vs ${indiaOlder}/${older.length} older (name/location signals only).`,
    );
  }

  return lines;
}

function whyIncluded(company: ScoredYcCompany, intent: QueryIntent): string {
  const bits = [...company.reasons];
  if (intent.wantsIndia && company.india.matched) {
    bits.unshift(company.india.caveat);
  }
  return bits.slice(0, 2).join("; ");
}

function founderLinkage(company: ScoredYcCompany): string {
  if (!company.founders.length) return "founder linkage: evidence missing";
  return company.founders
    .map((f) => {
      const bioSnippet = f.bio
        ? f.bio.length > 110
          ? `${f.bio.slice(0, 107)}...`
          : f.bio
        : "";
      return [
        f.name,
        f.title ? `(${f.title})` : null,
        bioSnippet ? `bio: ${bioSnippet}` : null,
        f.linkedinUrl ? `LinkedIn: ${f.linkedinUrl}` : null,
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join("; ");
}

function howTheyGotHere(company: ScoredYcCompany): string {
  const parts = [
    company.batch !== "Unknown" ? `batch ${company.batch}` : null,
    company.teamSize != null ? `teamSize ${company.teamSize}` : null,
    company.status ? `status ${company.status}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "path details not in evidence";
}

function batchSnapshot(companies: ScoredYcCompany[]): string[] {
  const batches = new Map<string, number>();
  for (const company of companies) {
    batches.set(company.batch, (batches.get(company.batch) ?? 0) + 1);
  }
  const lines = [...batches.entries()]
    .sort((a, b) => {
      const ay = batchYear(a[0]) ?? 0;
      const by = batchYear(b[0]) ?? 0;
      if (by !== ay) return by - ay;
      return b[1] - a[1];
    })
    .map(([batch, count]) => `- ${batch}: ${count} companies`);

  const recent = companies.filter((c) => isRecentBatch(c.batch)).length;
  const older = companies.length - recent;
  lines.push(
    `- Cohort mix: ${recent} recent (~last 2 years / ~8 seasons) vs ${older} older in this scored set.`,
  );

  const geo = new Map<string, number>();
  for (const company of companies) {
    if (!company.location) continue;
    const key = company.location.split(",")[0]?.trim() || company.location;
    geo.set(key, (geo.get(key) ?? 0) + 1);
  }
  if (geo.size) {
    const top = [...geo.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([loc, n]) => `${loc} (${n})`)
      .join(", ");
    lines.push(`- Geography labels present: ${top}.`);
  } else {
    lines.push("- Geography: no location fields present in evidence.");
  }
  return lines.length ? lines : ["- No batch labels in evidence."];
}

function foundersToContact(
  companies: ScoredYcCompany[],
  intent: QueryIntent,
): string[] {
  type Candidate = {
    founder: FounderInfo;
    company: ScoredYcCompany;
    rank: number;
  };
  const candidates: Candidate[] = [];
  for (const company of companies) {
    for (const founder of company.founders) {
      if (!founder.linkedinUrl) continue;
      let rank = company.score;
      if (intent.wantsIndia) {
        const signal = detectIndiaSignals({
          names: [founder.name],
          bios: [founder.bio ?? ""],
          locations: [company.location, founder.bio ?? ""],
        });
        if (signal.matched) rank += 0.2;
      }
      if (/\bceo|cto|founder|co-founder\b/i.test(founder.title ?? "")) {
        rank += 0.05;
      }
      candidates.push({ founder, company, rank });
    }
  }
  candidates.sort((a, b) => b.rank - a.rank);
  const picked: Candidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.founder.linkedinUrl || candidate.founder.name;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(candidate);
    if (picked.length >= 10) break;
  }
  const min = Math.min(6, picked.length);
  const list = picked.slice(0, Math.max(min, Math.min(10, picked.length)));
  if (!list.length) {
    return ["- No founder LinkedIn URLs in evidence."];
  }
  return list.map(({ founder, company }) => {
    const indiaNote =
      intent.wantsIndia &&
      detectIndiaSignals({
        names: [founder.name],
        bios: [founder.bio ?? ""],
        locations: [company.location],
      }).matched
        ? " Name/location signal suggests possible India connection (heuristic only)."
        : "";
    const role = founder.title || "Founder";
    const wedge = company.oneLiner || company.industry || "YC company";
    return `- **${founder.name}** — ${role}, ${company.name} — ${founder.linkedinUrl}. Why: ${role} on ${company.name} (${wedge}); query fit via score ${company.score.toFixed(2)} (${company.reasons[0] ?? "evidence match"}).${indiaNote}`;
  });
}

function researchNotes(
  query: string,
  intent: QueryIntent,
  reason: string,
  companies: ScoredYcCompany[],
): string[] {
  const notes: string[] = [];
  if (/credit|billing|402/i.test(reason)) {
    notes.push(
      "Claude brief generation failed because Anthropic API credits are exhausted (or billing blocked the request). This digest is a deterministic research-quality fallback — add credits at console.anthropic.com, then Regenerate brief for a Claude-written brief.",
    );
  } else if (reason && reason !== "unknown") {
    notes.push(
      `Claude brief generation was unavailable (${reason}). This is a deterministic evidence digest with heuristic ranking — regenerate when Claude is available for a fuller narrative brief.`,
    );
  }

  notes.push(
    "Nationality / “Indian founders” is not an Apify YC actor filter. Any India linkage here uses soft name and location/bio heuristics only — never treat as verified citizenship or ethnicity.",
  );

  if (intent.wantsIndia) {
    const withSignal = companies.filter((c) => c.india.matched).length;
    notes.push(
      `For query "${query}": ${withSignal}/${companies.length} scored companies carry India-related name/location signals; absence of a signal does not prove non-Indian founders.`,
    );
  }

  const missingOneLiners = companies.filter((c) => !c.oneLiner).length;
  if (missingOneLiners) {
    notes.push(
      `${missingOneLiners} companies lack one-liners in evidence — product descriptions may be incomplete.`,
    );
  }

  notes.push(
    "Follow-up angles: verify founder LinkedIn locations manually; filter by batch year in the actor; cross-check India signals against public bios; regenerate with Claude once credits/models are available for deeper pattern narrative.",
  );

  return notes.map((n) => `- ${n}`);
}

/**
 * Deterministic research-quality YC brief used when Claude is unavailable
 * (credits, model errors) or as a structured digest of evidence.
 */
export function buildYcFallbackBrief(
  query: string,
  records: ScrapedRecord[],
  reason = "unknown",
  context: SynthesisContext = {},
): Synthesis {
  logClaude("score_results.fallback_yc", {
    queryId: context.queryId,
    trigger: context.trigger,
    reason,
    recordCount: records.length,
  });

  const intent = parseQueryIntent(query);
  const companyRecords = records.filter((r) => r.sourceType === "yc");
  const founderRecords = records.filter(
    (r) =>
      r.sourceType === "profile" &&
      (r.raw.researchRole === "yc-founder" || r.raw.source === "yc-companies"),
  );

  // Prefer company rows; attach orphan founder profiles as pseudo-companies if needed.
  let scored = companyRecords.map((record) =>
    scoreYcCompanyRelevance(query, record),
  );

  if (!scored.length && founderRecords.length) {
    scored = founderRecords.map((record) => scoreYcCompanyRelevance(query, record));
  }

  // Merge founder profiles into matching companies when present as separate rows.
  const byName = new Map(scored.map((c) => [c.name.toLowerCase(), c]));
  for (const founderRec of founderRecords) {
    const companyName = textField(founderRec.raw.companyName).toLowerCase();
    const target = byName.get(companyName);
    if (!target) continue;
    const info: FounderInfo = {
      name: founderRec.title,
      title: textField(founderRec.raw.founderTitle) || undefined,
      bio: textField(founderRec.raw.bio) || undefined,
      linkedinUrl:
        textField(founderRec.raw.linkedinUrl, founderRec.url) || undefined,
    };
    if (!target.founders.some((f) => f.name === info.name)) {
      target.founders.push(info);
    }
    // Recompute India signals after merge.
    target.india = detectIndiaSignals({
      names: target.founders.map((f) => f.name),
      bios: target.founders.map((f) => f.bio ?? "").filter(Boolean),
      locations: [target.location],
    });
    if (intent.wantsIndia && target.india.matched) {
      target.score = Math.min(0.99, target.score + 0.05);
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, MAX_COMPANIES);
  const grouped = groupByIndustry(top);

  const companySection: string[] = [
    `Deterministic research digest for "${query}" — ${top.length} companies ranked by heuristic relevance (${companyRecords.length} company rows, ${founderRecords.length} founder profiles in evidence).`,
    "",
  ];

  if (!top.length) {
    companySection.push("- No company records in evidence.");
  } else {
    for (const [industry, list] of grouped) {
      companySection.push(`### ${industry}`);
      for (const company of list) {
        const links = [company.website, company.ycUrl].filter(Boolean).join(" · ");
        companySection.push(
          `- **${company.name}** — Why included: ${whyIncluded(company, intent)}; What it does: ${company.oneLiner || "one-liner not in evidence"}; Founder linkage: ${founderLinkage(company)}; How they got here: ${howTheyGotHere(company)}${links ? `; Links: ${links}` : ""}.`,
        );
      }
      companySection.push("");
    }
  }

  const patterns = extractPatterns(top);
  const patternLines = patterns.length
    ? patterns.map(
        (p) =>
          `- **${p.name}**: ${p.detail} Examples: ${p.examples.join(", ")}.`,
      )
    : [
        "- Not enough overlapping evidence to compute cross-cutting patterns (need ≥2 companies sharing a signal).",
      ];

  const summary = [
    SECTION_HEADERS[0],
    "",
    ...companySection,
    SECTION_HEADERS[1],
    "",
    ...batchSnapshot(top),
    "",
    SECTION_HEADERS[2],
    "",
    ...patternLines,
    "",
    SECTION_HEADERS[3],
    "",
    ...emergingPatterns(top),
    "",
    SECTION_HEADERS[4],
    "",
    ...foundersToContact(top, intent),
    "",
    SECTION_HEADERS[5],
    "",
    ...researchNotes(query, intent, reason, top),
  ].join("\n");

  return {
    scores: top.map((company) => ({
      externalId: company.record.externalId,
      score: Number(company.score.toFixed(3)),
      reason: company.reasons[0]?.slice(0, 120) || "Heuristic YC relevance",
    })),
    summary,
  };
}
