"use client";

import { useMemo, useState } from "react";
import { ArrowsDownUp, DownloadSimple } from "@phosphor-icons/react";
import type { BoardRecord } from "@/components/creatives-board";
import { Button, cn } from "@/components/ui";
import { recordsToCsv } from "@/lib/export";
import {
  buildYcEvidenceRows,
  YC_EVIDENCE_PAGE_SIZE,
  type YcEvidenceRow,
} from "@/lib/yc-evidence-rows";

type SortKey = "name" | "founders" | "batch" | "industry" | "match";

const SORTABLE: Array<{ id: SortKey; label: string; align?: "right" }> = [
  { id: "name", label: "Company" },
  { id: "founders", label: "Founders" },
  { id: "batch", label: "Batch" },
  { id: "industry", label: "Industry" },
  { id: "match", label: "Match", align: "right" },
];

function sortRows(rows: YcEvidenceRow[], sortKey: SortKey, ascending: boolean) {
  const direction = ascending ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let diff = 0;
    switch (sortKey) {
      case "name":
        diff = a.name.localeCompare(b.name);
        break;
      case "founders":
        diff = a.founders.localeCompare(b.founders);
        break;
      case "batch":
        diff = a.batch.localeCompare(b.batch);
        break;
      case "industry":
        diff = a.industry.localeCompare(b.industry);
        break;
      case "match":
        diff = (a.score ?? 0) - (b.score ?? 0);
        break;
    }
    return diff * direction;
  });
  return sorted;
}

function LinkCell({ href, label }: { href: string; label: string }) {
  if (!href) return <span className="text-faint">—</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="truncate text-accent hover:underline"
    >
      {label}
    </a>
  );
}

export function YcEvidenceTable({
  items,
  queryId,
}: {
  items: BoardRecord[];
  queryId: string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("match");
  const [ascending, setAscending] = useState(false);
  const [visibleCount, setVisibleCount] = useState(YC_EVIDENCE_PAGE_SIZE);

  const allRows = useMemo(() => buildYcEvidenceRows(items), [items]);
  const rows = useMemo(
    () => sortRows(allRows, sortKey, ascending),
    [allRows, sortKey, ascending],
  );
  const visibleRows = rows.slice(0, visibleCount);
  const hasMore = visibleCount < rows.length;

  function toggleSort(key: SortKey) {
    if (key === sortKey) setAscending((value) => !value);
    else {
      setSortKey(key);
      setAscending(key === "name");
    }
  }

  function exportAll() {
    const companyRecords = items
      .filter((item) => item.record.sourceType === "yc")
      .map((item) => item.record);
    const csv = recordsToCsv(companyRecords);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `atlas-yc-evidence-${queryId.slice(0, 8)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-faint">
          {rows.length} YC {rows.length === 1 ? "company" : "companies"}
          {rows.length > visibleRows.length
            ? ` · showing ${visibleRows.length}`
            : ""}
        </p>
        <Button variant="secondary" size="sm" onClick={exportAll}>
          <DownloadSimple size={14} />
          Export all
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stroke">
        <table className="w-full min-w-[1040px] border-collapse text-left">
          <thead className="sticky top-0 bg-elevated">
            <tr className="border-b border-stroke">
              <th className="px-3 py-2 text-[11px] font-medium text-faint">
                <button
                  type="button"
                  onClick={() => toggleSort("name")}
                  className={cn(
                    "inline-flex items-center gap-1 transition-colors hover:text-foreground",
                    sortKey === "name" && "text-foreground",
                  )}
                >
                  Company
                  <ArrowsDownUp size={11} className="opacity-60" />
                </button>
              </th>
              <th className="px-3 py-2 text-[11px] font-medium text-faint">
                <button
                  type="button"
                  onClick={() => toggleSort("founders")}
                  className={cn(
                    "inline-flex items-center gap-1 transition-colors hover:text-foreground",
                    sortKey === "founders" && "text-foreground",
                  )}
                >
                  Founders
                  <ArrowsDownUp size={11} className="opacity-60" />
                </button>
              </th>
              <th className="px-3 py-2 text-[11px] font-medium text-faint">Website</th>
              <th className="px-3 py-2 text-[11px] font-medium text-faint">YC profile</th>
              <th className="px-3 py-2 text-[11px] font-medium text-faint">LinkedIn</th>
              {SORTABLE.slice(2).map((column) => (
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
            {visibleRows.map((row) => (
              <tr
                key={row.key}
                className="border-b border-stroke transition-colors last:border-0 hover:bg-hover"
              >
                <td className="max-w-[220px] px-3 py-2">
                  <div className="truncate text-[13px] font-medium">{row.name}</div>
                  {row.oneLiner ? (
                    <div className="mt-0.5 line-clamp-2 text-[11px] text-faint">
                      {row.oneLiner}
                    </div>
                  ) : null}
                </td>
                <td className="max-w-[180px] px-3 py-2 text-[12px] text-muted">
                  <span className="line-clamp-2">{row.founders}</span>
                </td>
                <td className="max-w-[140px] px-3 py-2 text-[12px]">
                  <LinkCell
                    href={row.website}
                    label={row.website.replace(/^https?:\/\/(www\.)?/, "").slice(0, 28)}
                  />
                </td>
                <td className="max-w-[100px] px-3 py-2 text-[12px]">
                  <LinkCell href={row.ycUrl} label="YC" />
                </td>
                <td className="max-w-[160px] px-3 py-2 text-[12px]">
                  {row.linkedInUrls.length === 0 ? (
                    <span className="text-faint">—</span>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {row.linkedInUrls.slice(0, 3).map((url) => (
                        <LinkCell
                          key={url}
                          href={url}
                          label={url.split("/in/")[1]?.replace(/\/$/, "") ?? "Profile"}
                        />
                      ))}
                      {row.linkedInUrls.length > 3 ? (
                        <span className="text-[11px] text-faint">
                          +{row.linkedInUrls.length - 3} more
                        </span>
                      ) : null}
                    </div>
                  )}
                </td>
                <td className="tnum px-3 py-2 text-[12px]">{row.batch}</td>
                <td className="px-3 py-2 text-[12px]">{row.industry}</td>
                <td className="tnum px-3 py-2 text-right text-[12px]">
                  {row.score != null ? `${Math.round(row.score * 100)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore ? (
        <div className="flex justify-center pt-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setVisibleCount((count) =>
                Math.min(count + YC_EVIDENCE_PAGE_SIZE, rows.length),
              )
            }
          >
            Load more ({rows.length - visibleCount} remaining)
          </Button>
        </div>
      ) : null}
    </div>
  );
}
