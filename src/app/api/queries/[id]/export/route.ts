import { db } from "@/lib/db";
import { recordsToCsv, recordsToJson, resultRowsToRecords } from "@/lib/export";
import { AppError, errorToResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/request-security";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    rateLimit(request, "export", 20);
    const { id } = await context.params;
    const format = new URL(request.url).searchParams.get("format") ?? "json";
    if (format !== "csv" && format !== "json") {
      throw new AppError("BAD_REQUEST", "Export format must be csv or json.", 400);
    }
    const query = await db.query.findUnique({
      where: { id },
      include: { results: true },
    });
    if (!query) throw new AppError("NOT_FOUND", "Query not found.", 404);
    const records = resultRowsToRecords(query.results);
    if (format === "csv") {
      return new Response(recordsToCsv(records), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${id}.csv"`,
          "x-content-type-options": "nosniff",
        },
      });
    }
    return new Response(recordsToJson(records), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${id}.json"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return errorToResponse(error);
  }
}
