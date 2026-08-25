"use client";

import { useMemo, useState } from "react";
import { ArrowsDownUp, DownloadSimple } from "@phosphor-icons/react";
import type { ScrapedRecord } from "@/lib/normalize";
import { recordsToCsv } from "@/lib/export";
import {
  engagementOf,
  formatAge,
  formatCompact,
  formatRate,
  platformLabel,
  type RecordRole,
} from "@/lib/view-model";
import { Button, RoleBadge, cn } from "@/components/ui";
import type { BoardRecord } from "@/components/creatives-board";

type SortKey = "title" | "views" | "rate" | "comments" | "age" | "match";

const COLUMNS: Array<{ id: SortKey; label: string; align?: "right" }> = [
  { id: "title", label: "Record" },
  { id: "views", label: "Views / Batch", align: "right" },
  { id: "rate", label: "Eng. / Industry", align: "right" },
  { id: "comments", label: "Comments", align: "right" },
  { id: "age", label: "Age / Loc", align: "right" },
  { id: "match", label: "Match", align: "right" },
];

function ycMetaLeft(record: ScrapedRecord): string {
  if (record.sourceType === "yc") {
    return String(record.raw.batch ?? record.raw.batchCode ?? "—");
  }
  if (record.sourceType === "profile") {
    return String(record.raw.companyBatch ?? "—");
  }
  return "—";
}

function ycMetaMid(record: ScrapedRecord): string {
  if (record.sourceType === "yc") {
    const industry =
      firstRawText(record.raw.industry) ||
      firstRawText(record.raw.subindustry) ||
      (Array.isArray(record.raw.industries)
        ? firstRawText(record.raw.industries[0])
        : "");
    return industry || "—";
  }
  if (record.sourceType === "profile") {
    return (
      firstRawText(record.raw.companyIndustry) ||
      firstRawText(record.raw.founderTitle) ||
      "—"
    );
  }
  return "—";
}

