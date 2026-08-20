import { z } from "zod";
import { createPlanWithSource } from "@/lib/ai/planner";
import { estimatePlanCost } from "@/lib/ai/cost";
import { errorToResponse, AppError } from "@/lib/errors";
import { guardMutation, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  query: z.string().trim().min(3).max(500),
});

export async function POST(request: Request) {
  try {
    guardMutation(request, "plan", 12);
    const body = bodySchema.parse(await request.json());
    const { plan, source, notice } = await createPlanWithSource(body.query);
    const cost = estimatePlanCost(plan);
    return Response.json(
      { plan, cost, source, notice },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorToResponse(
        new AppError("BAD_REQUEST", "Query text is required.", 400, error.flatten()),
      );
    }
    return errorToResponse(error);
  }
}
