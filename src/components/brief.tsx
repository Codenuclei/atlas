"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DitherField } from "@/components/dither-loader";

/** Renders the synthesis brief with GitHub-flavored markdown. */
export function Brief({
  summary,
  streaming,
}: {
  summary: string;
  streaming?: boolean;
}) {
  return (
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
  );
}
