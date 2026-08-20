import { deleteQuery, getQuery, syncQuery } from "@/lib/orchestrator";
import { errorToResponse } from "@/lib/errors";
import { guardMutation, noStoreHeaders, rateLimit } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    rateLimit(request, "query-read", 120);
    const { id } = await context.params;
    const query = await getQuery(id);
    return Response.json({ query }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardMutation(request, "query-sync", 90);
    const { id } = await context.params;
    const query = await syncQuery(id);
    return Response.json({ query }, { headers: noStoreHeaders() });
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardMutation(request, "query-delete", 10);
    const { id } = await context.params;
    const deleted = await deleteQuery(id);
    return Response.json({ deleted });
  } catch (error) {
    return errorToResponse(error);
  }
}
