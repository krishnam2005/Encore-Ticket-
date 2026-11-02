import { AppError, errorResponse } from "./errors";

/**
 * Basic observability: a request id on every request/response/log line, one structured JSON log
 * line per request, and in-memory counters.
 *
 * Caveat: counters live in process memory. On serverless (Vercel) each instance has its own and
 * they reset on cold start, so /admin/metrics is a per-instance sample, not a global total. In
 * production, export to Prometheus/Datadog/OTel instead.
 */

const counters = new Map<string, number>();
const startedAt = new Date();

function key(name: string, labels?: Record<string, string | number>): string {
  if (!labels) return name;
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k])}"`);
  return `${name}{${parts.join(",")}}`;
}

export function inc(name: string, labels?: Record<string, string | number>, by = 1): void {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
}

export function metricsSnapshot(): { started_at: string; scope: string; counters: Record<string, number> } {
  return {
    started_at: startedAt.toISOString(),
    scope: "this server instance only (in-memory; resets on restart / cold start)",
    counters: Object.fromEntries([...counters.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

function resolveRequestId(req: Request): string {
  const incoming = req.headers.get("x-request-id");
  return incoming !== null && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
}

/** Wraps a route handler: request id, timing, structured log, metrics, uniform error responses. */
export async function instrument(
  route: string,
  req: Request,
  fn: (ctx: { requestId: string }) => Promise<Response>,
): Promise<Response> {
  const requestId = resolveRequestId(req);
  const started = performance.now();
  let response: Response;
  try {
    response = await fn({ requestId });
  } catch (err) {
    if (err instanceof AppError) inc("api_errors_total", { code: err.code, route });
    response = errorResponse(err, requestId);
  }
  const durationMs = Math.round(performance.now() - started);
  response.headers.set("x-request-id", requestId);

  inc("http_requests_total", { route, status: response.status });
  inc("http_request_duration_ms_sum", { route }, durationMs);
  inc("http_request_duration_ms_count", { route });
  console.log(
    JSON.stringify({
      level: "info",
      msg: "request",
      request_id: requestId,
      method: req.method,
      route,
      status: response.status,
      duration_ms: durationMs,
    }),
  );
  return response;
}
