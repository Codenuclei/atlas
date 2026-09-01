import { persistQueryBrief } from "@/lib/orchestrator";
import { logClaude } from "@/lib/ai/claude-log";
import { AppError, errorToResponse } from "@/lib/errors";
import { guardMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Brief endpoint: DB is source of truth.
 * - Cached summary → JSON
 * - Otherwise claim + generate + persist, while streaming deltas over SSE
 * Client can disconnect; persist still completes via persistQueryBrief.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    guardMutation(request, "summary", 4);
    const { id } = await context.params;
    const force =
      new URL(request.url).searchParams.get("force") === "1" ||
      new URL(request.url).searchParams.get("regenerate") === "1";

    // Fast path: already persisted — no SSE needed.
    if (!force) {
      const cached = await persistQueryBrief(id, {
        force: false,
        trigger: "manual",
      }).catch((error) => {
        if (error instanceof AppError && error.status === 409) return null;
        throw error;
      });
      if (cached?.cached && cached.summary) {
        logClaude("stream_summary.cached", { queryId: id });
        return Response.json({ summary: cached.summary, cached: true });
      }
      if (cached && !cached.cached && cached.summary) {
        // Background/auto just finished — return JSON (already in DB).
        return Response.json({ summary: cached.summary, cached: false });
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const write = (delta: string) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`),
          );
        };
        try {
          const result = await persistQueryBrief(id, {
            force,
            trigger: force ? "regenerate" : "manual",
            onDelta: write,
          });
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, summary: result.summary, cached: result.cached })}\n\n`,
            ),
          );
        } catch (error) {
          console.error("Summary stream failed", error);
          const message =
            error && typeof error === "object" && "message" in error
              ? String((error as { message: unknown }).message)
              : "Summary generation failed.";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      },
    });
  } catch (error) {
    return errorToResponse(error);
  }
}
