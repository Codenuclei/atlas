export type AppErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM"
  | "PLAN_REFUSED"
  | "PLAN_INVALID"
  | "COST_CAP"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly status = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorToResponse(error: unknown) {
  if (error instanceof AppError) {
    const exposeDetails =
      process.env.NODE_ENV !== "production" && error.status < 500;
    return Response.json(
      {
        error: error.code,
        message: error.status >= 500 ? "The service could not complete the request." : error.message,
        ...(exposeDetails ? { details: error.details } : {}),
      },
      {
        status: error.status,
        headers: { "cache-control": "no-store" },
      },
    );
  }
  if (process.env.NODE_ENV !== "test") {
    console.error("Unhandled API error", error);
  }
  return Response.json(
    { error: "INTERNAL", message: "The service could not complete the request." },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}
