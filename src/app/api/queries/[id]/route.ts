import { deleteQuery, getQuery, syncQuery } from "@/lib/orchestrator";
import { errorToResponse } from "@/lib/errors";
import { guardMutation, noStoreHeaders, rateLimit } from "@/lib/request-security";
import {
  detailHashKey,
  hashQueryDetail,
  readPooledHash,
  writePooledHash,
} from "@/lib/data-hash";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    rateLimit(request, "query-read", 120);
    const { id } = await context.params;
    const knownHash = new URL(request.url).searchParams.get("hash");
    const poolKey = detailHashKey(id);
    if (knownHash) {
      const pooled = await readPooledHash(poolKey);
      if (pooled && pooled === knownHash) {
        return new Response(null, {
          status: 304,
          headers: { ...noStoreHeaders(), "x-data-hash": pooled },
        });
      }
    }
    const query = await getQuery(id);
    const hash = hashQueryDetail(query);
    await writePooledHash(poolKey, hash);
    const headers = { ...noStoreHeaders(), "x-data-hash": hash };
    if (knownHash && knownHash === hash) {
      return new Response(null, { status: 304, headers });
    }
    return Response.json({ query, hash }, { headers });
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
    const knownHash = request.headers.get("x-known-hash");
    const poolKey = detailHashKey(id);
    // syncQuery bumps the pool when (and only when) it mutates something,
    // so a pool match here means this sync changed nothing.
    await syncQuery(id);
    if (knownHash) {
      const pooled = await readPooledHash(poolKey);
      if (pooled && pooled === knownHash) {
        return Response.json(
          { unchanged: true, hash: pooled },
          { headers: noStoreHeaders() },
        );
      }
    }
    const query = await getQuery(id);
    const hash = hashQueryDetail(query);
    await writePooledHash(poolKey, hash);
    return Response.json(
      { query, hash },
      { headers: { ...noStoreHeaders(), "x-data-hash": hash } },
    );
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
