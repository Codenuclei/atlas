import { regenerateBrief } from "@/lib/orchestrator";
import { errorToResponse } from "@/lib/errors";
import { guardMutation, noStoreHeaders } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardMutation(request, "query-regenerate-brief", 6);
    const { id } = await context.params;
    const query = await regenerateBrief(id);
    return Response.json({ query }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorToResponse(error);
  }
}
