import { z } from "zod";
import { scrapePlanSchema } from "@/lib/ai/plan-schema";
import { createQueryFromPlan, listQueries } from "@/lib/orchestrator";
import { AppError, errorToResponse } from "@/lib/errors";
import { guardMutation, noStoreHeaders, rateLimit } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 120;

const createSchema = z.object({
  query: z.string().trim().min(3).max(500),
  plan: scrapePlanSchema,
});

export async function GET(request: Request) {
  try {
    rateLimit(request, "query-list", 60);
    const queries = await listQueries();
    return Response.json({ queries }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    guardMutation(request, "query-create", 10);
    const body = createSchema.parse(await request.json());
    const query = await createQueryFromPlan(body.query, body.plan);
    return Response.json({ query }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorToResponse(
        new AppError("BAD_REQUEST", "Invalid query payload.", 400, error.flatten()),
      );
    }
    return errorToResponse(error);
  }
}
