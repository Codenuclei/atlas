"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ResearchIntake, composeQuery, type IntakeValues } from "@/components/intake";
import { PlanReview } from "@/components/plan-review";
import { EmptyState, SectionHeading, StatusBadge } from "@/components/ui";
import { displayStatus, formatAge } from "@/lib/view-model";
import type { ScrapePlan } from "@/lib/ai/plan-schema";

type Cost = { usd: number; itemCount: number; steps: Array<{ note: string }> };

type RunRow = {
  id: string;
  text: string;
  status: string;
  costEstimateUsd: number;
  createdAt: string;
  jobs?: Array<{ connectorId: string; status: string; itemCount: number }>;
};

function platformCoverage(run: RunRow): string {
  const ids = new Set((run.jobs ?? []).map((job) => job.connectorId));
  const parts: string[] = [];
  if ([...ids].some((id) => id.includes("youtube"))) parts.push("YouTube");
  if ([...ids].some((id) => id.includes("instagram"))) parts.push("Instagram");
  if ([...ids].some((id) => id.includes("linkedin"))) parts.push("LinkedIn");
  if ([...ids].some((id) => id.includes("yc"))) parts.push("YC");
  return parts.join(" · ") || "—";
}

export default function HomePage() {
  const router = useRouter();
  const [stage, setStage] = useState<"intake" | "review">("intake");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<ScrapePlan | null>(null);
  const [originalPlan, setOriginalPlan] = useState<ScrapePlan | null>(null);
  const [cost, setCost] = useState<Cost | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);

  useEffect(() => {
    fetch("/api/queries")
      .then((response) => response.json())
      .then((payload) => setRuns(payload.queries ?? []))
      .catch(() => undefined);
  }, []);

  // Re-estimate cost when the plan is edited during review.
  useEffect(() => {
    if (!plan || stage !== "review") return;
    const timer = window.setTimeout(async () => {
      const response = await fetch("/api/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(plan),
      });
      const payload = await response.json();
      if (response.ok) {
        setCost(payload.cost);
        setError("");
      } else {
        setError(payload.message ?? "The edited plan is invalid.");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [plan, stage]);

  async function generatePlan(values: IntakeValues) {
    const text = composeQuery(values);
    setPending(true);
    setError("");
    setNotice("");
    setQuery(text);
    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: text }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to plan query");
      }
      setPlan(payload.plan);
      setOriginalPlan(payload.plan);
      setCost(payload.cost);
      setNotice(payload.notice ?? "");
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to plan query");
    } finally {
      setPending(false);
    }
  }

  async function approveAndRun() {
    if (!plan) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/queries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, plan }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to start query");
      }
      router.push(`/queries/${payload.query.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start query");
      setPending(false);
    }
  }

  return (
    <main className="space-y-10">
      {stage === "intake" ? (
        <ResearchIntake onSubmit={generatePlan} pending={pending} />
      ) : null}

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-[13px] text-danger">
          {error}
        </div>
      ) : null}

      {stage === "review" && plan && originalPlan ? (
        <PlanReview
          query={query}
          plan={plan}
          originalPlan={originalPlan}
          cost={cost}
          notice={notice}
          pending={pending}
          onChange={setPlan}
          onApprove={approveAndRun}
          onBack={() => setStage("intake")}
        />
      ) : null}

      <section className="space-y-3">
        <SectionHeading title="Recent runs" meta={`${runs.length} total`} />
        {runs.length === 0 ? (
          <EmptyState
            title="No runs yet"
            body="A good first run names a brand or channel and both platforms — for example: Analyze content for your own channel across YouTube and Instagram. Exact external creatives, owned evidence, and a cited brief appear here when it finishes."
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-stroke">
            {runs.slice(0, 8).map((run) => {
              const status = displayStatus(run.status, run.jobs);
              const items = (run.jobs ?? []).reduce((sum, job) => sum + job.itemCount, 0);
              return (
                <button
                  key={run.id}
                  onClick={() => router.push(`/queries/${run.id}`)}
                  className="flex w-full items-center justify-between gap-4 border-b border-stroke px-4 py-3 text-left transition-colors last:border-0 hover:bg-white/[.03]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{run.text}</p>
                    <p className="mt-0.5 text-[11px] text-faint">
                      {platformCoverage(run)} ·{" "}
                      <span className="tnum">{items} items</span> ·{" "}
                      {formatAge(run.createdAt)}
                    </p>
                  </div>
                  <StatusBadge label={status.label} tone={status.tone} />
                </button>
              );
            })}
          </div>
        )}
        {runs.length > 8 ? (
          <button
            onClick={() => router.push("/history")}
            className="text-xs text-muted transition-colors hover:text-foreground"
          >
            View all {runs.length} runs →
          </button>
        ) : null}
      </section>
    </main>
  );
}
