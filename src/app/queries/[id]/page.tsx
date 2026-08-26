"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowLeft,
  Article,
  Check,
  Copy,
  DotsThree,
  DownloadSimple,
  FileJs,
  GridFour,
  Table,
  Trash,
} from "@phosphor-icons/react";
import { Button, StatusBadge, cn } from "@/components/ui";
import { GrokBot, type BotMood } from "@/components/grok-bot";
import { RunStatus } from "@/components/run-status";
import { CreativesBoard, boardRecordsFrom } from "@/components/creatives-board";
import { EvidenceTable } from "@/components/evidence-table";
import { Brief } from "@/components/brief";
import { EmptyState } from "@/components/ui";
import { resultRowsToRecords } from "@/lib/export";
import { isTerminalQueryStatus } from "@/lib/status";
import { displayStatus, isContentRecord } from "@/lib/view-model";
import { useCollections } from "@/lib/collections";
import {
  fetchWithHash,
  invalidateCache,
  postWithHash,
  readCache,
} from "@/lib/client-cache";
import { DitherLoader } from "@/components/dither-loader";

type QueryPayload = {
  id: string;
  text: string;
  interpretation: string;
  status: string;
  summary: string | null;
  costEstimateUsd: number;
  createdAt: string;
  jobs: Array<{
    id: string;
    connectorId: string;
    status: string;
    itemCount: number;
    error: string | null;
  }>;
  results: Array<{
    sourceType: string;
    externalId: string;
    score: number | null;
    jobId: string;
    data: unknown;
  }>;
};

type Tab = "creatives" | "brief" | "evidence";

