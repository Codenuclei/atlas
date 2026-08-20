"use client";

import { useMemo, useState } from "react";
import type { ScrapedRecord } from "@/lib/normalize";
import {
  engagementOf,
  isContentRecord,
  roleForConnector,
  type RecordRole,
} from "@/lib/view-model";
import { CreativeCard } from "@/components/creative-card";
import { EmptyState, SectionHeading, cn } from "@/components/ui";

export type BoardRecord = {
  record: ScrapedRecord;
  role: RecordRole;
  jobId?: string;
};

type SortId = "match" | "views" | "engagement" | "newest";

const SORTS: Array<{ id: SortId; label: string }> = [
  { id: "match", label: "Best match" },
  { id: "views", label: "Most views" },
  { id: "engagement", label: "Engagement rate" },
  { id: "newest", label: "Newest" },
];

function sortRecords(items: BoardRecord[], sort: SortId): BoardRecord[] {
  const sorted = [...items];
  switch (sort) {
    case "views":
      sorted.sort((a, b) => engagementOf(b.record).views - engagementOf(a.record).views);
      break;
    case "engagement":
      sorted.sort((a, b) => engagementOf(b.record).rate - engagementOf(a.record).rate);
      break;
    case "newest":
      sorted.sort((a, b) => {
        const at = new Date(engagementOf(a.record).publishedAt || 0).getTime();
        const bt = new Date(engagementOf(b.record).publishedAt || 0).getTime();
        return bt - at;
      });
      break;
    default:
      sorted.sort((a, b) => (b.record.score ?? 0) - (a.record.score ?? 0));
  }
  return sorted;
}

export function CreativesBoard({
  items,
  queryId,
  savedKeys,
  onToggleSave,
}: {
  items: BoardRecord[];
  queryId: string;
  savedKeys: Set<string>;
  onToggleSave: (item: BoardRecord) => void;
}) {
  const [platform, setPlatform] = useState<"all" | "youtube" | "instagram">("all");
  const [role, setRole] = useState<"all" | "owned" | "external">("all");
  const [sort, setSort] = useState<SortId>("match");

  const content = useMemo(
    () => items.filter((item) => isContentRecord(item.record)),
    [items],
  );
  const owned = content.filter((item) => item.role === "owned");
  const external = content.filter((item) => item.role !== "owned");

  const counts = {
    youtube: external.filter((i) => i.record.sourceType === "youtube").length,
    instagram: external.filter((i) => i.record.sourceType === "instagram").length,
  };

  const visible = useMemo(() => {
    let pool = role === "owned" ? owned : role === "external" ? external : content;
    if (platform !== "all") {
      pool = pool.filter((item) => item.record.sourceType === platform);
    }
    return sortRecords(pool, sort);
  }, [content, owned, external, platform, role, sort]);

  if (content.length === 0) {
    return (
      <EmptyState
        title="No creatives matched yet"
        body="YouTube and Instagram creatives stream in as the matching steps finish. If the run is complete, try widening the date range or removing platform limits in a rerun."
      />
    );
  }

  return (
    <section className="space-y-5">
      {owned.length > 0 ? (
        <div className="space-y-2">
          <SectionHeading
            title="Owned evidence"
            meta={`${owned.length} from your channels`}
          />
          <div className="flex gap-3 overflow-x-auto pb-1">
            {owned.map((item) => (
              <div key={item.record.externalId} className="w-56 shrink-0">
                <CreativeCard
                  record={item.record}
                  role={item.role}
                  href={`/queries/${queryId}/creative/${encodeURIComponent(item.record.externalId)}`}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <SectionHeading
          title="External matching creatives"
          meta={`${external.length} matched`}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-stroke">
            {(
              [
                ["all", `All ${external.length}`],
                ["youtube", `YouTube ${counts.youtube}`],
                ["instagram", `Instagram ${counts.instagram}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPlatform(id)}
                className={cn(
                  "h-7 px-2.5 text-xs transition-colors first:rounded-l-md last:rounded-r-md",
                  platform === id
                    ? "bg-white/[.08] font-medium text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex rounded-md border border-stroke">
            {(
              [
                ["all", "All evidence"],
                ["owned", "Owned"],
                ["external", "External"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setRole(id)}
                className={cn(
                  "h-7 px-2.5 text-xs transition-colors first:rounded-l-md last:rounded-r-md",
                  role === id
                    ? "bg-white/[.08] font-medium text-foreground"
                    : "text-muted hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="ml-auto flex items-center gap-2 text-xs text-faint">
            Sort
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortId)}
              className="h-7 rounded-md border border-stroke bg-transparent px-1.5 text-xs text-foreground"
            >
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            title={`No ${platform === "all" ? "" : platform === "youtube" ? "YouTube " : "Instagram "}${role === "all" ? "" : role + " "}matches`}
            body="Try a different platform tab, or widen the date range on a rerun."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((item) => (
              <CreativeCard
                key={`${item.record.sourceType}-${item.record.externalId}`}
                record={item.record}
                role={item.role}
                href={`/queries/${queryId}/creative/${encodeURIComponent(item.record.externalId)}`}
                selected={savedKeys.has(`${item.record.sourceType}:${item.record.externalId}`)}
                onToggleSelect={() => onToggleSave(item)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function boardRecordsFrom(
  records: ScrapedRecord[],
  resultJobIds: string[],
  jobs: Array<{ id: string; connectorId: string }>,
): BoardRecord[] {
  const connectorByJob = new Map(jobs.map((job) => [job.id, job.connectorId]));
  return records.map((record, index) => {
    const jobId = resultJobIds[index];
    const connectorId = jobId ? connectorByJob.get(jobId) : undefined;
    return { record, role: roleForConnector(connectorId), jobId };
  });
}
