import type { ScrapedRecord } from "@/lib/normalize";

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function linkedinSlug(url: string): string {
  const match = url.match(
    /linkedin\.com\/(?:in|company|jobs\/view)\/([^/?#]+)/i,
  );
  return match?.[1]?.toLowerCase() ?? "";
}

export function mergeKeyFor(record: ScrapedRecord): string {
  const slug = linkedinSlug(record.url);
  if (slug) return `${record.sourceType}:${slug}`;
  const name = normalizeName(record.title);
  if (name) return `${record.sourceType}:${name}`;
  return `${record.sourceType}:${record.externalId}`;
}

export function extractLinkedInUrls(
  records: ScrapedRecord[],
  kind: "profile" | "company",
): string[] {
  const prefix =
    kind === "profile"
      ? "https://www.linkedin.com/in/"
      : "https://www.linkedin.com/company/";
  const urls = new Set<string>();
  for (const record of records) {
    if (record.url.includes("linkedin.com")) {
      if (kind === "profile" && record.url.includes("/in/")) urls.add(record.url);
      if (kind === "company" && record.url.includes("/company/")) urls.add(record.url);
    } else if (record.sourceType === "yc" && kind === "company" && record.title) {
      urls.add(record.title);
    } else if (record.title && !record.url) {
      urls.add(`${prefix}${normalizeName(record.title).replaceAll(" ", "-")}`);
    }
  }
  return [...urls];
}

export function mergeRecords(existing: ScrapedRecord, incoming: ScrapedRecord): ScrapedRecord {
  return {
    sourceType: existing.sourceType || incoming.sourceType,
    externalId: existing.externalId || incoming.externalId,
    title: existing.title || incoming.title,
    subtitle: incoming.subtitle.length > existing.subtitle.length ? incoming.subtitle : existing.subtitle,
    url: existing.url || incoming.url,
    location: existing.location || incoming.location,
    imageUrl: existing.imageUrl || incoming.imageUrl,
    score: incoming.score ?? existing.score,
    raw: { ...existing.raw, ...incoming.raw, _merged: true },
  };
}

export function dedupeRecords(records: ScrapedRecord[]): ScrapedRecord[] {
  const byKey = new Map<string, ScrapedRecord>();
  for (const record of records) {
    const key = mergeKeyFor(record);
    const previous = byKey.get(key);
    byKey.set(key, previous ? mergeRecords(previous, record) : record);
  }
  return [...byKey.values()];
}
