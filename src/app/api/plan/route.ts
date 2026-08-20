import { z } from "zod";
import { createPlanWithSource } from "@/lib/ai/planner";
import { estimatePlanCost } from "@/lib/ai/cost";
import { errorToResponse, AppError } from "@/lib/errors";
import { guardMutation, noStoreHeaders } from "@/lib/request-security";
import { TtlCache, hashText } from "@/lib/data-hash";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  query: z.string().trim().min(3).max(500),
});

type PlanPayload = {
  plan: unknown;
  cost: unknown;
  source: string;
  notice?: string;
};

// Identical prompts within 10 minutes reuse the plan — no repeat LLM call.
const planCache = new TtlCache<PlanPayload>(10 * 60 * 1000, 50);

export async function POST(request: Request) {
  try {
    guardMutation(request, "plan", 12);
    const body = bodySchema.parse(await request.json());
    const cacheKey = hashText(body.query);
    const cached = planCache.get(cacheKey);
    if (cached) {
      return Response.json(
        { ...cached, cached: true },
        { headers: noStoreHeaders() },
      );
    }
    const { plan, source, notice } = await createPlanWithSource(body.query);
    const cost = estimatePlanCost(plan);
    const payload: PlanPayload = { plan, cost, source, notice };
    planCache.set(cacheKey, payload);
    return Response.json(payload, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorToResponse(
        new AppError("BAD_REQUEST", "Query text is required.", 400, error.flatten()),
      );
    }
    return errorToResponse(error);
  }
}
