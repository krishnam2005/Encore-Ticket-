"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { BusinessRules } from "@/components/BusinessRules";
import { Alert, Badge, Button, Card, PageHeader, Skeleton, StatCard } from "@/components/ui";
import { useApi } from "@/lib/api-context";
import { EVENT_IDS } from "@/lib/config";
import { formatDateTime } from "@/lib/format";

export default function DashboardPage() {
  const { events, refreshEvents, holds, orders } = useApi();

  const states = EVENT_IDS.map((id) => ({ id, state: events[id] }));
  const loaded = states.flatMap(({ state }) => (state?.event ? [state.event] : []));
  const loading = states.some(({ state }) => !state || (state.status === "loading" && !state.event));
  const failed = states.filter(({ state }) => state?.status === "error");

  const tiers = loaded.flatMap((e) => e.tiers);
  const total = tiers.reduce((n, t) => n + t.total_inventory, 0);
  const available = tiers.reduce((n, t) => n + t.available, 0);
  const unavailable = total - available;

  const activeHolds = holds.filter((h) => h.status === "active").length;
  const paidOrders = orders.length;
  const refundedOrders = orders.filter((o) => o.fullyRefunded).length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live inventory straight from the API, plus what you have done in this browser session."
        actions={
          <Button onClick={() => void refreshEvents()} icon={<RefreshCw className="size-4" aria-hidden />}>
            Refresh
          </Button>
        }
      />

      {failed.length > 0 && (
        <div className="mb-4 space-y-2">
          {failed.map(({ id, state }) => (
            <Alert key={id} tone="bad" title={`Could not load ${id}`}>
              {state?.status === "error" ? state.message : ""}
            </Alert>
          ))}
        </div>
      )}

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Inventory (from the API)</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        ) : (
          <>
            <StatCard label="Events" value={loaded.length} hint={`of ${EVENT_IDS.length} configured`} />
            <StatCard label="Total inventory" value={total.toLocaleString()} hint={`${tiers.length} ticket tiers`} />
            <StatCard label="Available now" value={available.toLocaleString()} hint="total − active holds − sold" />
            <StatCard
              label="Held or sold"
              value={unavailable.toLocaleString()}
              hint="the API does not split holds from sales"
            />
          </>
        )}
      </div>

      <div className="mb-2 mt-8 flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">This session</h2>
        <Badge tone="info">observed by this UI only</Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Active holds" value={activeHolds} hint="holds you created here and have not cancelled" />
        <StatCard label="Paid orders" value={paidOrders} hint="payments you simulated that the API accepted" />
        <StatCard label="Fully refunded" value={refundedOrders} hint="of those, confirmed fully refunded by the API" />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        The API has no endpoint that lists holds or orders, so global counts for these are not available and are not guessed.
        These three numbers only reflect actions taken in this tab and reset on reload. Hold expiry by timer is not reflected here.
      </p>

      <div className="mt-8 grid gap-4 lg:grid-cols-5">
        <Card
          className="lg:col-span-3"
          title="Availability by event"
          actions={
            <Link href="/events" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
              Details →
            </Link>
          }
        >
          {loading ? (
            <Skeleton className="h-24" />
          ) : loaded.length === 0 ? (
            <p className="text-sm text-zinc-500">No events could be loaded.</p>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {loaded.map((e) => {
                const t = e.tiers.reduce((n, x) => n + x.total_inventory, 0);
                const a = e.tiers.reduce((n, x) => n + x.available, 0);
                const pct = t === 0 ? 0 : Math.round((a / t) * 100);
                return (
                  <li key={e.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-900">{e.title}</p>
                        <p className="text-xs text-zinc-500">
                          {e.venue} · {formatDateTime(e.starts_at)}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs tabular-nums text-zinc-600">
                        {a} / {t} available
                      </p>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                      <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <div className="lg:col-span-2">
          <Card title="Try the lifecycle" description="The quickest way to see everything work.">
            <ol className="space-y-2 text-sm text-zinc-600">
              <li>
                <Link className="font-medium text-indigo-600 hover:underline" href="/reserve">
                  1. Reserve tickets
                </Link>{" "}
                to create a hold.
              </li>
              <li>
                <Link className="font-medium text-indigo-600 hover:underline" href="/reserve">
                  2. Simulate payment
                </Link>{" "}
                on that hold, or cancel it.
              </li>
              <li>
                <Link className="font-medium text-indigo-600 hover:underline" href="/simulator">
                  3. Re-send the webhook
                </Link>{" "}
                to prove idempotency, then refund.
              </li>
              <li>
                <Link className="font-medium text-indigo-600 hover:underline" href="/activity">
                  4. Inspect every request
                </Link>{" "}
                in the activity console.
              </li>
            </ol>
          </Card>
        </div>
      </div>

      <div className="mt-6">
        <BusinessRules />
      </div>
    </>
  );
}
