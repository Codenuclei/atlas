"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { isTerminalJobStatus } from "@/lib/status";
import { displayStatus, jobStageLabel } from "@/lib/view-model";
import { Button, Card, CardHeader, StatusBadge, cn } from "@/components/ui";

export type JobRow = {
  id: string;
  connectorId: string;
  status: string;
  itemCount: number;
  error: string | null;
};

function LaneStatus({ job }: { job: JobRow }) {
  const status = displayStatus(
    job.status === "succeeded"
      ? "succeeded"
      : job.status === "failed"
        ? "failed"
        : job.status === "aborted"
          ? "aborted"
          : job.status === "timed_out"
            ? "timed_out"
            : "running",
  );
  return <StatusBadge label={status.label} tone={status.tone} />;
}

export function RunStatus({
  jobs,
  queryStatus,
  onStop,
  stopPending,
}: {
  jobs: JobRow[];
  queryStatus: string;
  onStop: () => void;
  stopPending: boolean;
}) {
  const [showTechnical, setShowTechnical] = useState(false);
  const finished = jobs.filter((job) => isTerminalJobStatus(job.status)).length;
  const failed = jobs.filter((job) => job.status === "failed" || job.status === "timed_out");
  const succeeded = jobs.filter((job) => job.status === "succeeded");
  const totalItems = jobs.reduce((sum, job) => sum + job.itemCount, 0);
  const running = queryStatus === "running" || queryStatus === "queued";
  const progress = jobs.length === 0 ? 0 : Math.round((finished / jobs.length) * 100);

  return (
    <Card>
      <CardHeader
        title={running ? "Run in progress" : "Run summary"}
        trailing={
          <span className="tnum text-[11px] text-faint">
            {finished}/{jobs.length} steps · {totalItems} items
          </span>
        }
      />
      <div className="space-y-4 p-4">
        <div className="h-1 overflow-hidden rounded-full bg-white/[.06]">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              failed.length > 0 && !running ? "bg-warning" : "bg-accent",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="divide-y divide-stroke rounded-md border border-stroke">
          {jobs.map((job) => (
            <div key={job.id} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  job.status === "succeeded"
                    ? "bg-success"
                    : job.status === "failed" || job.status === "timed_out"
                      ? "bg-danger"
                      : job.status === "aborted"
                        ? "bg-warning"
                        : "bg-accent animate-pulse-dot",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {jobStageLabel(job.connectorId)}
              </span>
              <span className="tnum text-[11px] text-faint">
                {job.itemCount > 0 ? `${job.itemCount} items` : ""}
              </span>
              <LaneStatus job={job} />
            </div>
          ))}
        </div>

        {failed.length > 0 ? (
          <div className="rounded-lg border border-warning/30 bg-warning-muted px-3.5 py-3 text-xs leading-5">
            <p className="font-medium text-warning">
              {running ? "Partial failure so far" : "Partial result"}
            </p>
            <p className="mt-1 text-muted">
              {failed.map((job) => jobStageLabel(job.connectorId)).join(", ")}{" "}
              {failed.length === 1 ? "failed" : "failed"}
              {succeeded.length > 0
                ? ` — ${succeeded.length} other step${succeeded.length === 1 ? "" : "s"} kept ${totalItems} items.`
                : "."}{" "}
              {failed[0]?.error ? (
                <span className="text-faint">Cause: {failed[0].error}. </span>
              ) : null}
              {!running ? "Use Run again to retry the full plan." : null}
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowTechnical((value) => !value)}
            className="flex items-center gap-1 text-[11px] text-faint transition-colors hover:text-muted"
          >
            <ChevronDown
              className={cn("size-3 transition-transform", showTechnical && "rotate-180")}
            />
            Technical details
          </button>
          {running ? (
            <Button variant="secondary" size="sm" onClick={onStop} disabled={stopPending}>
              {stopPending ? "Stopping…" : `Stop & keep ${totalItems} item${totalItems === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </div>

        {showTechnical ? (
          <pre className="max-h-48 overflow-auto rounded-md border border-stroke bg-background p-3 font-mono text-[11px] leading-5 text-faint">
            {jobs
              .map(
                (job) =>
                  `${job.connectorId.padEnd(28)} ${job.status.padEnd(10)} ${job.itemCount} items${job.error ? `  error: ${job.error}` : ""}`,
              )
              .join("\n")}
          </pre>
        ) : null}
      </div>
    </Card>
  );
}
