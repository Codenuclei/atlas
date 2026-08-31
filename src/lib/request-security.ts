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
  // Localhost is always open (dev / local tooling).
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return;

  const configuredToken = process.env.APP_ACCESS_TOKEN?.trim();
  if (!configuredToken) {
    throw new AppError(
      "UNAUTHORIZED",
      "Remote API access is disabled. Use localhost or configure APP_ACCESS_TOKEN.",
      401,
    );
  }

  // APP_ACCESS_TOKEN set → remote enabled (needed for *.cohesivity.app UI).
  // If a client sends x-app-token / Bearer, it must match; same-origin
  // browser fetches typically omit it and are still allowed.
  const suppliedToken =
    request.headers.get("x-app-token") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (suppliedToken && suppliedToken !== configuredToken) {
    throw new AppError("UNAUTHORIZED", "Invalid APP_ACCESS_TOKEN.", 401);
  }
}

function normalizeHost(host: string) {
  return host.replace(/:\d+$/, "").toLowerCase();
}

function allowedHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | null | undefined) => {
    const raw = value?.split(",")[0]?.trim();
    if (!raw) return;
    hosts.add(normalizeHost(raw));
  };
  try {
    add(new URL(request.url).host);
  } catch {
    /* ignore malformed request url */
  }
  // Behind Cohesivity / Railway proxies, request.url is often the upstream
  // host while the browser Origin is the public *.cohesivity.app host.
  for (const header of ["x-forwarded-host", "x-original-host", "host"] as const) {
    add(request.headers.get(header));
  }
  add(process.env.APP_PUBLIC_HOST);
  add(process.env.COHESIVITY_PUBLIC_HOST);
  const publicUrl =
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.COHESIVITY_DEPLOYMENT_URL?.trim();
  if (publicUrl) {
    try {
      add(new URL(publicUrl).host);
    } catch {
      /* ignore */
    }
  }
  return hosts;
}

function isCohesivityPublicHost(host: string) {
  return host === "cohesivity.app" || host.endsWith(".cohesivity.app");
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = normalizeHost(new URL(origin).host);
  } catch {
    throw new AppError("UNAUTHORIZED", "Cross-origin request rejected.", 403);
  }
  const allowed = allowedHosts(request);
  if (allowed.has(originHost)) return;

  // Cohesivity edge often forwards an internal Railway host while the browser
  // Origin is https://<tenant>.cohesivity.app. Trust that public Origin when
  // this process is the Cohesivity-hosted app (or any allowed host is too).
  const hostedOnCohesivity =
    Boolean(process.env.COH_APPLICATION_KEY?.trim()) ||
    process.env.DATABASE_PROVIDER === "cohesivity" ||
    [...allowed].some(isCohesivityPublicHost);
  if (hostedOnCohesivity && isCohesivityPublicHost(originHost)) return;

  throw new AppError("UNAUTHORIZED", "Cross-origin request rejected.", 403);
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