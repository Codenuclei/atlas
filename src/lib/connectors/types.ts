import type { z } from "zod";
import type { ScrapedRecord, SourceType } from "@/lib/normalize";

export const CONNECTOR_IDS = [
  "linkedin-profile-search",
  "linkedin-company-search",
  "linkedin-jobs",
  "yc-companies",
  "linkedin-profile",
  "linkedin-company",
  "youtube-content",
  "instagram-content",
  "youtube-content-examples",
  "instagram-content-examples",
] as const;

export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export type ConnectorKind = "search" | "detail";
export type ExecutorKind = "apify";

export type CostEstimate = {
  usd: number;
  itemCount: number;
  note: string;
};

export type PreparedRun = {
  executor: ExecutorKind;
  actorId?: string;
  input: Record<string, unknown>;
  maxItems?: number;
};

export type Connector<TInput = unknown> = {
  id: ConnectorId;
  label: string;
  sourceType: SourceType;
  kind: ConnectorKind;
  capability: string;
  actorId?: string;
  usdPerThousand: number;
  inputSchema: z.ZodType<TInput>;
  buildRun: (input: TInput) => PreparedRun;
  normalize: (raw: Record<string, unknown>) => ScrapedRecord;
  costEstimate: (input: TInput) => CostEstimate;
};

// Registry values are heterogeneous; inputs are validated per-connector at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyConnector = Connector<any>;
