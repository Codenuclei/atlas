import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isTestMode() {
  return (
    process.env.SCRAPER_TEST_MODE === "1" || process.env.NODE_ENV === "test"
  );
}

export function maxItemsCap() {
  const parsed = Number(process.env.MAX_ITEMS_CAP ?? 100);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
}

export function maxQueryCostUsd() {
  const parsed = Number(process.env.MAX_QUERY_COST_USD ?? 5);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

export function clampMaxItems(value: unknown, fallback = 25) {
  const n = typeof value === "number" ? value : Number(value);
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  return Math.min(safe, maxItemsCap());
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export function pickString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function pickNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}
