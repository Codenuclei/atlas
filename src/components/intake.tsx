"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button, cn } from "@/components/ui";

export type IntakeValues = {
  query: string;
  platforms: "both" | "youtube" | "instagram";
  dateRange: "30" | "90" | "365";
  ownedHandles: string;
};

const TEMPLATES = [
  {
    label: "Analyze a channel",
    query: "Analyze content for Masters Union across YouTube and Instagram",
    platforms: "both" as const,
    ownedHandles: "@MastersUnion",
  },
  {
    label: "Find external creatives",
    query: "Find high-performing external creatives about AI education for founders",
    platforms: "both" as const,
    ownedHandles: "",
  },
  {
    label: "Compare a market",
    query: "Research YC fintech companies hiring for growth roles",
    platforms: "both" as const,
    ownedHandles: "",
  },
];

/** Compose the planner input from structured intake values. */
export function composeQuery(values: IntakeValues): string {
  const parts = [values.query.trim()];
  const scope: string[] = [];
  if (values.platforms !== "both") {
    scope.push(values.platforms === "youtube" ? "YouTube only" : "Instagram only");
  }
  if (values.dateRange !== "365") {
    scope.push(`last ${values.dateRange} days`);
  }
  if (values.ownedHandles.trim()) {
    scope.push(`owned channels: ${values.ownedHandles.trim()}`);
  }
  if (scope.length) parts.push(`Scope: ${scope.join("; ")}.`);
  return parts.join("\n\n");
}

export function ResearchIntake({
  onSubmit,
  pending,
}: {
  onSubmit: (values: IntakeValues) => void;
  pending: boolean;
}) {
  const [values, setValues] = useState<IntakeValues>({
    query: "",
    platforms: "both",
    dateRange: "90",
    ownedHandles: "",
  });

  function applyTemplate(template: (typeof TEMPLATES)[number]) {
    setValues((current) => ({
      ...current,
      query: template.query,
      platforms: template.platforms,
      ownedHandles: template.ownedHandles,
    }));
  }

  const valid = values.query.trim().length >= 3;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">
          Commission a research run
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Produces exact external creatives from YouTube and Instagram, your owned
          evidence, a grounded brief, and an exportable results table.
        </p>
      </div>

      <div className="rounded-lg border border-stroke bg-elevated">
        <textarea
          value={values.query}
          onChange={(event) =>
            setValues((current) => ({ ...current, query: event.target.value }))
          }
          rows={3}
          placeholder='e.g. "Analyze content for Acme across YouTube and Instagram" or "Find external creatives about AI infra for founders"'
          className="w-full resize-none rounded-t-lg bg-transparent px-4 py-3.5 text-[14px] leading-6 placeholder:text-faint focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-stroke px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-faint">Platforms</span>
            <div className="flex rounded-md border border-stroke">
              {(
                [
                  ["both", "Both"],
                  ["youtube", "YouTube"],
                  ["instagram", "Instagram"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() =>
                    setValues((current) => ({ ...current, platforms: id }))
                  }
                  className={cn(
                    "h-7 px-2.5 text-xs transition-colors first:rounded-l-md last:rounded-r-md",
                    values.platforms === id
                      ? "bg-white/[.08] font-medium text-foreground"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2">
            <span className="text-xs font-medium text-faint">Recency</span>
            <select
              value={values.dateRange}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  dateRange: event.target.value as IntakeValues["dateRange"],
                }))
              }
              className="h-7 rounded-md border border-stroke bg-transparent px-1.5 text-xs text-foreground"
            >
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
          </label>

          <label className="flex min-w-48 flex-1 items-center gap-2">
            <span className="shrink-0 text-xs font-medium text-faint">Owned channels</span>
            <input
              value={values.ownedHandles}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  ownedHandles: event.target.value,
                }))
              }
              placeholder="@yourchannel, optional"
              className="h-7 w-full rounded-md border border-stroke bg-transparent px-2 text-xs placeholder:text-faint focus:outline-none"
            />
          </label>

          <Button
            onClick={() => onSubmit(values)}
            disabled={!valid || pending}
            className="ml-auto"
          >
            {pending ? "Generating plan…" : "Generate plan"}
            {!pending ? <ArrowRight className="size-3.5" /> : null}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-faint">Start from a template</span>
        {TEMPLATES.map((template) => (
          <button
            key={template.label}
            type="button"
            onClick={() => applyTemplate(template)}
            className="rounded-md border border-stroke px-2.5 py-1 text-xs text-muted transition-colors hover:bg-white/[.05] hover:text-foreground"
          >
            {template.label}
          </button>
        ))}
      </div>
    </section>
  );
}
