"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, SectionHeading, StatusBadge, cn } from "@/components/ui";
import { displayStatus, formatAge, jobStageLabel } from "@/lib/view-model";

type RunRow = {
  id: string;
  text: string;
  status: string;
  costEstimateUsd: number;
  createdAt: string;
  jobs?: Array<{ connectorId: string; status: string; itemCount: number }>;
};

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "succeeded", label: "Complete" },
  { id: "failed", label: "Partial / Failed" },
  { id: "running", label: "In progress" },
] as const;

export default function HistoryPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/queries")
      .then((response) => response.json())
      .then((payload) => setRuns(payload.queries ?? []))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const visible = useMemo(() => {
    return runs.filter((run) => {
      if (statusFilter === "succeeded" && run.status !== "succeeded") return false;
      if (
        statusFilter === "failed" &&
        !["failed", "timed_out", "aborted"].includes(run.status)
      )
        return false;
      if (
        statusFilter === "running" &&
        !["running", "queued", "planning", "awaiting_confirmation"].includes(run.status)
      )
        return false;
      if (search && !run.text.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [runs, statusFilter, search]);

  // Flag queries that were run more than once — reruns are usually accidents.
  const duplicateTexts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const run of runs) {
      const key = run.text.trim().toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()].filter(([, count]) => count > 1).map(([text]) => text),
    );
  }, [runs]);

  return (
    <main className="space-y-5">
      <SectionHeading
        title="Run history"
        meta={`${runs.length} run${runs.length === 1 ? "" : "s"}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-stroke">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setStatusFilter(filter.id)}
              className={cn(
                "h-7 px-2.5 text-xs transition-colors first:rounded-l-md last:rounded-r-md",
                statusFilter === filter.id
                  ? "bg-white/[.08] font-medium text-foreground"
                  : "text-muted hover:text-foreground",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search queries…"
          className="h-7 w-56 rounded-md border border-stroke bg-transparent px-2 text-xs placeholder:text-faint focus:outline-none"
        />
      </div>

      {!loaded ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-lg bg-white/[.04]" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={runs.length === 0 ? "No runs yet" : "No runs match this filter"}
          body={
            runs.length === 0
              ? "Runs are recorded here with their status, platform coverage, and item counts."
              : "Try a different status filter or search term."
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-stroke">
          {visible.map((run) => {
            const status = displayStatus(run.status, run.jobs);
            const items = (run.jobs ?? []).reduce((sum, job) => sum + job.itemCount, 0);
            const isDuplicate = duplicateTexts.has(run.text.trim().toLowerCase());
            return (
              <button
                key={run.id}
                onClick={() => router.push(`/queries/${run.id}`)}
                className="flex w-full items-center justify-between gap-4 border-b border-stroke px-4 py-3 text-left transition-colors last:border-0 hover:bg-white/[.03]"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium">{run.text}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
                    <span>
                      {[...new Set((run.jobs ?? []).map((job) => jobStageLabel(job.connectorId)))]
                        .slice(0, 3)
                        .join(" · ") || "—"}
                    </span>
                    <span className="tnum">{items} items</span>
                    <span className="tnum">${run.costEstimateUsd.toFixed(2)}</span>
                    <span>{formatAge(run.createdAt)}</span>
                    {isDuplicate ? (
                      <span className="rounded border border-warning/40 px-1 py-px text-[10px] text-warning">
                        duplicate query
                      </span>
                    ) : null}
                  </p>
                </div>
                <StatusBadge label={status.label} tone={status.tone} />
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}
