"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { DitherLoader } from "@/components/dither-loader";
import { fetchWithHash, readCache } from "@/lib/client-cache";
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
  // Steps the user unchecks during review; kept visible, never sent to the server.
  const [explicitDisabled, setExplicitDisabled] = useState<Set<number>>(new Set());
  const [runs, setRuns] = useState<RunRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    const cached = readCache<{ queries?: RunRow[] }>("queries");
    if (cached?.data.queries) setRuns(cached.data.queries);
    fetchWithHash<{ queries?: RunRow[] }>("queries", "/api/queries")
      .then((result) => {
        if (cancelled || !result) return;
        setRuns(result.data.queries ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-estimate cost when the plan is edited or steps are excluded during review.
  const { enabledPlan, disabledSteps, autoDisabledSteps } = useMemo(() => {
    if (!plan) {
      return {
        enabledPlan: null,
        disabledSteps: new Set<number>(),
        autoDisabledSteps: new Set<number>(),
      };
    }
    // Excluding a step also excludes everything that depends on it, otherwise
    // server-side plan validation (and therefore the run) rejects the plan.
    const disabled = new Set<number>();
    let changed = true;
    while (changed) {
      changed = false;
      plan.steps.forEach((step, index) => {
        if (disabled.has(index)) return;
        const blockedByExclusion = step.dependsOn.some((dep) =>
          plan.steps.some(
            (candidate, ci) =>
              disabled.has(ci) && candidate.connectorId === dep,
          ),
        );
        if (explicitDisabled.has(index) || blockedByExclusion) {
          disabled.add(index);
          changed = true;
        }
      });
    }
    const auto = new Set<number>();
    disabled.forEach((index) => {
      if (!explicitDisabled.has(index)) auto.add(index);
    });
    return {
      enabledPlan: {
        ...plan,
        steps: plan.steps.filter((_, index) => !disabled.has(index)),
      },
      disabledSteps: disabled,
      autoDisabledSteps: auto,
    };
  }, [plan, explicitDisabled]);

  useEffect(() => {
    if (!enabledPlan || stage !== "review") return;
    const timer = window.setTimeout(async () => {
      const response = await fetch("/api/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(enabledPlan),
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
  }, [enabledPlan, stage]);

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
      setExplicitDisabled(new Set());
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to plan query");
    } finally {
      setPending(false);
    }
  }

  async function approveAndRun() {
    if (!enabledPlan) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/queries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, plan: enabledPlan }),
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
        <ResearchIntake
          onSubmit={generatePlan}
          pending={pending}
          mood={error ? "error" : pending ? "thinking" : "idle"}
          initialQuery={query}
        />
      ) : null}

      {pending && stage === "intake" ? (
        <DitherLoader label="Planning the research operation" />
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
          disabled={disabledSteps}
          autoDisabled={autoDisabledSteps}
          onChange={setPlan}
          onToggle={(index) =>
            setExplicitDisabled((current) => {
              const next = new Set(current);
              if (next.has(index)) next.delete(index);
              else next.add(index);
              return next;
            })
          }
          onApprove={approveAndRun}
          onBack={() => setStage("intake")}
        />
      ) : null}

      <section className="space-y-3">
        <SectionHeading title="Recent runs" meta={`${runs.length} total`} />
        {runs.length === 0 ? (
          <EmptyState icon="ufo" title="No runs yet" />
        ) : (
          <div className="overflow-hidden rounded-lg border border-stroke">
            {runs.slice(0, 8).map((run) => {
              const items = (run.jobs ?? []).reduce((sum, job) => sum + job.itemCount, 0);
              const status = displayStatus(run.status, run.jobs, items);
              return (
                <button
                  key={run.id}
                  onClick={() => router.push(`/queries/${run.id}`)}
                  className="flex w-full items-center justify-between gap-4 border-b border-stroke px-4 py-3 text-left transition-colors last:border-0 hover:bg-hover"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{run.text}</p>
                    <p className="mt-0.5 text-[11px] text-faint">
                      {platformCoverage(run)} ·{" "}
                      <span className="tnum">{items} items</span> ·{" "}
                      {formatAge(run.createdAt)}
                    </p>
                  </div>
                  <span className="nudge-icon flex shrink-0 items-center gap-2">
                    <StatusBadge label={status.label} tone={status.tone} />
                    <ArrowRight size={13} className="text-faint" />
                  </span>
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
            <span className="nudge-icon flex items-center gap-1">
              View all {runs.length} runs <ArrowRight size={12} />
            </span>
          </button>
        ) : null}
      </section>
    </main>
  );
}
