import { z } from "zod";
import { CONNECTOR_IDS } from "@/lib/connectors/types";

export const INTENT_VALUES = [
  "people",
  "companies",
  "jobs",
  "content",
  "mixed",
] as const;

export const scrapeStepSchema = z.object({
  connectorId: z.string().min(1).max(64),
  params: z.record(z.string().max(64), z.unknown()),
  dependsOn: z.array(z.string().min(1).max(64)).max(5),
  purpose: z.string().min(1).max(240),
});

export const scrapePlanSchema = z.object({
  interpretation: z.string().min(1).max(600),
  intent: z.enum(INTENT_VALUES),
  steps: z.array(scrapeStepSchema).min(1).max(6),
  expectedResultType: z.enum(INTENT_VALUES),
  clarificationNeeded: z.string().max(400),
});

export type ScrapeStep = z.infer<typeof scrapeStepSchema>;
export type ScrapePlan = z.infer<typeof scrapePlanSchema>;

export function coerceIntent(value: string): (typeof INTENT_VALUES)[number] {
  const normalized = value.toLowerCase();
  if (normalized.includes("job")) return "jobs";
  if (normalized.includes("people") || normalized.includes("profile")) return "people";
  if (
    normalized.includes("content") ||
    normalized.includes("youtube") ||
    normalized.includes("instagram")
  ) {
    return "content";
  }
  if (normalized.includes("compan") || normalized.includes("yc")) return "companies";
  if (normalized.includes("mix")) return "mixed";
  return "mixed";
}

export const CONNECTOR_ID_SET = new Set<string>(CONNECTOR_IDS);
