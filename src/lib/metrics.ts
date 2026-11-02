/**
 * Turns the flat counter map returned by GET /admin/metrics, e.g.
 *   { 'http_requests_total{route="GET /events/:event_id",status="200"}': 12, ... }
 * into structured summaries. Pure functions; everything shown is derived from the API response.
 */

export interface ParsedCounter {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const KEY_RE = /^([A-Za-z_][A-Za-z0-9_]*)(?:\{(.*)\})?$/;
const LABEL_RE = /([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"/g;

export function parseCounters(counters: Record<string, number>): ParsedCounter[] {
  const parsed: ParsedCounter[] = [];
  for (const [key, value] of Object.entries(counters)) {
    const m = KEY_RE.exec(key);
    if (!m || m[1] === undefined) continue;
    const labels: Record<string, string> = {};
    if (m[2]) for (const l of m[2].matchAll(LABEL_RE)) if (l[1] !== undefined) labels[l[1]] = l[2] ?? "";
    parsed.push({ name: m[1], labels, value });
  }
  return parsed;
}

const sum = (xs: ParsedCounter[]): number => xs.reduce((n, c) => n + c.value, 0);
const named = (xs: ParsedCounter[], name: string): ParsedCounter[] => xs.filter((c) => c.name === name);

export interface RouteStat {
  route: string;
  total: number;
  errors: number; // responses with status >= 400
  avgMs: number | null;
  statuses: Array<{ status: number; count: number }>;
}

export interface MetricsSummary {
  totalRequests: number;
  errorResponses: number; // status >= 400
  serverErrors: number; // status >= 500
  errorRate: number | null; // errorResponses / totalRequests
  routes: RouteStat[];
  errorsByCode: Array<{ code: string; count: number }>;
  webhooks: Array<{ type: string; outcome: string; count: number }>;
  webhooksTotal: number;
  holdsByTier: Array<{ tier_id: string; count: number }>;
  holdsCreated: number;
  retries: Array<{ sqlstate: string; count: number }>;
  retriesTotal: number;
}

export function summarizeMetrics(counters: Record<string, number>): MetricsSummary {
  const all = parseCounters(counters);

  const requests = named(all, "http_requests_total");
  const durSum = new Map(named(all, "http_request_duration_ms_sum").map((c) => [c.labels.route ?? "", c.value]));
  const durCount = new Map(named(all, "http_request_duration_ms_count").map((c) => [c.labels.route ?? "", c.value]));

  const byRoute = new Map<string, RouteStat>();
  for (const c of requests) {
    const route = c.labels.route ?? "(unknown)";
    const status = Number(c.labels.status);
    const stat = byRoute.get(route) ?? { route, total: 0, errors: 0, avgMs: null, statuses: [] };
    stat.total += c.value;
    if (status >= 400) stat.errors += c.value;
    stat.statuses.push({ status, count: c.value });
    byRoute.set(route, stat);
  }
  for (const stat of byRoute.values()) {
    const n = durCount.get(stat.route);
    const s = durSum.get(stat.route);
    stat.avgMs = n && n > 0 && s !== undefined ? Math.round(s / n) : null;
    stat.statuses.sort((a, b) => a.status - b.status);
  }

  const totalRequests = sum(requests);
  const errorResponses = sum(requests.filter((c) => Number(c.labels.status) >= 400));
  const serverErrors = sum(requests.filter((c) => Number(c.labels.status) >= 500));

  const errorsByCode = new Map<string, number>();
  for (const c of named(all, "api_errors_total")) {
    const code = c.labels.code ?? "(unknown)";
    errorsByCode.set(code, (errorsByCode.get(code) ?? 0) + c.value);
  }

  const webhooks = named(all, "webhooks_total").map((c) => ({
    type: c.labels.type ?? "(unknown)",
    outcome: c.labels.outcome ?? "(unknown)",
    count: c.value,
  }));

  const holds = named(all, "holds_created_total").map((c) => ({ tier_id: c.labels.tier_id ?? "(unknown)", count: c.value }));
  const retries = named(all, "db_tx_retries_total").map((c) => ({ sqlstate: c.labels.sqlstate ?? "(unknown)", count: c.value }));

  return {
    totalRequests,
    errorResponses,
    serverErrors,
    errorRate: totalRequests > 0 ? errorResponses / totalRequests : null,
    routes: [...byRoute.values()].sort((a, b) => b.total - a.total),
    errorsByCode: [...errorsByCode.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    webhooks: webhooks.sort((a, b) => b.count - a.count),
    webhooksTotal: sum(named(all, "webhooks_total")),
    holdsByTier: holds.sort((a, b) => b.count - a.count),
    holdsCreated: sum(named(all, "holds_created_total")),
    retries: retries.sort((a, b) => b.count - a.count),
    retriesTotal: sum(named(all, "db_tx_retries_total")),
  };
}

export function errorCount(summary: MetricsSummary, code: string): number {
  return summary.errorsByCode.find((e) => e.code === code)?.count ?? 0;
}

export function webhookOutcomeCount(summary: MetricsSummary, outcome: string): number {
  return summary.webhooks.filter((w) => w.outcome === outcome).reduce((n, w) => n + w.count, 0);
}

/** Human labels for the SQLSTATE codes the retry counter can carry. */
export function describeSqlState(code: string): string {
  if (code === "40001") return "Serialization failure (transaction retried)";
  if (code === "40P01") return "Deadlock detected (transaction retried)";
  return `SQLSTATE ${code}`;
}

export function formatUptime(fromIso: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(fromIso).getTime());
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
