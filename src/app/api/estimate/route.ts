import { z } from "zod";
import { scrapePlanSchema } from "@/lib/ai/plan-schema";
import { estimatePlanCost } from "@/lib/ai/cost";
import { validatePlan } from "@/lib/ai/planner";
import { AppError, errorToResponse } from "@/lib/errors";
import { guardMutation, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    guardMutation(request, "estimate", 60);
    const plan = validatePlan(scrapePlanSchema.parse(await request.json()));
    return Response.json(
      { cost: estimatePlanCost(plan), plan },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorToResponse(
        new AppError("BAD_REQUEST", "The edited plan is invalid.", 400),
      );
    }
    return errorToResponse(error);
  }
}