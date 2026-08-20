import { abortQuery } from "@/lib/orchestrator";
import { errorToResponse } from "@/lib/errors";
import { guardMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardMutation(request, "query-abort", 20);
    const { id } = await context.params;
    const query = await abortQuery(id);
    return Response.json({ query });
  } catch (error) {
    return errorToResponse(error);
  }
}
