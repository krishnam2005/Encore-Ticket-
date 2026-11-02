import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { errorCount, formatUptime, parseCounters, summarizeMetrics, webhookOutcomeCount } from "@/lib/metrics";

// Keys exactly as produced by src/lib/observability.ts
const counters: Record<string, number> = {
  'http_requests_total{route="POST /events/:event_id/holds",status="201"}': 29,
  'http_requests_total{route="POST /events/:event_id/holds",status="409"}': 21,
  'http_requests_total{route="GET /events/:event_id",status="200"}': 50,
  'http_requests_total{route="POST /webhooks/payments",status="500"}': 1,
  'http_request_duration_ms_sum{route="GET /events/:event_id"}': 5000,
  'http_request_duration_ms_count{route="GET /events/:event_id"}': 50,
  'api_errors_total{code="OVERSOLD",route="POST /events/:event_id/holds"}': 21,
  'api_errors_total{code="UNAUTHORIZED",route="GET /admin/audit"}': 2,
  'api_errors_total{code="UNAUTHORIZED",route="GET /admin/metrics"}': 1,
  'webhooks_total{outcome="paid_from_hold",type="order.paid"}': 5,
  'webhooks_total{outcome="duplicate",type="order.paid"}': 5,
  'holds_created_total{tier_id="tier_002_b"}': 24,
  'holds_created_total{tier_id="tier_001_a"}': 5,
  'db_tx_retries_total{sqlstate="40001"}': 50,
};

describe("metrics parsing", () => {
  it("parses names and labels, including slashes, colons and spaces in route labels", () => {
    const parsed = parseCounters(counters);
    const first = parsed.find((c) => c.name === "http_requests_total" && c.labels.status === "201");
    assert.deepEqual(first?.labels, { route: "POST /events/:event_id/holds", status: "201" });
    assert.equal(first?.value, 29);
  });

  it("parses a counter with no labels", () => {
    assert.deepEqual(parseCounters({ plain_total: 3 }), [{ name: "plain_total", labels: {}, value: 3 }]);
  });
});

describe("summarizeMetrics", () => {
  const s = summarizeMetrics(counters);

  it("totals requests and separates error responses from server errors", () => {
    assert.equal(s.totalRequests, 101);
    assert.equal(s.errorResponses, 22); // 21 x 409 + 1 x 500
    assert.equal(s.serverErrors, 1);
    assert.equal(s.errorRate, 22 / 101);
  });

  it("computes per-route average latency from sum/count and tolerates routes without it", () => {
    const get = s.routes.find((r) => r.route === "GET /events/:event_id");
    assert.equal(get?.avgMs, 100);
    const holds = s.routes.find((r) => r.route === "POST /events/:event_id/holds");
    assert.equal(holds?.avgMs, null);
    assert.equal(holds?.errors, 21);
  });

  it("aggregates errors by code across routes", () => {
    assert.equal(errorCount(s, "UNAUTHORIZED"), 3);
    assert.equal(errorCount(s, "OVERSOLD"), 21);
    assert.equal(errorCount(s, "RATE_LIMITED"), 0);
  });

  it("summarizes webhooks, holds and retries", () => {
    assert.equal(s.webhooksTotal, 10);
    assert.equal(webhookOutcomeCount(s, "duplicate"), 5);
    assert.equal(s.holdsCreated, 29);
    assert.equal(s.holdsByTier[0]?.tier_id, "tier_002_b");
    assert.equal(s.retriesTotal, 50);
  });

  it("handles an empty counter map without dividing by zero", () => {
    const empty = summarizeMetrics({});
    assert.equal(empty.totalRequests, 0);
    assert.equal(empty.errorRate, null);
    assert.deepEqual(empty.routes, []);
  });
});

describe("formatUptime", () => {
  it("formats seconds, minutes, hours and days", () => {
    const t = Date.parse("2026-01-01T00:00:00Z");
    assert.equal(formatUptime("2026-01-01T00:00:00Z", t + 42_000), "42s");
    assert.equal(formatUptime("2026-01-01T00:00:00Z", t + 125_000), "2m 5s");
    assert.equal(formatUptime("2026-01-01T00:00:00Z", t + 3 * 3600_000 + 5 * 60_000), "3h 5m");
    assert.equal(formatUptime("2026-01-01T00:00:00Z", t + 2 * 86400_000 + 5 * 3600_000), "2d 5h");
  });
});
