import type { ScrapedRecord } from "@/lib/normalize";
import { companyMeta, ycCompanyLinks } from "@/lib/connectors/yc-companies";
import type { BoardRecord } from "@/components/creatives-board";

export type YcEvidenceRow = {
  key: string;
  name: string;
  oneLiner: string;
  founders: string;
  website: string;
  ycUrl: string;
  linkedInUrls: string[];
  batch: string;
  industry: string;
  score: number | null;
};

type FounderRaw = {
  name?: unknown;
  linkedinUrl?: unknown;
  linkedin?: unknown;
};

function textField(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function isYcFounderProfile(record: ScrapedRecord): boolean {
  return (
    record.sourceType === "profile" &&
    (record.raw.researchRole === "yc-founder" ||
      record.raw.source === "yc-companies")
  );
}

function founderNamesFromRaw(raw: Record<string, unknown>): string[] {
  if (!Array.isArray(raw.founders)) return [];
  return (raw.founders as FounderRaw[])
    .map((founder) => textField(founder.name))
    .filter(Boolean);
}

function linkedInFromRaw(raw: Record<string, unknown>): string[] {
  const urls = new Set<string>();
  if (!Array.isArray(raw.founders)) return [];
  for (const founder of raw.founders as FounderRaw[]) {
    const url = textField(founder.linkedinUrl, founder.linkedin);
    if (url.includes("linkedin.com")) urls.add(url);
  }
  return [...urls];
}

function profileKeyForCompany(record: ScrapedRecord): string {
  return (
    textField(record.raw.companyYcUrl, record.raw.companyUrl, record.raw.companyName) ||
    record.title
  );
}

function companyKey(record: ScrapedRecord): string {
  const links = ycCompanyLinks(record.raw);
  return (
    textField(record.raw.ycUrl, links.ycUrl, record.externalId, record.title) ||
    record.title
  );
}

/** Map YC company board rows (+ optional founder profiles) into table rows. */
export function buildYcEvidenceRows(items: BoardRecord[]): YcEvidenceRow[] {
  const companies = items.filter((item) => item.record.sourceType === "yc");
  const profiles = items.filter((item) => isYcFounderProfile(item.record));

  const profilesByCompany = new Map<string, ScrapedRecord[]>();
  for (const profile of profiles) {
    const key = profileKeyForCompany(profile.record);
    const bucket = profilesByCompany.get(key) ?? [];
    bucket.push(profile.record);
    profilesByCompany.set(key, bucket);
  }

  return companies.map((item) => {
    const record = item.record;
    const meta = companyMeta(record.raw);
    const links = ycCompanyLinks(record.raw);
    const key = companyKey(record);
    const linkedProfiles =
      profilesByCompany.get(key) ??
      profilesByCompany.get(textField(record.title)) ??
      [];

    const founderNames = [
      ...new Set([
        ...founderNamesFromRaw(record.raw),
        ...linkedProfiles.map((profile) => profile.title).filter(Boolean),
      ]),
    ];
    const linkedInUrls = [
      ...new Set([
        ...linkedInFromRaw(record.raw),
        ...linkedProfiles
          .map((profile) => profile.url)
          .filter((url) => url.includes("linkedin.com")),
      ]),
    ];

    return {
      key,
      name: record.title,
      oneLiner: meta.oneLiner || record.subtitle || "",
      founders: founderNames.join(", ") || "—",
      website: links.website,
      ycUrl: links.ycUrl || textField(record.raw.ycUrl),
      linkedInUrls,
      batch: meta.batch || "—",
      industry: meta.industry || "—",
      score: record.score ?? null,
    };
  });
}

export const YC_EVIDENCE_PAGE_SIZE = 50;
