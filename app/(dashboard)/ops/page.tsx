"use client";

import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { AdminGate } from "@/components/admin/AdminGate";
import { BarList, EmptyState } from "@/components/admin/BarList";
import { Alert, Badge, Button, Card, PageHeader, Skeleton, StatCard, type Tone } from "@/components/ui";
import { describeSqlState, formatUptime, summarizeMetrics } from "@/lib/metrics";
import { describeOutcome } from "@/lib/outcomes";
import { useMetrics } from "@/lib/use-metrics";

const POLL_MS = 10_000;

export default function AdminOverviewPage() {
  return (
    <>
      <PageHeader
        title="Admin overview"
        description="Operational counters from GET /admin/metrics: traffic, errors, webhook outcomes and transaction retries."
      />
      <AdminGate>
        <Overview />
      </AdminGate>
    </>
  );
}

function Overview() {
  const [auto, setAuto] = useState(false);
  const m = useMetrics(auto ? POLL_MS : null);
  const summary = useMemo(() => (m.data ? summarizeMetrics(m.data.counters) : null), [m.data]);
  const busy = m.status === "loading" || m.status === "refreshing";

  const controls = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {m.data && (
          <>
            <Badge tone="info">locking: {m.data.inventory_locking}</Badge>
            <span>instance up {formatUptime(m.data.started_at)}</span>
            {m.updatedAt && <span>· updated {m.updatedAt.toLocaleTimeString("en-GB")}</span>}
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
            className="size-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
          />
          Auto-refresh ({POLL_MS / 1000}s)
        </label>
        <Button onClick={() => void m.refresh()} loading={busy} icon={<RefreshCw className="size-4" aria-hidden />}>
          Refresh
        </Button>
      </div>
    </div>
  );

  if (m.status === "loading" && !m.data) {
    return (
      <>
        {controls}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </>
    );
  }

  if (!m.data || !summary) {
    return (
      <>
        {controls}
        <Alert tone={m.error?.kind === "disabled" ? "warn" : "bad"} title="Could not load metrics">
          {m.error?.message ?? "Unknown error."}
        </Alert>
      </>
    );
  }

  const errPct = summary.errorRate === null ? "—" : `${(summary.errorRate * 100).toFixed(1)}%`;

  return (
    <>
      {controls}

      {m.status === "error" && m.error && (
        <div className="mb-4">
          <Alert tone="warn" title="Showing the last successful load">
            The latest refresh failed: {m.error.message}
          </Alert>
        </div>
      )}

      <div className="mb-5">
        <Alert tone="info" title="Scope of these numbers">
          {m.data.scope.charAt(0).toUpperCase() + m.data.scope.slice(1)}. On serverless hosting each instance keeps its own counters, so treat these as a sample of this instance, not a global total.
        </Alert>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Requests" value={summary.totalRequests.toLocaleString()} hint={`${summary.routes.length} routes seen`} />
        <StatCard
          label="Error responses"
          value={summary.errorResponses.toLocaleString()}
          hint={`${errPct} of requests · ${summary.serverErrors} server (5xx)`}
          badge={summary.serverErrors > 0 ? <Badge tone="bad">5xx</Badge> : undefined}
        />
        <StatCard label="Webhooks received" value={summary.webhooksTotal.toLocaleString()} hint={`${summary.webhooks.length} type/outcome combinations`} />
        <StatCard
          label="Transaction retries"
          value={summary.retriesTotal.toLocaleString()}
          hint={
            summary.retriesTotal === 0 && m.data.inventory_locking === "tier-lock"
              ? "none expected in tier-lock mode"
              : "serialization conflicts retried"
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Requests by route" description="Count, error responses and average latency per route (this instance).">
          {summary.routes.length === 0 ? (
            <EmptyState title="No requests recorded yet">Counters appear as soon as the API receives traffic.</EmptyState>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                    <th className="pb-2 pl-1 font-medium">Route</th>
                    <th className="pb-2 text-right font-medium">Requests</th>
                    <th className="pb-2 text-right font-medium">Errors</th>
                    <th className="pb-2 pr-1 text-right font-medium">Avg latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {summary.routes.map((r) => (
                    <tr key={r.route}>
                      <td className="py-2.5 pl-1 font-mono text-xs text-zinc-800">{r.route}</td>
                      <td className="py-2.5 text-right tabular-nums">{r.total.toLocaleString()}</td>
                      <td className="py-2.5 text-right tabular-nums">
                        {r.errors > 0 ? <Badge tone="warn">{r.errors.toLocaleString()}</Badge> : <span className="text-zinc-400">0</span>}
                      </td>
                      <td className="py-2.5 pr-1 text-right tabular-nums text-zinc-600">{r.avgMs === null ? "—" : `${r.avgMs} ms`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2" title="Errors by code" description="Structured API errors returned.">
          {summary.errorsByCode.length === 0 ? (
            <EmptyState title="No API errors recorded" />
          ) : (
            <BarList
              items={summary.errorsByCode.map((e) => ({
                key: e.code,
                label: <span className="font-mono text-xs">{e.code}</span>,
                value: e.count,
                tone: errorTone(e.code),
              }))}
            />
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Webhook outcomes" description="What happened to each processed webhook delivery.">
          {summary.webhooks.length === 0 ? (
            <EmptyState title="No webhooks received yet" />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {summary.webhooks.map((w) => {
                const info = describeOutcome(w.outcome);
                return (
                  <li key={`${w.type}:${w.outcome}`} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-800">
                        <span className="font-mono text-xs">{w.outcome}</span>
                        <Badge tone={toneFor(info.tone)}>{w.type}</Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">{info.title}</p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">{w.count.toLocaleString()}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Holds created by tier">
            {summary.holdsByTier.length === 0 ? (
              <EmptyState title="No holds created on this instance yet" />
            ) : (
              <BarList
                items={summary.holdsByTier.map((h) => ({
                  key: h.tier_id,
                  label: <span className="font-mono text-xs">{h.tier_id}</span>,
                  value: h.count,
                }))}
              />
            )}
          </Card>
          <Card title="Transaction retries" description="Only occurs in lock-free (serializable) mode under contention.">
            {summary.retries.length === 0 ? (
              <EmptyState title="No retries recorded">
                {m.data.inventory_locking === "tier-lock"
                  ? "The server is in tier-lock mode, where holds queue on a row lock instead of retrying."
                  : "No serialization conflicts have occurred on this instance yet."}
              </EmptyState>
            ) : (
              <BarList
                items={summary.retries.map((r) => ({
                  key: r.sqlstate,
                  label: describeSqlState(r.sqlstate),
                  value: r.count,
                  tone: "warn",
                  hint: `SQLSTATE ${r.sqlstate}`,
                }))}
              />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function errorTone(code: string): Tone {
  if (code === "INTERNAL_ERROR" || code === "CONTENTION") return "bad";
  if (code === "OVERSOLD" || code === "RATE_LIMITED" || code === "UNAUTHORIZED") return "warn";
  return "neutral";
}

function toneFor(t: "good" | "neutral" | "warn" | "bad"): Tone {
  return t;
}
