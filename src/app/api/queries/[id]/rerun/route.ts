import { rerunQuery } from "@/lib/orchestrator";
import { errorToResponse } from "@/lib/errors";
import { guardMutation, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardMutation(request, "query-rerun", 10);
    const { id } = await context.params;
    const query = await rerunQuery(id);
    return Response.json({ query }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    return errorToResponse(error);
  }
}