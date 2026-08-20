import type { ScrapePlan } from "@/lib/ai/plan-schema";
import { getConnector } from "@/lib/connectors/registry";

export function estimatePlanCost(plan: ScrapePlan) {
  const steps = plan.steps.map((step) => {
    const connector = getConnector(step.connectorId);
    const parsed = connector.inputSchema.parse(step.params);
    const estimate = connector.costEstimate(parsed as never);
    return {
      connectorId: connector.id,
      label: connector.label,
      ...estimate,
    };
  });
  return {
    usd: steps.reduce((sum, step) => sum + step.usd, 0),
    itemCount: steps.reduce((sum, step) => sum + step.itemCount, 0),
    steps,
  };
}
