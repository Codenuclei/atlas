"use client";

import Link from "next/link";
import type { ScrapedRecord } from "@/lib/normalize";
import {
  engagementOf,
  formatAge,
  formatCompact,
  formatRate,
  platformLabel,
  type RecordRole,
} from "@/lib/view-model";
import { PlatformMark, RoleBadge, cn } from "@/components/ui";

export function CreativeCard({
  record,
  role,
  href,
  selected,
  onToggleSelect,
}: {
  record: ScrapedRecord;
  role: RecordRole;
  href: string;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const engagement = engagementOf(record);
  const confidence = Math.round((record.score ?? 0) * 100);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-elevated transition-colors",
        selected ? "border-accent" : "border-stroke hover:border-stroke-strong",
      )}
    >
      <Link href={href} className="block">
        <div className="relative aspect-video w-full overflow-hidden bg-overlay">
          {record.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={record.imageUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          ) : (
            <div className="grid size-full place-items-center">
              <span className="text-2xl font-semibold text-faint">
                {record.title.slice(0, 1).toUpperCase() || "?"}
              </span>
            </div>
          )}
          <div className="absolute left-2 top-2">
            <RoleBadge role={role} />
          </div>
          {confidence > 0 ? (
            <div className="tnum absolute right-2 top-2 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {confidence}% match
            </div>
          ) : null}
        </div>
        <div className="space-y-2 p-3">
          <p className="line-clamp-2 min-h-10 text-[13px] font-medium leading-5">
            {record.title || "Untitled creative"}
          </p>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-muted">
              {engagement.creator || "Unknown creator"}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <PlatformMark platform={platformLabel(record)} />
              {engagement.publishedAt ? (
                <span className="text-[11px] text-faint">
                  {formatAge(engagement.publishedAt)}
                </span>
              ) : null}
            </span>
          </div>
          <div className="tnum flex items-center gap-3 border-t border-stroke pt-2 text-[11px] text-muted">
            <span>{formatCompact(engagement.views)} views</span>
            <span>{formatRate(engagement.rate)} eng</span>
            <span>{formatCompact(engagement.comments)} comments</span>
          </div>
        </div>
      </Link>
      {onToggleSelect ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            onToggleSelect();
          }}
          aria-label="Select creative"
          className={cn(
            "absolute bottom-2 right-2 rounded-md border px-2 py-1 text-[10px] font-medium opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100",
            selected
              ? "border-accent bg-accent-muted text-accent opacity-100"
              : "border-stroke-strong bg-black/60 text-white",
          )}
        >
          {selected ? "Saved" : "Save"}
        </button>
      ) : null}
    </div>
  );
}
