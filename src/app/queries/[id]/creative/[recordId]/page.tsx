"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowSquareOut, BookmarkSimple } from "@phosphor-icons/react";
import { fetchWithHash, readCache } from "@/lib/client-cache";
import { DitherLoader } from "@/components/dither-loader";
import { Button, Card, CardHeader, PlatformMark, RoleBadge, Stat } from "@/components/ui";
import { CreativeCard } from "@/components/creative-card";
import { resultRowsToRecords } from "@/lib/export";
import {
  engagementOf,
  formatAge,
  formatCompact,
  formatRate,
  isContentRecord,
  platformLabel,
  roleForConnector,
} from "@/lib/view-model";
import { useCollections } from "@/lib/collections";

type QueryPayload = {
  id: string;
  text: string;
  status: string;
  jobs: Array<{ id: string; connectorId: string; status: string; itemCount: number }>;
  results: Array<{
    sourceType: string;
    externalId: string;
    score: number | null;
    jobId: string;
    data: unknown;
  }>;
};

export default function CreativeDetailPage() {
  const params = useParams<{ id: string; recordId: string }>();
  const router = useRouter();
  const [query, setQuery] = useState<QueryPayload | null>(null);
  const [error, setError] = useState("");
  const collections = useCollections();

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `query:${params.id}`;
    const cached = readCache<{ query?: QueryPayload }>(cacheKey);
    if (cached?.data.query) setQuery(cached.data.query);
    fetchWithHash<{ query: QueryPayload }>(cacheKey, `/api/queries/${params.id}`)
      .then((result) => {
        if (cancelled || !result) return;
        setQuery(result.data.query);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      );
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const records = useMemo(
    () => (query ? resultRowsToRecords(query.results) : []),
    [query],
  );

  const recordId = decodeURIComponent(params.recordId);
  const index = records.findIndex((record) => record.externalId === recordId);
  const record = index >= 0 ? records[index] : null;
  const jobId = index >= 0 ? query?.results[index]?.jobId : undefined;
  const connectorId = query?.jobs.find((job) => job.id === jobId)?.connectorId;
  const role = roleForConnector(connectorId);

  const related = useMemo(() => {
    if (!record || !query) return [];
    return records
      .filter(
        (candidate) =>
          candidate.externalId !== record.externalId &&
          candidate.sourceType === record.sourceType &&
          isContentRecord(candidate),
      )
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 4)
      .map((candidate) => {
        const candidateIndex = records.findIndex(
          (r) => r.externalId === candidate.externalId,
        );
        const candidateJobId = query.results[candidateIndex]?.jobId;
        const candidateConnector = query.jobs.find((job) => job.id === candidateJobId)?.connectorId;
        return { record: candidate, role: roleForConnector(candidateConnector) };
      });
  }, [record, records, query]);

  if (error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-muted p-5 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!query) {
    return <DitherLoader label="Loading creative" className="mt-10" />;
  }
  if (!record) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push(`/queries/${query.id}`)}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} /> Back to run
        </button>
        <p className="text-sm text-muted">This creative is no longer part of the run.</p>
      </div>
    );
  }

  const engagement = engagementOf(record);
  const savedKey = `${record.sourceType}:${record.externalId}`;
  const isSaved = collections.keys.has(savedKey);
  const confidence = Math.round((record.score ?? 0) * 100);

  return (
    <main className="space-y-6">
      <button
        onClick={() => router.push(`/queries/${query.id}`)}
        className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} /> Back to run
      </button>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-stroke bg-overlay">
            {record.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={record.imageUrl}
                alt={record.title}
                className="aspect-video w-full object-cover"
              />
            ) : (
              <div className="grid aspect-video w-full place-items-center">
                <span className="text-4xl font-semibold text-faint">
                  {record.title.slice(0, 1).toUpperCase() || "?"}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RoleBadge role={role} />
            <PlatformMark platform={platformLabel(record)} />
            {confidence > 0 ? (
              <span className="tnum text-[11px] text-faint">{confidence}% match confidence</span>
            ) : null}
          </div>
          <h1 className="text-lg font-semibold leading-6 tracking-tight">
            {record.title || "Untitled creative"}
          </h1>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Performance" />
            <div className="grid grid-cols-3 gap-4 p-4">
              <Stat value={formatCompact(engagement.views)} label="Views" />
              <Stat value={formatRate(engagement.rate)} label="Engagement rate" />
              <Stat value={formatCompact(engagement.comments)} label="Comments" />
              <Stat value={formatCompact(engagement.likes)} label="Likes" />
              <Stat
                value={engagement.publishedAt ? formatAge(engagement.publishedAt) : "—"}
                label="Published"
              />
              <Stat value={engagement.creator || "—"} label="Creator" />
            </div>
          </Card>

          <Card>
            <CardHeader title="Why this matched" />
            <div className="space-y-2 p-4 text-xs leading-5 text-muted">
              <p>
                Matched the research query “{query.text.slice(0, 120)}
                {query.text.length > 120 ? "…" : ""}” via the{" "}
                <span className="font-mono text-[11px] text-foreground">
                  {connectorId ?? "unknown"}
                </span>{" "}
                step.
              </p>
              <p>
                {role === "owned"
                  ? "This is owned evidence — content from your own channels used as the performance baseline."
                  : "This is an external reference — a competitor or market creative matched against your pillars and audience."}
              </p>
              {record.score != null ? (
                <p className="tnum text-faint">
                  Relevance score {record.score.toFixed(2)} out of 1.00, ranked against{" "}
                  {records.length} records in this run.
                </p>
              ) : null}
            </div>
          </Card>

          <div className="flex gap-2">
            {record.url ? (
              <a href={record.url} target="_blank" rel="noreferrer noopener">
                <Button size="sm">
                  <ArrowSquareOut size={14} /> Open original
                </Button>
              </a>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                collections.toggle({
                  record,
                  role,
                  queryId: query.id,
                  queryText: query.text,
                })
              }
            >
              <BookmarkSimple size={14} weight={isSaved ? "fill" : "regular"} />
              {isSaved ? "Saved" : "Save to collection"}
            </Button>
          </div>
        </div>
      </div>

      {related.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight">
            Related matches from this run
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((item) => (
              <CreativeCard
                key={item.record.externalId}
                record={item.record}
                role={item.role}
                href={`/queries/${query.id}/creative/${encodeURIComponent(item.record.externalId)}`}
              />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