function firstRawText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function EvidenceTable({
  items,
  queryId,
}: {
  items: BoardRecord[];
  queryId: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("match");
  const [ascending, setAscending] = useState(false);
  const [compact, setCompact] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    const sorted = [...items];
    const direction = ascending ? 1 : -1;
    sorted.sort((a, b) => {
      const ea = engagementOf(a.record);
      const eb = engagementOf(b.record);
      let diff = 0;
      switch (sortKey) {
        case "title":
          diff = a.record.title.localeCompare(b.record.title);
          break;
        case "views":
          diff = ea.views - eb.views;
          break;
        case "rate":
          diff = ea.rate - eb.rate;
          break;
        case "comments":
          diff = ea.comments - eb.comments;
          break;
        case "age":
          diff =
            new Date(ea.publishedAt || 0).getTime() -
            new Date(eb.publishedAt || 0).getTime();
          break;
        case "match":
          diff = (a.record.score ?? 0) - (b.record.score ?? 0);
          break;
      }
      return diff * direction;
    });
    return sorted;
  }, [items, sortKey, ascending]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAscending((value) => !value);
    } else {
      setSortKey(key);
      setAscending(key === "title");
    }
  }

  function keyOf(item: BoardRecord) {
    return `${item.record.sourceType}:${item.record.externalId}`;
  }

  function toggleRow(item: BoardRecord) {
    setSelected((current) => {
      const next = new Set(current);
      const key = keyOf(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportSelection() {
    const chosen =
      selected.size === 0
        ? rows
        : rows.filter((item) => selected.has(keyOf(item)));
    const csv = recordsToCsv(chosen.map((item) => item.record));
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `atlas-evidence-${queryId.slice(0, 8)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-faint">
          {selected.size > 0
            ? `${selected.size} selected`
            : `${rows.length} records`}
        </p>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted">
            <input
              type="checkbox"
              checked={compact}
              onChange={(event) => setCompact(event.target.checked)}
              className="size-3 accent-accent"
            />
            Compact
          </label>
          <Button variant="secondary" size="sm" onClick={exportSelection}>
            <DownloadSimple size={14} />
            {selected.size > 0 ? "Export selected" : "Export all"}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stroke">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 bg-elevated">
            <tr className="border-b border-stroke">
              <th className="w-8 px-3 py-2" />
              {COLUMNS.map((column) => (
                <th
                  key={column.id}
                  className={cn(
                    "px-3 py-2 text-[11px] font-medium text-faint",
                    column.align === "right" && "text-right",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(column.id)}
                    className={cn(
                      "inline-flex items-center gap-1 transition-colors hover:text-foreground",
                      sortKey === column.id && "text-foreground",
                    )}
                  >
                    {column.label}
                    <ArrowsDownUp size={11} className="opacity-60" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((item, index) => {
              const engagement = engagementOf(item.record);
              const key = keyOf(item);
              return (
                <tr
                  key={key}
                  className={cn(
                    "border-b border-stroke transition-colors last:border-0 hover:bg-hover",
                    compact && index % 2 === 1 && "bg-zebra",
                    selected.has(key) && "bg-accent-muted",
                  )}
                >
                  <td className={cn("px-3", compact ? "py-1" : "py-2")}>
                    <input
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => toggleRow(item)}
                      aria-label={`Select ${item.record.title}`}
                      className="size-3 accent-accent"
                    />
                  </td>
                  <td className={cn("max-w-0 px-3", compact ? "py-1" : "py-2")}>
                    <div className="block">
                      {item.record.sourceType === "profile" &&
                      item.record.url.includes("linkedin.com") ? (
                        <a
                          href={item.record.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate text-[13px] font-medium text-accent hover:underline"
                        >
                          {item.record.title || "Untitled"}
                        </a>
                      ) : (
                        <a
                          href={`/queries/${queryId}/creative/${encodeURIComponent(item.record.externalId)}`}
                          className="block truncate text-[13px] font-medium hover:text-accent"
                        >
                          {item.record.title || "Untitled"}
                        </a>
                      )}
                      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                        {platformLabel(item.record)}
                        <RoleBadge role={item.role} />
                        {item.record.sourceType === "yc" ? (
                          <span className="truncate">{item.record.subtitle}</span>
                        ) : engagement.creator ? (
                          <span className="truncate">{engagement.creator}</span>
                        ) : null}
                      </span>
                      {item.record.sourceType === "profile" &&
                      item.record.url.includes("linkedin.com") ? (
                        <a
                          href={item.record.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 block truncate text-[11px] text-accent/80 hover:underline"
                        >
                          Open LinkedIn profile
                        </a>
                      ) : null}
                    </div>
                  </td>
                  <td className={cn("tnum px-3 text-right text-[12px]", compact ? "py-1" : "py-2")}>
                    {item.record.sourceType === "yc" ||
                    item.record.sourceType === "profile"
                      ? ycMetaLeft(item.record)
                      : formatCompact(engagement.views)}
                  </td>
                  <td className={cn("tnum px-3 text-right text-[12px]", compact ? "py-1" : "py-2")}>
                    {item.record.sourceType === "yc" ||
                    item.record.sourceType === "profile"
                      ? ycMetaMid(item.record)
                      : formatRate(engagement.rate)}
                  </td>
                  <td className={cn("tnum px-3 text-right text-[12px]", compact ? "py-1" : "py-2")}>
                    {item.record.sourceType === "yc" ||
                    item.record.sourceType === "profile"
                      ? "—"
                      : formatCompact(engagement.comments)}
                  </td>
                  <td className={cn("tnum px-3 text-right text-[12px] text-muted", compact ? "py-1" : "py-2")}>
                    {item.record.sourceType === "yc" ||
                    item.record.sourceType === "profile"
                      ? item.record.location || "—"
                      : formatAge(engagement.publishedAt) || "—"}
                  </td>
                  <td className={cn("tnum px-3 text-right text-[12px]", compact ? "py-1" : "py-2")}>
                    {item.record.score != null
                      ? `${Math.round(item.record.score * 100)}%`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
