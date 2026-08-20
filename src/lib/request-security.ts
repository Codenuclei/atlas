import { AppError } from "@/lib/errors";

type Bucket = { count: number; resetAt: number };

const globalBuckets = globalThis as unknown as {
  scraperRateLimits?: Map<string, Bucket>;
};

const buckets =
  globalBuckets.scraperRateLimits ?? new Map<string, Bucket>();

if (process.env.NODE_ENV !== "production") {
  globalBuckets.scraperRateLimits = buckets;
}

function clientKey(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

export function assertApiAccess(request: Request) {
  const hostname = new URL(request.url).hostname;
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return;

  const configuredToken = process.env.APP_ACCESS_TOKEN?.trim();
  const suppliedToken =
    request.headers.get("x-app-token") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (configuredToken && suppliedToken === configuredToken) return;

  throw new AppError(
    "UNAUTHORIZED",
    "Remote API access is disabled. Use localhost or configure APP_ACCESS_TOKEN.",
    401,
  );
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) {
    throw new AppError("UNAUTHORIZED", "Cross-origin request rejected.", 403);
  }
}

export function rateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs = 60_000,
) {
  assertApiAccess(request);
  const now = Date.now();
  const key = `${scope}:${clientKey(request)}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests. Wait a moment and try again.",
      429,
    );
  }
}

export function guardMutation(
  request: Request,
  scope: string,
  limit = 20,
) {
  assertSameOrigin(request);
  rateLimit(request, scope, limit);
}

export function noStoreHeaders() {
  return {
    "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
  };
}