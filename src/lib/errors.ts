export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_JSON"
  | "EVENT_NOT_FOUND"
  | "TIER_NOT_FOUND"
  | "HOLD_NOT_FOUND"
  | "OVERSOLD"
  | "HOLD_NOT_ACTIVE"
  | "PAYMENT_MISMATCH"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.status },
    );
  }
  // Never leak internals; log the real cause server-side.
  console.error(JSON.stringify({ level: "error", msg: "unhandled", err: String(err) }));
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } },
    { status: 500 },
  );
}

/** Wraps a route body so every thrown error becomes a structured JSON response. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}
