"use client";

import { useCallback, useEffect, useState } from "react";
import type { ScrapedRecord } from "@/lib/normalize";
import type { RecordRole } from "@/lib/view-model";

export type SavedCreative = {
  key: string;
  record: ScrapedRecord;
  role: RecordRole;
  queryId: string;
  queryText: string;
  savedAt: string;
};

const STORAGE_KEY = "atlas.collections.v1";

export function creativeKey(record: ScrapedRecord): string {
  return `${record.sourceType}:${record.externalId}`;
}

function readAll(): SavedCreative[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function useCollections() {
  const [saved, setSaved] = useState<SavedCreative[]>([]);

  useEffect(() => {
    setSaved(readAll());
  }, []);

  const toggle = useCallback(
    (creative: Omit<SavedCreative, "key" | "savedAt">) => {
      setSaved((current) => {
        const key = creativeKey(creative.record);
        const exists = current.some((item) => item.key === key);
        const next = exists
          ? current.filter((item) => item.key !== key)
          : [
              { ...creative, key, savedAt: new Date().toISOString() },
              ...current,
            ];
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  const keys = new Set(saved.map((item) => item.key));
  return { saved, keys, toggle };
}
