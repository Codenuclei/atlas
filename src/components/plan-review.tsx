"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import type { ScrapePlan, ScrapeStep } from "@/lib/ai/plan-schema";
import { jobStageLabel } from "@/lib/view-model";
import { Button, Card, CardHeader, cn } from "@/components/ui";

type Cost = { usd: number; itemCount: number; steps: Array<{ note: string }> };

function StepRow({
  step,
  index,
  enabled,
  modified,
  onToggle,
  onPurposeChange,
}: {
  step: ScrapeStep;
  index: number;
  enabled: boolean;
  modified: boolean;
  onToggle: () => void;
  onPurposeChange: (purpose: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const maxItems =
    typeof step.params.maxItems === "number" ? step.params.maxItems : undefined;

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3",
        !enabled && "opacity-45",
      )}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={onToggle}
        aria-label={`Include step ${index + 1}`}
        className="mt-1 size-3.5 shrink-0 accent-[#5b8def]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium">
            {jobStageLabel(step.connectorId)}
          </span>
          <span className="rounded border border-stroke px-1.5 py-px font-mono text-[10px] text-faint">
            {step.connectorId}
          </span>
          {modified ? (
            <span className="text-[10px] font-medium uppercase tracking-wide text-warning">
              modified
            </span>
          ) : null}
          {maxItems !== undefined ? (
            <span className="tnum text-[11px] text-faint">≤ {maxItems} items</span>
          ) : null}
        </div>
        {editing ? (
          <textarea
            value={step.purpose}
            onChange={(event) => onPurposeChange(event.target.value)}
            onBlur={() => setEditing(false)}
            rows={2}
            className="mt-1.5 w-full resize-none rounded-md border border-stroke-strong bg-transparent px-2 py-1.5 text-xs leading-5 focus:outline-none"
          />
        ) : (
          <p className="mt-1 text-xs leading-5 text-muted">{step.purpose}</p>
        )}
        {step.dependsOn.length > 0 ? (
          <p className="mt-1 text-[11px] text-faint">
            Runs after: {step.dependsOn.map(jobStageLabel).join(", ")}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setEditing((value) => !value)}
        aria-label="Edit step purpose"
        className="mt-0.5 rounded-md p-1.5 text-faint transition-colors hover:bg-white/[.05] hover:text-foreground"
      >
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}

export function PlanReview({
  query,
  plan,
  originalPlan,
  cost,
  notice,
  pending,
  onChange,
  onApprove,
  onBack,
}: {
  query: string;
  plan: ScrapePlan;
  originalPlan: ScrapePlan;
  cost: Cost | null;
  notice: string;
  pending: boolean;
  onChange: (plan: ScrapePlan) => void;
  onApprove: () => void;
  onBack: () => void;
}) {
  // Disabled steps are kept visible but excluded on approve.
  const [disabled, setDisabled] = useState<Set<number>>(new Set());

  const modifiedIndexes = useMemo(() => {
    const set = new Set<number>();
    plan.steps.forEach((step, index) => {
      if (originalPlan.steps[index]?.purpose !== step.purpose) set.add(index);
    });
    return set;
  }, [plan, originalPlan]);

  function toggle(index: number) {
    setDisabled((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function setPurpose(index: number, purpose: string) {
    onChange({
      ...plan,
      steps: plan.steps.map((step, i) =>
        i === index ? { ...step, purpose } : step,
      ),
    });
  }

  function approve() {
    const enabled = plan.steps.filter((_, index) => !disabled.has(index));
    if (enabled.length === 0) return;
    onChange({ ...plan, steps: enabled });
    onApprove();
  }

  const enabledCount = plan.steps.length - disabled.size;

  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Edit query
      </button>

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[.16em] text-faint">
            Plan review
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">
            Approve the research operation
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            {plan.interpretation}
          </p>
        </div>
        {cost ? (
          <div className="flex shrink-0 items-center gap-5 rounded-lg border border-stroke px-4 py-2.5">
            <div>
              <p className="tnum text-sm font-semibold">${cost.usd.toFixed(2)}</p>
              <p className="text-[10px] text-faint">est. cost</p>
            </div>
            <div>
              <p className="tnum text-sm font-semibold">~{cost.itemCount}</p>
              <p className="text-[10px] text-faint">est. items</p>
            </div>
            <div>
              <p className="tnum text-sm font-semibold">{enabledCount}</p>
              <p className="text-[10px] text-faint">steps</p>
            </div>
          </div>
        ) : null}
      </div>

      {notice ? (
        <p className="rounded-lg border border-warning/30 bg-warning-muted px-3.5 py-2.5 text-xs text-warning">
          {notice}
        </p>
      ) : null}

      <Card>
        <CardHeader
          title="What will be collected"
          trailing={
            <span className="text-[11px] text-faint">
              Uncheck a step to exclude it
            </span>
          }
        />
        <div className="divide-y divide-stroke">
          {plan.steps.map((step, index) => (
            <StepRow
              key={`${step.connectorId}-${index}`}
              step={step}
              index={index}
              enabled={!disabled.has(index)}
              modified={modifiedIndexes.has(index)}
              onToggle={() => toggle(index)}
              onPurposeChange={(purpose) => setPurpose(index, purpose)}
            />
          ))}
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-faint">
          Parameters are validated again on the server before anything runs.
        </p>
        <Button onClick={approve} disabled={pending || enabledCount === 0}>
          {pending ? "Starting…" : `Approve & run ${enabledCount} step${enabledCount === 1 ? "" : "s"}`}
          {!pending ? <ArrowRight className="size-3.5" /> : null}
        </Button>
      </div>
    </section>
  );
}
