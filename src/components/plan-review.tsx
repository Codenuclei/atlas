"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, PencilSimple, Play, Spinner } from "@phosphor-icons/react";
import type { ScrapePlan, ScrapeStep } from "@/lib/ai/plan-schema";
import { jobStageLabel } from "@/lib/view-model";
import { Button, Card, CardHeader, cn } from "@/components/ui";

type Cost = { usd: number; itemCount: number; steps: Array<{ note: string }> };

function StepRow({
  step,
  index,
  enabled,
  auto,
  modified,
  blockedBy,
  onToggle,
  onPurposeChange,
}: {
  step: ScrapeStep;
  index: number;
  enabled: boolean;
  /** Disabled because a step it depends on was excluded — not re-checkable. */
  auto: boolean;
  modified: boolean;
  blockedBy: string[];
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
        disabled={auto}
        onChange={onToggle}
        aria-label={`Include step ${index + 1} (${step.connectorId})`}
        className="mt-1 size-3.5 shrink-0 accent-accent disabled:cursor-not-allowed"
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
        {blockedBy.length > 0 ? (
          <p className="mt-1 text-[10px] font-medium text-warning">
            Excluded with {blockedBy.join(", ")}
          </p>
        ) : null}
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
        className="mt-0.5 rounded-md p-1.5 text-faint transition-colors hover:bg-hover hover:text-foreground"
      >
        <PencilSimple size={14} />
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
  disabled,
  autoDisabled,
  onChange,
  onToggle,
  onApprove,
  onBack,
}: {
  query: string;
  plan: ScrapePlan;
  originalPlan: ScrapePlan;
  cost: Cost | null;
  notice: string;
  pending: boolean;
  /** Indexes of steps excluded from the run (user-unchecked and auto-excluded). */
  disabled: Set<number>;
  /** Indexes excluded only because a step they depend on was excluded. */
  autoDisabled: Set<number>;
  onChange: (plan: ScrapePlan) => void;
  onToggle: (index: number) => void;
  onApprove: () => void;
  onBack: () => void;
}) {
  const modifiedIndexes = useMemo(() => {
    const set = new Set<number>();
    plan.steps.forEach((step, index) => {
      if (originalPlan.steps[index]?.purpose !== step.purpose) set.add(index);
    });
    return set;
  }, [plan, originalPlan]);

  const disabledConnectors = useMemo(() => {
    const set = new Set<string>();
    plan.steps.forEach((step, index) => {
      if (disabled.has(index)) set.add(step.connectorId);
    });
    return set;
  }, [plan, disabled]);

  function setPurpose(index: number, purpose: string) {
    onChange({
      ...plan,
      steps: plan.steps.map((step, i) =>
        i === index ? { ...step, purpose } : step,
      ),
    });
  }

  const enabledCount = plan.steps.length - disabled.size;

  function approve() {
    if (enabledCount === 0) return;
    onApprove();
  }

  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} /> Edit query
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
              Uncheck a step to exclude it and its dependents
            </span>
          }
        />
        <div className="divide-y divide-stroke">
          {plan.steps.map((step, index) => {
            const auto = autoDisabled.has(index);
            const blockedBy = auto
              ? step.dependsOn
                  .filter((dep) => disabledConnectors.has(dep))
                  .map(jobStageLabel)
              : [];
            return (
              <StepRow
                key={`${step.connectorId}-${index}`}
                step={step}
                index={index}
                enabled={!disabled.has(index)}
                auto={auto}
                modified={modifiedIndexes.has(index)}
                blockedBy={blockedBy}
                onToggle={() => onToggle(index)}
                onPurposeChange={(purpose) => setPurpose(index, purpose)}
              />
            );
          })}
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-faint">
          Parameters are validated again on the server before anything runs.
        </p>
        <Button onClick={approve} disabled={pending || enabledCount === 0}>
          {pending ? (
            <>
              <Spinner size={13} className="animate-spin" /> Starting…
            </>
          ) : (
            <>
              <Play size={13} weight="fill" />
              {`Approve & run ${enabledCount} step${enabledCount === 1 ? "" : "s"}`}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}
