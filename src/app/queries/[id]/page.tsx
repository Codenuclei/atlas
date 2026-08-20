"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Download,
  MoreHorizontal,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button, StatusBadge, cn } from "@/components/ui";
import { RunStatus } from "@/components/run-status";
import { CreativesBoard, boardRecordsFrom } from "@/components/creatives-board";
import { EvidenceTable } from "@/components/evidence-table";
import { Brief } from "@/components/brief";
import { EmptyState } from "@/components/ui";
import { resultRowsToRecords } from "@/lib/export";
import { isTerminalQueryStatus } from "@/lib/status";
import { displayStatus, isContentRecord } from "@/lib/view-model";
import { useCollections } from "@/lib/collections";

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
  const menuRef = useRef<HTMLDivElement>(null);
  const collections = useCollections();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll(initial = false) {
      try {
        const response = await fetch(`/api/queries/${params.id}`, {
          cache: "no-store",
          method: initial ? "GET" : "POST",
        });
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.message ?? "Failed to load query");
        if (cancelled) return;
        setQuery(payload.query);
        if (payload.query.summary) setSummary(payload.query.summary);
        if (!isTerminalQueryStatus(payload.query.status)) {
          timer = setTimeout(poll, 1500);
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
  }, [params.id]);

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
  const resolvedTab: Tab =
    activeTab ?? (hasContent || running ? "creatives" : "brief");

  async function stopRun() {
    setActionPending("stop");
    await fetch(`/api/queries/${params.id}/abort`, { method: "POST" });
    setActionPending("");
  }

  async function streamBrief() {
    setSummary("");
    setActionPending("brief");
    const response = await fetch(`/api/queries/${params.id}/summary`, {
      method: "POST",
    });
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
    if (response.ok) router.push("/history");
    else setActionPending("");
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
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 animate-pulse rounded bg-white/[.05]" />
        <div className="h-9 w-2/3 animate-pulse rounded bg-white/[.05]" />
        <div className="h-40 animate-pulse rounded-lg bg-white/[.04]" />
      </div>
    );
  }

  const status = displayStatus(query.status, query.jobs);
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "creatives", label: `Creatives ${boardItems.filter((i) => isContentRecord(i.record)).length || ""}` },
    { id: "brief", label: "Brief" },
    { id: "evidence", label: `Evidence ${records.length || ""}` },
  ];

  return (
    <main className="space-y-6">
      <button
        onClick={() => router.push("/history")}
        className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground no-print"
      >
        <ArrowLeft className="size-3.5" /> All runs
      </button>

      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0 max-w-3xl">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge label={status.label} tone={status.tone} />
            <span className="tnum text-[11px] text-faint">
              ${query.costEstimateUsd.toFixed(2)} est.
            </span>
          </div>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">{query.text}</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-muted">
            {query.interpretation}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 no-print">
          <a href={`/api/queries/${query.id}/export?format=csv`}>
            <Button size="sm">
              <Download className="size-3.5" /> Export
            </Button>
          </a>
          {!running ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={rerun}
              disabled={Boolean(actionPending)}
            >
              <RefreshCw className="size-3.5" />
              {actionPending === "rerun" ? "Starting…" : "Run again"}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={copyLink}>
            <Copy className="size-3.5" />
            {copied ? "Copied" : "Copy link"}
          </Button>
          <div className="relative" ref={menuRef}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMenuOpen((value) => !value)}
              aria-label="More actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
            {menuOpen ? (
              <div className="absolute right-0 top-9 z-10 w-44 rounded-lg border border-stroke bg-overlay p-1">
                <a
                  href={`/api/queries/${query.id}/export?format=json`}
                  className="block rounded-md px-2.5 py-1.5 text-xs text-muted hover:bg-white/[.05] hover:text-foreground"
                >
                  Export JSON
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
                  <Trash2 className="size-3.5" /> Delete run
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
        />
      ) : null}

      <div className="flex gap-1 border-b border-stroke no-print">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "shrink-0 border-b-2 px-3.5 py-2.5 text-[13px] transition-colors",
              resolvedTab === tab.id
                ? "border-accent font-medium text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
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
            {!summary && query.status === "succeeded" ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={streamBrief}
                disabled={!records.length || Boolean(actionPending)}
              >
                {actionPending === "brief" ? "Writing…" : "Generate brief"}
              </Button>
            ) : null}
          </div>
          {summary ? (
            <Brief summary={summary} streaming={actionPending === "brief"} />
          ) : (
            <EmptyState
              title={
                query.status === "succeeded"
                  ? "Brief not generated yet"
                  : "Brief available when the run completes"
              }
              body={
                query.status === "succeeded"
                  ? "Generate a brief grounded in the collected evidence. Every claim traces back to the records in the Evidence tab."
                  : "The brief is written from collected records once all steps finish. Partial results are never summarized as if complete."
              }
            />
          )}
        </section>
      ) : null}

      {resolvedTab === "evidence" ? (
        records.length === 0 ? (
          <EmptyState
            title="No records yet"
            body="Rows appear as connector steps finish. Nothing is hidden — failed steps are shown in the run summary above."
          />
        ) : (
          <EvidenceTable items={boardItems} queryId={query.id} />
        )
      ) : null}
    </main>
  );
}
