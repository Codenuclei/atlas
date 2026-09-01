import { db } from "@/lib/db";
import { LIST_HASH_KEY, detailHashKey, touchDataHash } from "@/lib/data-hash";
import { streamSummary } from "@/lib/ai/synthesize";
import { logClaude } from "@/lib/ai/claude-log";
import { resultRowsToRecords } from "@/lib/export";
import { isTerminalQueryStatus, reconcileQueryStatus } from "@/lib/status";
import { AppError, errorToResponse } from "@/lib/errors";
import { guardMutation } from "@/lib/request-security";

export const runtime = "nodejs";
export const maxDuration = 120;

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
    const query = await db.query.findUnique({
      where: { id },
      include: { results: true, jobs: true },
    });
    if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
    const status = reconcileQueryStatus(
      query.status,
      query.jobs.map((job) => job.status),
    );
    if (!isTerminalQueryStatus(status)) {
      throw new AppError(
        "BAD_REQUEST",
        "A brief can only be generated after the run finishes.",
        400,
      );
    }
    if (query.results.length === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "No collected results to synthesize a brief from.",
        400,
      );
    }
    if (query.summary && !force) {
      logClaude("stream_summary.cached", { queryId: id });
      return Response.json({ summary: query.summary, cached: true });
    }

    if (force && query.summary) {
      await db.query.update({
        where: { id },
        data: { summary: null, synthesisStartedAt: null },
      });
    }

    const claim = await db.query.updateMany({
      where: { id, summary: null, synthesisStartedAt: null },
      data: { synthesisStartedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "A brief is already being generated.",
        409,
      );
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const write = (delta: string) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
        };
        try {
          const summary = await streamSummary(
            query.text,
            resultRowsToRecords(query.results),
            write,
            { queryId: id, trigger: force ? "regenerate" : "manual" },
          );
          await db.query.update({ where: { id }, data: { summary } });
          await touchDataHash(LIST_HASH_KEY, detailHashKey(id));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, summary })}\n\n`));
        } catch (error) {
          console.error("Summary stream failed", error);
          await db.query.update({
            where: { id },
            data: { synthesisStartedAt: null },
          });
          const message =
            error && typeof error === "object" && "message" in error
              ? String((error as { message: unknown }).message)
              : "Summary generation failed.";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: message })}\n\n`,
            ),
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
