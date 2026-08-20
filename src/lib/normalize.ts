export const SOURCE_TYPES = [
  "profile",
  "company",
  "job",
  "yc",
  "youtube",
  "instagram",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type ScrapedRecord = {
  sourceType: SourceType;
  externalId: string;
  title: string;
  subtitle: string;
  url: string;
  location: string;
  imageUrl: string;
  score?: number;
  raw: Record<string, unknown>;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = asText(value).trim();
    if (text) return text;
  }
  return "";
}

/** Make scraped strings safe for SQLite JSON columns (broken \\u escapes, null bytes). */
export function sanitizeForSqliteJson<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, nested) => {
      if (typeof nested !== "string") return nested;
      return nested
        .replace(/\u0000/g, "")
        .replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u")
        .replace(/[\uD800-\uDFFF]/g, "");
    }),
  ) as T;
}

export function nestedText(
  obj: Record<string, unknown>,
  path: string[],
): string {
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return asText(current);
}
