import { claimQueuedWork } from "@/lib/orchestrator";
import { errorToResponse } from "@/lib/errors";
import { noStoreHeaders, rateLimit } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Backend drain: claim queued / orphaned jobs and start them. */
export async function POST(request: Request) {
  try {
    rateLimit(request, "work-claim", 20);
    const result = await claimQueuedWork();
    return Response.json(result, { headers: noStoreHeaders() });
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function GET(request: Request) {
  return POST(request);
}