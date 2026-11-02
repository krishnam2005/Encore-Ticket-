export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_JSON"
  | "EVENT_NOT_FOUND"
  | "TIER_NOT_FOUND"
  | "HOLD_NOT_FOUND"
  | "ORDER_NOT_FOUND"
  | "OVERSOLD"
  | "HOLD_NOT_ACTIVE"
  | "PAYMENT_MISMATCH"
  | "RATE_LIMITED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONTENTION"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export function errorResponse(err: unknown, requestId?: string): Response {
  const request_id = requestId === undefined ? {} : { request_id: requestId };
  if (err instanceof AppError) {
    return Response.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}), ...request_id } },
      { status: err.status, headers: err.headers },
    );
  }
  // Never leak internals; log the real cause server-side (with the request id so it can be found).
  console.error(JSON.stringify({ level: "error", msg: "unhandled", request_id: requestId, err: String(err) }));
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "Unexpected server error", ...request_id } },
    { status: 500 },
  );
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}
