import { AppError } from "./errors";

/**
 * Fixed-window rate limiter, keyed by client.
 *
 * Caveat (documented trade-off): state is in process memory. On serverless each instance counts
 * separately, so the effective limit is per instance: good enough to blunt a single abusive client
 * or a hold-hoarding loop, NOT a hard global guarantee. A shared store (Redis/Upstash, or a Postgres
 * counter) is the production answer.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_TRACKED_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number, now: number = Date.now()): RateLimitResult {
  if (windows.size > MAX_TRACKED_KEYS) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    w = { count: 0, resetAt: now + windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  const allowed = w.count <= limit;
  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - w.count),
    retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - now) / 1000)),
  };
}

export function resetRateLimits(): void {
  windows.clear();
}

/** Best-effort client identity: first hop of x-forwarded-for (set by Vercel), else x-real-ip. */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

/** Throws a structured 429 when the client is over the limit. limit <= 0 disables the check. */
export function enforceRateLimit(req: Request, scope: string, limit: number, windowMs = 60_000): void {
  if (limit <= 0) return;
  const result = checkRateLimit(`${scope}:${clientKey(req)}`, limit, windowMs);
  if (!result.allowed) {
    throw new AppError(
      429,
      "RATE_LIMITED",
      `Too many requests. Retry in ${result.retryAfterSeconds}s.`,
      { limit: result.limit, retry_after_seconds: result.retryAfterSeconds },
      { "retry-after": String(result.retryAfterSeconds) },
    );
  }
}

export function holdsRateLimitPerMinute(): number {
  const raw = process.env.HOLDS_RATE_LIMIT_PER_MIN;
  const parsed = raw === undefined || raw === "" ? 120 : Number(raw);
  return Number.isFinite(parsed) ? parsed : 120;
}
