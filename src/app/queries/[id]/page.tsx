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
import { YcEvidenceTable } from "@/components/yc-evidence-table";
import { Brief } from "@/components/brief";
import { ServiceAlertBanner } from "@/components/service-alert";
import { EmptyState } from "@/components/ui";
import { resultRowsToRecords } from "@/lib/export";
import { isTerminalQueryStatus, reconcileQueryStatus } from "@/lib/status";
import {
  defaultWorkspaceTab,
  displayStatus,
  isContentConnector,
  isContentRecord,
  isYcOnlyQuery,
  type WorkspaceTab,
} from "@/lib/view-model";
import {
  classifyServiceAlerts,
  genericServiceAlert,
} from "@/lib/service-errors";
import { parseProgressiveBriefState } from "@/lib/ai/progressive-brief";
import { useCollections } from "@/lib/collections";
import {
  fetchWithHash,
  invalidateCache,
  postWithHash,
  readCache,
  writeCache,
} from "@/lib/client-cache";
import { DitherLoader } from "@/components/dither-loader";

type QueryPayload = {
  id: string;
  text: string;
  interpretation: string;
  status: string;
  summary: string | null;
  synthesisStartedAt?: string | null;
  costEstimateUsd: number;
  createdAt: string;
  progressiveBrief?: unknown;
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

type Tab = WorkspaceTab;

export default function QueryPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [query, setQuery] = useState<QueryPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [briefError, setBriefError] = useState("");
  const [summary, setSummary] = useState("");
  const [actionPending, setActionPending] = useState("");
  const [activeTab, setActiveTab] = useState<Tab | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pollEpoch, setPollEpoch] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const briefAutoStarted = useRef(false);
  const collections = useCollections();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastStatus = "";
    const cacheKey = `query:${params.id}`;

    // Instant paint from the local cache while the server revalidates.
    const cached = readCache<{ query?: QueryPayload }>(cacheKey);
    if (cached?.data.query) {
      lastStatus = reconcileQueryStatus(
        cached.data.query.status,
        (cached.data.query.jobs ?? []).map((job) => job.status),
      );
      setQuery(cached.data.query);
      if (cached.data.query.summary) setSummary(cached.data.query.summary);
    }

    async function refreshQueryFromServer() {
      const response = await fetch(`/api/queries/${params.id}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body.query) return null;
      const hash = body.hash || response.headers.get("x-data-hash") || "";
      if (hash) writeCache(cacheKey, hash, body);
      return body.query as QueryPayload;
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
        let next = result?.data?.query ?? null;
        if (!next && !initial) {
          next = await refreshQueryFromServer();
        }
        if (next?.status) {
          lastStatus = reconcileQueryStatus(
            next.status,
            (next.jobs ?? []).map((job) => job.status),
          );
          setQuery(next);
          if (next.summary) setSummary(next.summary);
          setLoadError("");
        }
        const waitingForBrief =
          lastStatus &&
          isTerminalQueryStatus(lastStatus) &&
          next &&
          (next.results?.length ?? 0) > 0 &&
          !next.summary;
        if (
          (lastStatus && !isTerminalQueryStatus(lastStatus)) ||
          waitingForBrief
        ) {
          timer = setTimeout(() => poll(false), waitingForBrief ? 4000 : 5000);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load query";
        const rateLimited = /429|Too Many|rate/i.test(message);
        if (rateLimited) {
          // Keep the last good query on screen; retry after the cap cools down.
          timer = setTimeout(() => poll(false), 12000);
          return;
        }
        setLoadError(message);
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
    // Brief is persisted server-side after results land in DB (scheduleQueryBrief).
    // Client only streams when regenerating; otherwise poll picks up query.summary.
    if (!query?.summary) return;
    setSummary(query.summary);
  }, [query?.summary]);

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
    () => (query ? resultRowsToRecords(query.results ?? []) : []),
    [query],
  );

  const boardItems = useMemo(
    () =>
      query
        ? boardRecordsFrom(
            records,
            (query.results ?? []).map((row) => row.jobId),
            query.jobs ?? [],
          )
        : [],
    [query, records],
  );

  const hasContent = records.some(isContentRecord);
  const hasContentJobs = (query?.jobs ?? []).some((job) =>
    isContentConnector(job.connectorId),
  );
  const effectiveStatus = query
    ? reconcileQueryStatus(
        query.status,
        (query.jobs ?? []).map((job) => job.status),
      )
    : "queued";
  const running = query ? !isTerminalQueryStatus(effectiveStatus) : false;
  const canSynthesizeBrief = query
    ? isTerminalQueryStatus(effectiveStatus) && records.length > 0
    : false;
  const failedJobs = query
    ? (query.jobs ?? []).filter(
        (job) => job.status === "failed" || job.status === "timed_out",
      )
    : [];
  const resolvedTab: Tab =
    activeTab ??
    defaultWorkspaceTab({
      hasContentRecords: hasContent,
      hasEvidence: records.length > 0,
      hasContentJobs,
      running,
    });

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
      setBriefError(payload.message ?? "Could not regenerate brief");
    }
    setActionPending("");
  }

  async function streamBrief(force = false) {
    setSummary("");
    setBriefError("");
    setActionPending("brief");
    invalidateCache(`query:${params.id}`);
    try {
      const response = await fetch(
        `/api/queries/${params.id}/summary${force ? "?force=1" : ""}`,
        { method: "POST" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        briefAutoStarted.current = false;
        setBriefError(
          (payload as { message?: string }).message ??
            `Brief generation failed (${response.status})`,
        );
        setActionPending("");
        return;
      }
      if (response.headers.get("content-type")?.includes("application/json")) {
        const payload = await response.json();
        if (payload.summary) setSummary(payload.summary);
        else {
          briefAutoStarted.current = false;
          setBriefError(payload.message ?? "Brief generation returned no summary.");
        }
        setActionPending("");
        return;
      }
      const reader = response.body?.getReader();
      if (!reader) {
        briefAutoStarted.current = false;
        setBriefError("Brief stream unavailable.");
        setActionPending("");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      let sawSummary = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.replace(/^data: /, "");
          try {
            const event = JSON.parse(line) as {
              delta?: string;
              summary?: string;
              error?: string;
              done?: boolean;
            };
            if (event.error) {
              briefAutoStarted.current = false;
              setBriefError(event.error);
              continue;
            }
            if (event.delta) {
              sawSummary = true;
              setSummary((current) => current + event.delta);
            }
            if (event.summary) {
              sawSummary = true;
              setSummary(event.summary);
            }
          } catch {
            // keepalive lines
          }
        }
      }
      if (!sawSummary) briefAutoStarted.current = false;
      setPollEpoch((value) => value + 1);
    } catch (err) {
      briefAutoStarted.current = false;
      setBriefError(err instanceof Error ? err.message : "Brief generation failed");
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
      setBriefError(payload.message ?? "Could not retry failed steps");
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
    else setBriefError(payload.message ?? "Could not rerun query");
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

  if (!query) {
    if (loadError) {
      return (
        <div className="rounded-lg border border-danger/30 bg-danger-muted p-5 text-[13px] text-danger">
          {loadError}
        </div>
      );
    }
    return <DitherLoader label="Loading run" className="mt-10" />;
  }

  const ycOnly = isYcOnlyQuery(query.jobs ?? []);
  const progressiveBrief = parseProgressiveBriefState(query.progressiveBrief);
  const progressiveMeta = progressiveBrief
    ? {
        passNumber: progressiveBrief.passes.length || 1,
        itemCount: progressiveBrief.lastPassCompanyCount,
        inProgress: progressiveBrief.inProgress,
      }
    : null;
  const serviceAlerts = classifyServiceAlerts([
    briefError,
    ...failedJobs.map((job) => job.error ?? ""),
  ]);
  const fallbackAlert =
    briefError && serviceAlerts.length === 0
      ? [genericServiceAlert(briefError)]
      : [];

  const status = displayStatus(
    effectiveStatus,
    query.jobs ?? [],
    records.length,
  );
  const botMood: BotMood =
    effectiveStatus === "running"
      ? "working"
      : effectiveStatus === "succeeded" && records.length > 0
        ? "done"
        : effectiveStatus === "succeeded" && records.length === 0
          ? "error"
          : effectiveStatus === "failed" || effectiveStatus === "aborted"
            ? "error"
            : "idle";
  const showCreativesTab = hasContent || hasContentJobs;
  const tabs: Array<{ id: Tab; label: string; icon: typeof GridFour }> = [
    ...(showCreativesTab
      ? [
          {
            id: "creatives" as const,
            label: `Creatives ${boardItems.filter((i) => isContentRecord(i.record)).length || ""}`,
            icon: GridFour,
          },
        ]
      : []),
    { id: "brief", label: "Brief", icon: Article },
    { id: "evidence", label: `Evidence ${records.length || ""}`, icon: Table },
  ];
  const visibleTab: Tab =
    resolvedTab === "creatives" && !showCreativesTab ? "evidence" : resolvedTab;

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

      <ServiceAlertBanner alerts={[...serviceAlerts, ...fallbackAlert]} />

      {running || effectiveStatus !== "succeeded" ? (
        <RunStatus
          jobs={query.jobs ?? []}
          queryStatus={effectiveStatus}
          resultCount={records.length}
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
              visibleTab === tab.id
                ? "border-accent font-medium text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            <tab.icon size={14} weight={visibleTab === tab.id ? "fill" : "regular"} />
            {tab.label}
          </button>
        ))}
      </div>

      {visibleTab === "creatives" ? (
        <CreativesBoard
          items={boardItems}
          queryId={query.id}
          hasOtherEvidence={records.length > 0}
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

      {visibleTab === "brief" ? (
        <section className="space-y-4">
          <div className="flex items-center justify-between no-print">
            <p className="text-[11px] text-faint">
              Grounded in {records.length} collected records
            </p>
            {canSynthesizeBrief ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  briefAutoStarted.current = false;
                  void streamBrief(true);
                }}
                disabled={Boolean(actionPending)}
              >
                <ArrowClockwise
                  size={13}
                  className={actionPending === "brief" ? "animate-spin" : undefined}
                />
                {actionPending === "brief" ? "Generating…" : "Regenerate brief"}
              </Button>
            ) : null}
          </div>
          {summary ? (
            <Brief
              summary={summary}
              streaming={actionPending === "brief"}
              progressiveMeta={progressiveMeta}
            />
          ) : (
            <EmptyState
              title={
                canSynthesizeBrief
                  ? "Brief not generated yet"
                  : "Brief available when the run completes"
              }
              body={
                canSynthesizeBrief
                  ? query.synthesisStartedAt
                    ? "Writing the brief to the database… this page will update when it lands."
                    : "Evidence is saved. Brief is being generated on the server and will appear here when persisted."
                  : running
                    ? "Evidence appears as connector steps finish. The brief is written to the database after the run completes."
                    : "Collect evidence first, then regenerate the brief."
              }
            />
          )}
        </section>
      ) : null}

      {visibleTab === "evidence" ? (
        records.length === 0 ? (
          <EmptyState
            title="No records yet"
            body={
              isTerminalQueryStatus(effectiveStatus)
                ? "This run finished without matches. Broaden the batch, drop hiring-only filters, or try a simpler YC industry search."
                : "Rows appear as connector steps finish. Failed steps stay visible in the run summary above."
            }
          />
        ) : ycOnly ? (
          <YcEvidenceTable items={boardItems} queryId={query.id} />
        ) : (
          <EvidenceTable items={boardItems} queryId={query.id} />
        )
      ) : null}
    </main>
  );
}
