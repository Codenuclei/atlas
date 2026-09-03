"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DitherField } from "@/components/dither-loader";

export type ProgressiveBriefMeta = {
  passNumber: number;
  itemCount: number;
  inProgress?: boolean;
};

/** Renders the synthesis brief with GitHub-flavored markdown. */
export function Brief({
  summary,
  streaming,
  progressiveMeta,
}: {
  summary: string;
  streaming?: boolean;
  progressiveMeta?: ProgressiveBriefMeta | null;
}) {
  return (
    <div className="space-y-3">
      {progressiveMeta ? (
        <p className="text-[11px] text-faint">
          {progressiveMeta.inProgress
            ? `Writing pass ${progressiveMeta.passNumber}…`
            : `Progressive brief · pass ${progressiveMeta.passNumber} · ${progressiveMeta.itemCount} companies`}
        </p>
      ) : null}
      <div className="brief-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
        {streaming ? (
          <span className="mt-4 flex items-center gap-3 border-t border-stroke pt-4">
            <DitherField cells={72} rows={12} className="h-4 w-20" />
            <span className="text-[11px] text-faint">
              Writing the brief
              <span className="animate-pulse-dot">…</span>
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
