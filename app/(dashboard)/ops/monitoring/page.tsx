"use client";

import { Activity, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminGate } from "@/components/admin/AdminGate";
import { EmptyState } from "@/components/admin/BarList";
import { Alert, Badge, Button, Card, PageHeader, Skeleton, cx, type Tone } from "@/components/ui";
import { useApi } from "@/lib/api-context";
import type { ApiEvent } from "@/lib/api-types";
import { EVENT_IDS } from "@/lib/config";
import { errorCount, formatUptime, summarizeMetrics, webhookOutcomeCount } from "@/lib/metrics";
import { useMetrics } from "@/lib/use-metrics";

const POLL_MS = 10_000;
const SLOW_MS = 1500; // a probe slower than this is labelled "Slow" (a display threshold, not an SLO)
const MAX_SAMPLES = 24;

interface Sample {
  at: number;
  status: number | null;
  ms: number;
}

type Health = "operational" | "slow" | "down";

function healthOf(s: Sample | undefined): Health | null {
  if (!s) return null;
  if (s.status !== 200) return "down";
  return s.ms > SLOW_MS ? "slow" : "operational";
}

const HEALTH_UI: Record<Health, { label: string; tone: Tone }> = {
  operational: { label: "Operational", tone: "good" },
  slow: { label: "Slow", tone: "warn" },
  down: { label: "Down", tone: "bad" },
};

export default function MonitoringPage() {
  return (
    <>
      <PageHeader
        title="System monitoring"
        description="Health and capacity signals built only from what the existing APIs return: live probes, instance metrics and public inventory."
      />
      <AdminGate>
        <Monitoring />
      </AdminGate>
    </>
  );
}

