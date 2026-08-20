import { db } from "@/lib/db";
import { LIST_HASH_KEY, detailHashKey, touchDataHash } from "@/lib/data-hash";
import { streamSummary } from "@/lib/ai/synthesize";
import { resultRowsToRecords } from "@/lib/export";
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
    const query = await db.query.findUnique({
      where: { id },
      include: { results: true },
    });
    if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
    if (query.status !== "succeeded") {
      throw new AppError(
        "BAD_REQUEST",
        "A brief can only be generated after the scrape succeeds.",
        400,
      );
    }
    if (query.summary) {
      return Response.json({ summary: query.summary, cached: true });
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
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: "Summary generation failed." })}\n\n`,
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
