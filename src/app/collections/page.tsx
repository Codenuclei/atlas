"use client";

import Link from "next/link";
import { useCollections } from "@/lib/collections";
import { CreativeCard } from "@/components/creative-card";
import { EmptyState, SectionHeading } from "@/components/ui";
import { formatAge } from "@/lib/view-model";

export default function CollectionsPage() {
  const { saved, keys, toggle } = useCollections();

  return (
    <main className="space-y-5">
      <SectionHeading
        title="Saved creatives"
        meta={`${saved.length} saved across runs`}
      />
      {saved.length === 0 ? (
        <EmptyState
          title="Nothing saved yet"
          body="Save creatives from any run to build a collection that survives across sessions. Hover a creative card and choose Save."
          action={
            <Link href="/" className="text-xs text-accent hover:underline">
              Start a research run
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {saved.map((item) => (
            <div key={item.key} className="space-y-1.5">
              <CreativeCard
                record={item.record}
                role={item.role}
                href={`/queries/${item.queryId}/creative/${encodeURIComponent(item.record.externalId)}`}
                selected={keys.has(item.key)}
                onToggleSelect={() =>
                  toggle({
                    record: item.record,
                    role: item.role,
                    queryId: item.queryId,
                    queryText: item.queryText,
                  })
                }
              />
              <p className="px-0.5 text-[11px] text-faint">
                from “{item.queryText.slice(0, 60)}
                {item.queryText.length > 60 ? "…" : ""}” · saved{" "}
                {formatAge(item.savedAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
