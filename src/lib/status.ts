export const QUERY_STATUSES = [
  "planning",
  "awaiting_confirmation",
  "queued",
  "running",
  "succeeded",
  "failed",
  "aborted",
  "timed_out",
] as const;

export type QueryStatus = (typeof QUERY_STATUSES)[number];

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "aborting",
  "aborted",
  "timing_out",
  "timed_out",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

const APIFY_STATUS_MAP: Record<string, JobStatus> = {
  READY: "running",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  ABORTING: "aborting",
  ABORTED: "aborted",
  "TIMING-OUT": "timing_out",
  "TIMED-OUT": "timed_out",
};

export function mapApifyStatus(status: string): JobStatus {
  return APIFY_STATUS_MAP[status] ?? "running";
}

export function isTerminalJobStatus(status: string): boolean {
  return ["succeeded", "failed", "aborted", "timed_out"].includes(status);
}

export function isTerminalQueryStatus(status: string): boolean {
  return ["succeeded", "failed", "aborted", "timed_out"].includes(status);
}

export function isActiveJobStatus(status: string): boolean {
  return ["queued", "running", "aborting", "timing_out"].includes(status);
}

export function deriveQueryStatus(jobStatuses: string[]): QueryStatus {
  if (jobStatuses.length === 0) return "queued";
  if (jobStatuses.some((status) => status === "running" || status === "queued")) {
    return "running";
  }
  if (jobStatuses.some((status) => status === "aborting")) return "running";
  if (jobStatuses.every((status) => status === "succeeded")) return "succeeded";
  if (jobStatuses.every((status) => status === "aborted")) return "aborted";
  if (jobStatuses.every((status) => status === "timed_out" || status === "aborted")) {
    return "timed_out";
  }
  if (jobStatuses.some((status) => status === "failed" || status === "timed_out")) {
    return "failed";
  }
  return "running";
}
