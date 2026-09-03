import type { ScrapedRecord } from "@/lib/normalize";

/** Client-safe view helpers shared by the run workspace, board, and table. */

export type RecordRole = "owned" | "external" | "reference";

const OWNED_CONNECTORS = new Set(["youtube-content", "instagram-content"]);
const EXTERNAL_CONNECTORS = new Set([
  "youtube-content-examples",
  "instagram-content-examples",
]);

export function roleForConnector(connectorId: string | undefined): RecordRole {
  if (!connectorId) return "reference";
  if (OWNED_CONNECTORS.has(connectorId)) return "owned";
  if (EXTERNAL_CONNECTORS.has(connectorId)) return "external";
  return "reference";
}

export function isContentRecord(record: ScrapedRecord): boolean {
  return record.sourceType === "youtube" || record.sourceType === "instagram";
}

export function platformLabel(record: ScrapedRecord): string {
  if (record.sourceType === "youtube") return "YouTube";
  if (record.sourceType === "instagram") return "Instagram";
  if (record.sourceType === "yc") return "YC";
  if (record.sourceType === "job") return "LinkedIn Jobs";
  if (record.sourceType === "company") return "LinkedIn";
  if (record.sourceType === "profile") return "LinkedIn";
  return record.sourceType;
}

function numericMetric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const match = value.replaceAll(",", "").trim().toLowerCase().match(/^([\d.]+)\s*([kmb])?/);
  if (!match) return 0;
  const multiplier =
    match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : match[2] === "b" ? 1_000_000_000 : 1;
  return Number(match[1]) * multiplier;
}

export type Engagement = {
  views: number;
  likes: number;
  comments: number;
  /** Interactions per view, 0 when views unknown. Comparable across platforms. */
  rate: number;
  publishedAt: string;
  creator: string;
};

export function engagementOf(record: ScrapedRecord): Engagement {
  const raw = record.raw ?? {};
  const views = numericMetric(
    raw.viewCount ?? raw.views ?? raw.videoViewCount ?? raw.videoPlayCount,
  );
  const likes = numericMetric(raw.likes ?? raw.likeCount ?? raw.likesCount);
  const comments = numericMetric(raw.commentsCount ?? raw.commentCount ?? raw.comments);
  const publishedAt =
    String(raw.date ?? raw.publishedAt ?? raw.timestamp ?? raw.takenAt ?? "") || "";
  const creator =
    String(raw.channelName ?? raw.channelTitle ?? raw.ownerUsername ?? raw.username ?? "") ||
    record.subtitle;
  return {
    views,
    likes,
    comments,
    rate: views > 0 ? (likes + comments) / views : 0,
    publishedAt,
    creator,
  };
}

export function formatCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
  return `${(value / 1_000_000_000).toFixed(1)}B`;
}

export function formatRate(rate: number): string {
  if (rate <= 0) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatAge(iso: string): string {
  if (!iso) return "";
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return "";
  const days = Math.max(0, Math.round((Date.now() - time) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export type StatusTone = "neutral" | "active" | "success" | "warning" | "danger";

export type DisplayStatus = { label: string; tone: StatusTone };

/**
 * One status vocabulary across run, history, and detail. "Partial" is
 * first-class: a terminal run where some jobs succeeded and some failed.
 */
export function displayStatus(
  status: string,
  jobs?: Array<{ status: string }>,
  itemCount?: number,
): DisplayStatus {
  switch (status) {
    case "planning":
    case "awaiting_confirmation":
      return { label: "Planning", tone: "neutral" };
    case "queued":
      return { label: "Queued", tone: "neutral" };
    case "running": {
      const anyMatching = jobs?.some(
        (job) => job.status === "succeeded" || job.status === "running",
      );
      return { label: anyMatching ? "Matching" : "Scanning", tone: "active" };
    }
    case "succeeded":
      if (itemCount === 0) {
        return { label: "No matches", tone: "warning" };
      }
      return { label: "Complete", tone: "success" };
    case "failed": {
      const anySucceeded = jobs?.some((job) => job.status === "succeeded");
      return anySucceeded
        ? { label: "Partial", tone: "warning" }
        : { label: "Failed", tone: "danger" };
    }
    case "aborted":
      return { label: "Stopped", tone: "warning" };
    case "timed_out":
      return { label: "Timed out", tone: "danger" };
    default:
      return { label: status, tone: "neutral" };
  }
}

export function jobStageLabel(connectorId: string): string {
  switch (connectorId) {
    case "youtube-content":
      return "Owned YouTube";
    case "instagram-content":
      return "Owned Instagram";
    case "youtube-content-examples":
      return "External YouTube";
    case "instagram-content-examples":
      return "External Instagram";
    case "linkedin-profile-search":
      return "LinkedIn profile search";
    case "linkedin-profile":
      return "LinkedIn profiles";
    case "linkedin-company-search":
      return "LinkedIn company search";
    case "linkedin-company":
      return "LinkedIn companies";
    case "linkedin-jobs":
      return "LinkedIn jobs";
    case "yc-companies":
      return "YC companies";
    default:
      return connectorId;
  }
}

export function platformOfConnector(connectorId: string): "youtube" | "instagram" | "other" {
  if (connectorId.includes("youtube")) return "youtube";
  if (connectorId.includes("instagram")) return "instagram";
  return "other";
}

export function isContentConnector(connectorId: string): boolean {
  return platformOfConnector(connectorId) !== "other";
}

/** True when every job step is yc-companies (YC-only research run). */
export function isYcOnlyQuery(jobs: Array<{ connectorId: string }>): boolean {
  if (!jobs.length) return false;
  return jobs.every((job) => job.connectorId === "yc-companies");
}

export type WorkspaceTab = "creatives" | "brief" | "evidence";

/** Landing tab: creatives only when the run is actually a social-content search. */
export function defaultWorkspaceTab(input: {
  hasContentRecords: boolean;
  hasEvidence: boolean;
  hasContentJobs: boolean;
  running: boolean;
}): WorkspaceTab {
  if (input.hasContentRecords) return "creatives";
  if (input.hasEvidence) return "evidence";
  if (input.running && input.hasContentJobs) return "creatives";
  if (input.running) return "evidence";
  return "brief";
}
