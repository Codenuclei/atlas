import type { ScrapedRecord } from "@/lib/normalize";

const CSV_COLUMNS = [
  "sourceType",
  "externalId",
  "title",
  "subtitle",
  "url",
  "location",
  "imageUrl",
  "score",
] as const;

function csvEscape(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Prevent spreadsheet formula execution when a CSV is opened in Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function recordsToCsv(records: ScrapedRecord[]): string {
  const header = [...CSV_COLUMNS, "raw"].join(",");
  const rows = records.map((record) =>
    [
      ...CSV_COLUMNS.map((column) => csvEscape(record[column])),
      csvEscape(record.raw),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

export function recordsToJson(records: ScrapedRecord[]): string {
  return JSON.stringify(records, null, 2);
}

export function resultRowsToRecords(
  rows: Array<{ sourceType: string; externalId: string; score: number | null; data: unknown }>,
): ScrapedRecord[] {
  return rows.map((row) => {
    const data = (row.data ?? {}) as ScrapedRecord;
    return {
      sourceType: (data.sourceType ?? row.sourceType) as ScrapedRecord["sourceType"],
      externalId: data.externalId ?? row.externalId,
      title: data.title ?? "",
      subtitle: data.subtitle ?? "",
      url: safeExternalUrl(data.url),
      location: data.location ?? "",
      imageUrl: data.imageUrl ?? "",
      score: row.score ?? data.score,
      raw: data.raw ?? {},
    };
  });
}

export function safeExternalUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}