export default function QueryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [query, setQuery] = useState<QueryPayload | null>(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [actionPending, setActionPending] = useState("");
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const collections = useCollections();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastStatus = "";
    const cacheKey = `query:${params.id}`;

    // Instant paint from the local cache while the server revalidates.
    const cached = readCache<{ query?: QueryPayload }>(cacheKey);
    if (cached?.data.query) {
      lastStatus = cached.data.query.status;
      setQuery(cached.data.query);
      if (cached.data.query.summary) setSummary(cached.data.query.summary);
    }

    async function poll(initial = false) {
      try {
        const result = initial
          ? await fetchWithHash<{ query: QueryPayload }>(
              cacheKey,
              `/api/queries/${params.id}`,
            )
          : await postWithHash<{ query: QueryPayload }>(
              cacheKey,
              `/api/queries/${params.id}`,
            );
        if (cancelled) return;
        if (result) {
          const payload = result.data;
          lastStatus = payload.query.status;
          setQuery(payload.query);
          if (payload.query.summary) setSummary(payload.query.summary);
        }
        // On 304 / unchanged, skip state updates but keep polling live runs.
        if (lastStatus && !isTerminalQueryStatus(lastStatus)) {
          timer = setTimeout(() => poll(false), 1500);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load query");
        }
      }
    }

    poll(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, pollEpoch]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const records = useMemo(
    () => (query ? resultRowsToRecords(query.results) : []),
    [query],
  );

  const boardItems = useMemo(
    () =>
      query
        ? boardRecordsFrom(
            records,
            query.results.map((row) => row.jobId),
            query.jobs,
          )
        : [],
    [query, records],
  );

  const hasContent = records.some(isContentRecord);
  const running = query ? !isTerminalQueryStatus(query.status) : false;
  const canSynthesizeBrief = query
    ? isTerminalQueryStatus(query.status) && records.length > 0
    : false;
  const failedJobs = query
    ? query.jobs.filter(
        (job) => job.status === "failed" || job.status === "timed_out",
      )
    : [];
  const resolvedTab: Tab =
    activeTab ?? (hasContent || running ? "creatives" : "brief");

  async function stopRun() {
    setActionPending("stop");
    await fetch(`/api/queries/${params.id}/abort`, { method: "POST" });
    setActionPending("");
  }

  async function regenerateBrief() {
    setSummary("");
    setActionPending("brief");
    invalidateCache(`query:${params.id}`);
    const response = await fetch(
      `/api/queries/${params.id}/regenerate-brief`,
      { method: "POST" },
    );
    const payload = await response.json();
    if (response.ok) {
      setQuery(payload.query);
      setSummary(payload.query.summary ?? "");
      setPollEpoch((value) => value + 1);
    } else {
      setError(payload.message ?? "Could not regenerate brief");
    }
    setActionPending("");
  }

  async function streamBrief(force = false) {
    setSummary("");
    setActionPending("brief");
    invalidateCache(`query:${params.id}`);
    const response = await fetch(
      `/api/queries/${params.id}/summary${force ? "?force=1" : ""}`,
      { method: "POST" },
    );
    if (response.headers.get("content-type")?.includes("application/json")) {
      const payload = await response.json();
      if (payload.summary) setSummary(payload.summary);
      setActionPending("");
      return;
    }
    const reader = response.body?.getReader();
    if (!reader) {
      setActionPending("");
      return;
    }
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.replace(/^data: /, "");
        try {
          const event = JSON.parse(line) as { delta?: string; summary?: string };
          if (event.delta) setSummary((current) => current + event.delta);
          if (event.summary) setSummary(event.summary);
        } catch {
          // keepalive lines
        }
      }
    }
    setActionPending("");
  }

  async function retryFailed() {
    setActionPending("retry-failed");
    invalidateCache(`query:${params.id}`);
    const response = await fetch(`/api/queries/${params.id}/retry-failed`, {
      method: "POST",
    });
    const payload = await response.json();
    if (response.ok) {
      setQuery(payload.query);
      setSummary("");
      setPollEpoch((value) => value + 1);
    } else {
      setError(payload.message ?? "Could not retry failed steps");
    }
    setActionPending("");
  }

  async function rerun() {
    setActionPending("rerun");
    const response = await fetch(`/api/queries/${params.id}/rerun`, {
      method: "POST",
    });
    const payload = await response.json();
    if (response.ok) router.push(`/queries/${payload.query.id}`);
    else setError(payload.message ?? "Could not rerun query");
    setActionPending("");
  }

  async function remove() {
    if (!window.confirm("Delete this run and all stored results?")) return;
    setActionPending("delete");
    const response = await fetch(`/api/queries/${params.id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      invalidateCache("queries", `query:${params.id}`);
      router.push("/history");
    } else {
      setActionPending("");
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-muted p-5 text-[13px] text-danger">
        {error}
      </div>
    );
  }

  if (!query) {
    return <DitherLoader label="Loading run" className="mt-10" />;
  }

  const status = displayStatus(query.status, query.jobs);
  const botMood: BotMood =
    query.status === "running"
      ? "working"
      : query.status === "succeeded"
        ? "done"
        : query.status === "failed" || query.status === "aborted"
          ? "error"
          : "idle";
  const tabs: Array<{ id: Tab; label: string; icon: typeof GridFour }> = [
    { id: "creatives", label: `Creatives ${boardItems.filter((i) => isContentRecord(i.record)).length || ""}`, icon: GridFour },
    { id: "brief", label: "Brief", icon: Article },
    { id: "evidence", label: `Evidence ${records.length || ""}`, icon: Table },
  ];

  return (
    <main className="space-y-6">
      <button
        onClick={() => router.push("/history")}
        className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground no-print"
      >
        <ArrowLeft size={14} /> All runs
      </button>

      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 max-w-3xl">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <GrokBot
              mood={botMood}
              className="size-8 shrink-0"
            />
            <StatusBadge label={status.label} tone={status.tone} />
            <span className="tnum text-[11px] text-faint">
              ${query.costEstimateUsd.toFixed(2)} est.
            </span>
          </div>
          <h1 className="display text-[26px] leading-[1.2] font-medium">{query.text}</h1>
          <p className="mt-1.5 whitespace-pre-line text-[13px] leading-5 text-muted">
            {query.interpretation}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 no-print">
          <a
            href={`/api/queries/${query.id}/export?format=csv`}
            className="tip"
            data-tip="Export CSV"
            aria-label="Export CSV"
          >
            <Button size="sm" className="px-2.5" tabIndex={-1}>
              <DownloadSimple size={15} />
            </Button>
          </a>
          {!running && failedJobs.length > 0 ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={retryFailed}
              disabled={Boolean(actionPending)}
              className="tip px-2.5"
              data-tip="Retry failed steps"
              aria-label="Retry failed steps"
            >
              <ArrowCounterClockwise
                size={15}
                className={actionPending === "retry-failed" ? "animate-spin" : undefined}
              />
            </Button>
          ) : null}
          {!running ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={rerun}
              disabled={Boolean(actionPending)}
              className="tip px-2.5"
              data-tip="Run again"
              aria-label="Run again"
            >
              <ArrowClockwise size={15} className={actionPending === "rerun" ? "animate-spin" : undefined} />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={copyLink}
            className="tip px-2.5"
            data-tip={copied ? "Copied" : "Copy link"}
            aria-label={copied ? "Copied" : "Copy link"}
          >
            {copied ? <Check size={15} className="text-success" /> : <Copy size={15} />}
          </Button>
          <div className="relative" ref={menuRef}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMenuOpen((value) => !value)}
              aria-label="More actions"
            >
              <DotsThree size={16} weight="bold" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-10 w-44 rounded-lg border border-stroke bg-overlay p-1">
                <a
                  href={`/api/queries/${query.id}/export?format=json`}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted hover:bg-hover hover:text-foreground"
                >
                  <FileJs size={13} /> Export JSON
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    remove();
                  }}
                  disabled={Boolean(actionPending)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left text-xs text-danger hover:bg-danger/10"
                >
                  <Trash size={13} /> Delete run
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {running || query.status !== "succeeded" ? (
        <RunStatus
          jobs={query.jobs}
          queryStatus={query.status}
          onStop={stopRun}
          stopPending={actionPending === "stop"}
          onRetryFailed={failedJobs.length > 0 ? retryFailed : undefined}
          retryFailedPending={actionPending === "retry-failed"}
        />
      ) : null}

      <div className="flex gap-1 border-b border-stroke no-print">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] transition-colors",
              resolvedTab === tab.id
                ? "border-accent font-medium text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            <tab.icon size={14} weight={resolvedTab === tab.id ? "fill" : "regular"} />
            {tab.label}
          </button>
        ))}
      </div>

      {resolvedTab === "creatives" ? (
        <CreativesBoard
          items={boardItems}
          queryId={query.id}
          savedKeys={collections.keys}
          onToggleSave={(item) =>
            collections.toggle({
              record: item.record,
              role: item.role,
              queryId: query.id,
              queryText: query.text,
            })
          }
        />
      ) : null}

      {resolvedTab === "brief" ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between no-print">
            <p className="text-[11px] text-faint">
              Grounded in {records.length} collected records
            </p>
            {canSynthesizeBrief ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={regenerateBrief}
                disabled={Boolean(actionPending)}
              >
                <ArrowClockwise
                  size={13}
                  className={actionPending === "brief" ? "animate-spin" : undefined}
                />
                {actionPending === "brief" ? "Regenerating…" : "Regenerate brief"}
              </Button>
            ) : null}
          </div>
          {summary ? (
            <Brief summary={summary} streaming={actionPending === "brief"} />
          ) : (
            <EmptyState
              title={
                canSynthesizeBrief
                  ? "Brief not generated yet"
                  : "Brief available when the run completes"
              }
              body={
                canSynthesizeBrief
                  ? "Regenerate a brief from the collected evidence. Claude API calls are logged in the server terminal as [claude]."
                  : running
                    ? "The brief will be generated automatically once all steps finish."
                    : "Collect evidence first, then regenerate the brief from the Brief tab."
              }
            />
          )}
        </section>
      ) : null}

      {resolvedTab === "evidence" ? (
        records.length === 0 ? (
          <EmptyState
            title="No records yet"
            body={
              isTerminalQueryStatus(query.status)
                ? "This run finished without matches. Broaden the batch, drop hiring-only filters, or try a simpler YC industry search."
                : "Rows appear as connector steps finish. Failed steps stay visible in the run summary above."
            }
          />
        ) : (
          <EvidenceTable items={boardItems} queryId={query.id} />
        )
      ) : null}
    </main>
  );
}