function Monitoring() {
  const { request, events, refreshEvents } = useApi();
  const [paused, setPaused] = useState(false);
  const metrics = useMetrics(paused ? null : POLL_MS);
  const summary = useMemo(() => (metrics.data ? summarizeMetrics(metrics.data.counters) : null), [metrics.data]);

  // ---- probe the public API from this browser (real request, real latency) ----
  const [publicSamples, setPublicSamples] = useState<Sample[]>([]);
  const probing = useRef(false);
  const probePublic = useCallback(async () => {
    const id = EVENT_IDS[0];
    if (!id || probing.current) return;
    probing.current = true;
    const res = await request<ApiEvent>("GET", `/events/${encodeURIComponent(id)}`);
    probing.current = false;
    setPublicSamples((prev) => [...prev, { at: Date.now(), status: res.entry.status, ms: res.entry.durationMs }].slice(-MAX_SAMPLES));
  }, [request]);

  useEffect(() => {
    void probePublic();
    if (paused) return;
    const t = setInterval(() => void probePublic(), POLL_MS);
    return () => clearInterval(t);
  }, [probePublic, paused]);

  // ---- admin API samples come from the metrics polling ----
  const [adminSamples, setAdminSamples] = useState<Sample[]>([]);
  useEffect(() => {
    if (!metrics.updatedAt && metrics.lastHttpStatus === null) return;
    setAdminSamples((prev) =>
      [...prev, { at: Date.now(), status: metrics.lastHttpStatus, ms: metrics.lastDurationMs ?? 0 }].slice(-MAX_SAMPLES),
    );
    // one sample per completed fetch: keyed on the attempt's own timestamp/status/latency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics.updatedAt, metrics.lastHttpStatus, metrics.lastDurationMs]);

  const lastPublic = publicSamples.at(-1);
  const lastAdmin = adminSamples.at(-1);
  const pubHealth = healthOf(lastPublic);
  const admHealth = healthOf(lastAdmin);

  const overall: { tone: Tone; title: string; text: string } | null =
    pubHealth === null || admHealth === null
      ? null
      : pubHealth === "operational" && admHealth === "operational"
        ? { tone: "good", title: "All probes healthy", text: "Public and admin APIs answered 200 within the latency threshold." }
        : pubHealth === "down" || admHealth === "down"
          ? { tone: "bad", title: "A probe is failing", text: "At least one API did not answer 200. See the cards below." }
          : { tone: "warn", title: "Degraded latency", text: `At least one probe took longer than ${SLOW_MS} ms.` };

  const refreshAll = () => {
    void metrics.refresh();
    void probePublic();
    void refreshEvents();
  };

  const loadedEvents = EVENT_IDS.flatMap((id) => (events[id]?.event ? [events[id].event as ApiEvent] : []));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-zinc-500">
          Probes run from <span className="font-medium text-zinc-700">this browser</span> every {POLL_MS / 1000}s while this page is open.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => setPaused((p) => !p)}>
            {paused ? "Resume polling" : "Pause polling"}
          </Button>
          <Button onClick={refreshAll} icon={<RefreshCw className="size-4" aria-hidden />}>
            Probe now
          </Button>
        </div>
      </div>

      {overall && (
        <div className="mb-5">
          <Alert tone={overall.tone} title={overall.title}>
            {overall.text}
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ProbeCard
          title="Public API"
          endpoint={`GET /events/${EVENT_IDS[0] ?? ""}`}
          description="Reads inventory from the database: a real round trip through the app and Postgres."
          samples={publicSamples}
        />
        <ProbeCard
          title="Admin API"
          endpoint="GET /admin/metrics"
          description="Authenticated with your in-memory token."
          samples={adminSamples}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Server instance" description="From the metrics response.">
          {metrics.data ? (
            <dl className="space-y-3 text-sm">
              <Row label="Inventory locking">
                <Badge tone="info">{metrics.data.inventory_locking}</Badge>
              </Row>
              <Row label="Instance started">{new Date(metrics.data.started_at).toLocaleString("en-GB")}</Row>
              <Row label="Uptime">{formatUptime(metrics.data.started_at)}</Row>
              <Row label="Requests served">{summary?.totalRequests.toLocaleString() ?? "—"}</Row>
            </dl>
          ) : (
            <Skeleton className="h-32" />
          )}
        </Card>

        <Card className="lg:col-span-2" title="Operational signals" description="Counters on this instance. Non-zero values that need attention are highlighted.">
          {summary ? (
            <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <Signal label="Server errors (5xx)" value={summary.serverErrors} bad />
              <Signal label="Rate-limited requests (429)" value={errorCount(summary, "RATE_LIMITED")} warn />
              <Signal label="Rejected admin/auth attempts (401)" value={errorCount(summary, "UNAUTHORIZED")} warn />
              <Signal label="Contention errors (503)" value={errorCount(summary, "CONTENTION")} bad />
              <Signal label="Oversell attempts refused (409)" value={errorCount(summary, "OVERSOLD")} />
              <Signal label="Transaction retries" value={summary.retriesTotal} />
              <Signal label="Payments flagged for manual refund" value={webhookOutcomeCount(summary, "paid_no_inventory_needs_manual_refund")} warn />
              <Signal label="Refunds parked (arrived before payment)" value={webhookOutcomeCount(summary, "parked_until_paid")} />
            </ul>
          ) : (
            <Skeleton className="h-32" />
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Inventory capacity" description="Live from GET /events/:id for the configured events.">
        {loadedEvents.length === 0 ? (
          <EmptyState title="No inventory loaded">Waiting for the public API.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                  <th className="pb-2 font-medium">Event · tier</th>
                  <th className="pb-2 text-right font-medium">Available</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                  <th className="w-48 pb-2 pl-6 font-medium">Held or sold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {loadedEvents.flatMap((e) =>
                  e.tiers.map((t) => {
                    const used = t.total_inventory === 0 ? 0 : ((t.total_inventory - t.available) / t.total_inventory) * 100;
                    return (
                      <tr key={t.id}>
                        <td className="py-2.5">
                          <p className="text-zinc-900">{t.name}</p>
                          <p className="text-xs text-zinc-500">{e.title}</p>
                        </td>
                        <td className="py-2.5 text-right font-medium tabular-nums">{t.available}</td>
                        <td className="py-2.5 text-right tabular-nums text-zinc-600">{t.total_inventory}</td>
                        <td className="py-2.5 pl-6">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                              <div className={cx("h-full rounded-full", used >= 100 ? "bg-red-500" : used >= 90 ? "bg-amber-500" : "bg-indigo-500")} style={{ width: `${used}%` }} />
                            </div>
                            <span className="w-10 text-right text-xs tabular-nums text-zinc-500">{Math.round(used)}%</span>
                            {t.available === 0 ? <Badge tone="bad">Sold out</Badge> : used >= 90 ? <Badge tone="warn">Low</Badge> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-4" title="Not available from the existing APIs" description="Shown so the gaps are explicit; nothing here is estimated.">
        <ul className="grid gap-x-8 gap-y-2 text-sm text-zinc-600 sm:grid-cols-2">
          <li>Database health, connection count and query latency (only the end-to-end probe above)</li>
          <li>Metrics aggregated across server instances (counters are per instance)</li>
          <li>How many refunds are parked <em>right now</em> (only the cumulative count received)</li>
          <li>A list of recent orders or holds (look an order up on the Order audit page)</li>
        </ul>
      </Card>

      {metrics.status === "error" && metrics.error && (
        <div className="mt-4">
          <Alert tone="warn" title="Metrics refresh failed">
            {metrics.error.message}
          </Alert>
        </div>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right font-medium text-zinc-900">{children}</dd>
    </div>
  );
}

function Signal({ label, value, bad, warn }: { label: string; value: number; bad?: boolean; warn?: boolean }) {
  const tone: Tone | null = value > 0 ? (bad ? "bad" : warn ? "warn" : null) : null;
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="text-zinc-600">{label}</span>
      {tone ? <Badge tone={tone}>{value.toLocaleString()}</Badge> : <span className="font-medium tabular-nums text-zinc-900">{value.toLocaleString()}</span>}
    </li>
  );
}

function ProbeCard({ title, endpoint, description, samples }: { title: string; endpoint: string; description: string; samples: Sample[] }) {
  const last = samples.at(-1);
  const health = healthOf(last);
  const okMs = samples.filter((s) => s.status === 200).map((s) => s.ms);
  const avg = okMs.length ? Math.round(okMs.reduce((a, b) => a + b, 0) / okMs.length) : null;
  const max = Math.max(1, ...samples.map((s) => s.ms));

  return (
    <Card
      title={title}
      description={description}
      actions={health ? <Badge tone={HEALTH_UI[health].tone}>{HEALTH_UI[health].label}</Badge> : <Badge>Probing…</Badge>}
    >
      <p className="font-mono text-xs text-zinc-500">{endpoint}</p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Metric label="Last" value={last ? (last.status === null ? "no response" : `${last.ms} ms`) : "—"} />
        <Metric label="Average" value={avg === null ? "—" : `${avg} ms`} />
        <Metric label="Samples" value={String(samples.length)} />
      </div>

      {samples.length === 0 ? (
        <div className="mt-4">
          <Skeleton className="h-14" />
        </div>
      ) : (
        <div className="mt-4" aria-label={`${title} latency, last ${samples.length} probes`}>
          <div className="flex h-14 items-end gap-1">
            {samples.map((s) => (
              <div
                key={s.at}
                title={`${s.status === null ? "no response" : `HTTP ${s.status}`} · ${s.ms} ms · ${new Date(s.at).toLocaleTimeString("en-GB")}`}
                className={cx("flex-1 rounded-sm", s.status !== 200 ? "bg-red-400" : s.ms > SLOW_MS ? "bg-amber-400" : "bg-indigo-400")}
                style={{ height: `${Math.max(8, (s.ms / max) * 100)}%` }}
              />
            ))}
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-zinc-400">
            <Activity className="size-3" aria-hidden /> latency per probe · amber &gt; {SLOW_MS} ms · red = not HTTP 200
          </p>
        </div>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900">{value}</p>
    </div>
  );
}
