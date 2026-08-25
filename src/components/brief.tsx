"use client";

import { useMemo } from "react";
import { DitherField } from "@/components/dither-loader";

/**
 * Renders the synthesis text as a structured research note.
 * Headings come from markdown "##"/"###" lines, known section titles, or ALL-CAPS lines;
 * "- " lines become bullets; bare URLs become links.
 */
export function Brief({
  summary,
  streaming,
}: {
  summary: string;
  streaming?: boolean;
}) {
  const blocks = useMemo(() => parseBlocks(summary), [summary]);

  return (
    <div className="brief-body">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return <h3 key={index}>{block.text}</h3>;
        }
        if (block.type === "bullets") {
          return (
            <ul key={index} className="list-disc">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
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

type Block =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] };

const SECTION_TITLES = [
  /^best \d+ matching youtube creatives:?$/i,
  /^best \d+ matching instagram creatives:?$/i,
  /^audience archetypes:?$/i,
  /^content direction:?$/i,
  /^what type of content could work:?$/i,
];

function isHeadingLine(line: string): string | null {
  const trimmed = line.trim().replace(/^\*\*(.+)\*\*$/, "$1").trim();
  const md = trimmed.match(/^#{1,4}\s+(.+)/);
  if (md) return md[1].trim().replace(/:+$/, "");
  if (SECTION_TITLES.some((pattern) => pattern.test(trimmed))) {
    return trimmed.replace(/:+$/, "");
  }
  if (
    trimmed.length > 4 &&
    trimmed.length < 90 &&
    !trimmed.endsWith(".") &&
    /^[A-Z0-9][A-Z0-9\s\-—:&/().]+$/.test(trimmed)
  ) {
    return trimmed;
  }
  return null;
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  function flush() {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
    if (bullets.length) {
      blocks.push({ type: "bullets", items: bullets });
      bullets = [];
    }
  }

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    const heading = isHeadingLine(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", text: heading });
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)/);
    if (bullet) {
      if (paragraph.length) flush();
      bullets.push(bullet[1].trim());
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (bullets.length) flush();
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}

const URL_RE = /(https?:\/\/[^\s)]+)/g;

function renderInline(text: string) {
  const parts = text.split(URL_RE);
  return parts.map((part, index) =>
    part.startsWith("http://") || part.startsWith("https://") ? (
      <a
        key={index}
        href={part}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}
      </a>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}
