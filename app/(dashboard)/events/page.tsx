"use client";

import { MapPin, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Alert, Badge, Button, Card, PageHeader, Select, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api-context";
import { EVENT_IDS } from "@/lib/config";
import { formatDateTime, formatMoney } from "@/lib/format";

export default function EventsPage() {
  const { events, refreshEvents } = useApi();
  const [selected, setSelected] = useState<string>(EVENT_IDS[0] ?? "");
  const state = events[selected];
  const event = state?.event ?? null;

  return (
    <>
      <PageHeader
        title="Events & inventory"
        description="Ticket tiers with live availability: total − active holds − sold orders."
        actions={
          <>
            <Select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Select event" className="w-60">
              {EVENT_IDS.map((id) => (
                <option key={id} value={id}>
                  {events[id]?.event?.title ?? id}
                </option>
              ))}
            </Select>
            <Button onClick={() => void refreshEvents()} icon={<RefreshCw className="size-4" aria-hidden />}>
              Refresh
            </Button>
          </>
        }
      />

      {state?.status === "error" && (
        <div className="mb-4">
          <Alert tone="bad" title={`Could not load ${selected}`}>
            {state.message}
            {event && " Showing the last successfully loaded data."}
          </Alert>
        </div>
      )}

      {!event && (!state || state.status === "loading") ? (
        <Skeleton className="h-64" />
      ) : event ? (
        <Card
          title={event.title}
          description={event.id}
          actions={state?.status === "loading" ? <Badge tone="info">Refreshing…</Badge> : undefined}
        >
          <div className="mb-5 flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-600">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4 text-zinc-400" aria-hidden />
              {event.venue}
            </span>
            <span>{formatDateTime(event.starts_at)}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs text-zinc-500">
                  <th className="pb-2 font-medium">Tier</th>
                  <th className="pb-2 text-right font-medium">Price</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                  <th className="pb-2 text-right font-medium">Available</th>
                  <th className="w-40 pb-2 pl-6 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {event.tiers.map((t) => {
                  const pct = t.total_inventory === 0 ? 0 : (t.available / t.total_inventory) * 100;
                  return (
                    <tr key={t.id}>
                      <td className="py-3">
                        <p className="font-medium text-zinc-900">{t.name}</p>
                        <p className="font-mono text-xs text-zinc-400">{t.id}</p>
                      </td>
                      <td className="py-3 text-right tabular-nums">{formatMoney(t.price, t.currency)}</td>
                      <td className="py-3 text-right tabular-nums text-zinc-600">{t.total_inventory}</td>
                      <td className="py-3 text-right font-medium tabular-nums">{t.available}</td>
                      <td className="py-3 pl-6">
                        {t.available === 0 ? (
                          <Badge tone="bad">Sold out</Badge>
                        ) : pct <= 10 ? (
                          <Badge tone="warn">Almost gone</Badge>
                        ) : (
                          <Badge tone="good">On sale</Badge>
                        )}
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100">
                          <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </>
  );
}
