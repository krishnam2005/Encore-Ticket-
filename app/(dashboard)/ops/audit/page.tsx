"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AdminGate } from "@/components/admin/AdminGate";
import { EmptyState } from "@/components/admin/BarList";
import { LegendBadges, OrderStatusBadge, Timeline } from "@/components/admin/Timeline";
import { CopyText, JsonBlock } from "@/components/JsonBlock";
import { Alert, Badge, Button, Card, Input, PageHeader, Skeleton } from "@/components/ui";
import type { AuditDelivery, AuditResponse } from "@/lib/admin-types";
import { useApi } from "@/lib/api-context";
import { buildTimeline, type TimelineKind } from "@/lib/audit-timeline";
import { formatDateTimeSeconds, formatMoney } from "@/lib/format";
import { describeOutcome } from "@/lib/outcomes";

type SearchState =
  | { status: "idle" }
  | { status: "loading"; orderId: string }
  | { status: "found"; orderId: string; audit: AuditResponse }
  | { status: "not-found"; orderId: string }
  | { status: "disabled" }
  | { status: "error"; orderId: string; message: string };

export default function OrderAuditPage() {
  return (
    <>
      <PageHeader
        title="Order audit"
        description="Every state change for an order, from GET /admin/audit: payments, refunds, inventory releases and the webhooks behind them."
      />
      <AdminGate>
        <AuditSearch />
      </AdminGate>
    </>
  );
}

function AuditSearch() {
  const { adminRequest, orders } = useApi();
  const [input, setInput] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });

  async function search(raw: string) {
    const orderId = raw.trim();
    if (orderId === "") return;
    setState({ status: "loading", orderId });
    const res = await adminRequest<AuditResponse>(`/admin/audit?order_id=${encodeURIComponent(orderId)}`);
    const status = res.entry.status;
    if (res.data) setState({ status: "found", orderId, audit: res.data });
    else if (status === 404 && res.error?.code === "ORDER_NOT_FOUND") setState({ status: "not-found", orderId });
    else if (status === 404) setState({ status: "disabled" });
    else if (status === 401) setState({ status: "idle" }); // token cleared by the context; the gate takes over
    else
      setState({
        status: "error",
        orderId,
        message: res.error?.message ?? res.entry.networkError ?? `Request failed (HTTP ${status ?? "?"}).`,
      });
  }

  return (
    <>
      <Card>
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void search(input);
          }}
        >
          <div className="flex-1">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Order ID, e.g. ord_ui_mvz3acl4yvn"
              aria-label="Order ID"
              list="audit-session-orders"
              className="font-mono"
              autoComplete="off"
            />
            <datalist id="audit-session-orders">
              {orders.map((o) => (
                <option key={o.order_id} value={o.order_id} />
              ))}
            </datalist>
          </div>
          <Button type="submit" variant="primary" loading={state.status === "loading"} disabled={input.trim() === ""} icon={<Search className="size-4" aria-hidden />}>
            Search audit
          </Button>
        </form>

        {orders.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>Paid from this session:</span>
            {orders.slice(0, 6).map((o) => (
              <button
                key={o.order_id}
                type="button"
                onClick={() => {
                  setInput(o.order_id);
                  void search(o.order_id);
                }}
                className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-zinc-700 hover:bg-zinc-50"
              >
                {o.order_id}
              </button>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-6">
        <Results state={state} />
      </div>
    </>
  );
}

function Results({ state }: { state: SearchState }) {
  if (state.status === "idle") {
    return (
      <Card>
        <EmptyState title="Search for an order to see its history">
          Enter a processor order ID. A refund that arrived before its payment is also found, because parked refunds are recorded under the order ID.
        </EmptyState>
      </Card>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (state.status === "not-found") {
    return (
      <Card>
        <EmptyState title={`No activity found for ${state.orderId}`}>
          The API has no order, state change or webhook for this ID. Check the spelling; IDs are case-sensitive.
        </EmptyState>
      </Card>
    );
  }
  if (state.status === "disabled") {
    return (
      <Alert tone="warn" title="Admin API is disabled on this server">
        The server answered 404 without an order error, so ADMIN_TOKEN is probably not set there any more.
      </Alert>
    );
  }
  if (state.status === "error") {
    return (
      <Alert tone="bad" title={`Could not load the audit for ${state.orderId}`}>
        {state.message}
      </Alert>
    );
  }
  return <AuditView audit={state.audit} />;
}

function AuditView({ audit }: { audit: AuditResponse }) {
  const items = useMemo(() => buildTimeline(audit), [audit]);
  const kinds = useMemo(() => [...new Set(items.map((i) => i.kind))] as TimelineKind[], [items]);
  const o = audit.order;

  return (
    <div className="space-y-4">
      {o ? (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1 font-mono text-sm font-semibold text-zinc-900">
                {o.id}
                <CopyText text={o.id} label="order id" />
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {o.quantity} × {o.tier_id} · created {formatDateTimeSeconds(o.created_at)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={o.status} />
              {o.needs_manual_refund && <Badge tone="warn">needs manual refund</Badge>}
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-4">
            <Fact label="Order total" value={formatMoney(o.amount_total, o.currency)} />
            <Fact label="Refunded" value={formatMoney(o.amount_refunded, o.currency)} />
            <Fact label="Remaining" value={formatMoney(o.amount_total - o.amount_refunded, o.currency)} />
            <Fact label="Hold used" value={audit.hold ? `${audit.hold.status}` : "none"} />
          </dl>
        </Card>
      ) : (
        <Alert tone="warn" title="No order exists yet for this ID">
          Only parked webhook activity was found (for example a refund that arrived before its payment). It will be applied automatically when the payment arrives.
        </Alert>
      )}

      <Card title="Timeline" description="Chronological, oldest first. Each step is a record the API returned." actions={<LegendBadges kinds={kinds} />}>
        {items.length === 0 ? <EmptyState title="No recorded state changes" /> : <Timeline items={items} />}
      </Card>

      <Card
        title="Webhook deliveries"
        description="Distinct deliveries received for this order. A repeated event_id is deduplicated and is not stored twice."
      >
        {audit.webhook_deliveries.length === 0 ? (
          <EmptyState title="No webhooks recorded" />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {audit.webhook_deliveries.map((d) => (
              <Delivery key={d.event_id} d={d} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-900">{value}</dd>
    </div>
  );
}

function Delivery({ d }: { d: AuditDelivery }) {
  const info = d.outcome ? describeOutcome(d.outcome) : null;
  const parked = d.processed_at === null;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={d.event_type === "order.paid" ? "good" : "info"}>{d.event_type}</Badge>
          <span className="flex items-center gap-0.5 font-mono text-xs text-zinc-700">
            {d.event_id}
            <CopyText text={d.event_id} label="event id" />
          </span>
        </p>
        <p className="text-xs text-zinc-500">received {formatDateTimeSeconds(d.received_at)}</p>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {parked ? <Badge tone="warn">parked: waiting for payment</Badge> : <>processed {formatDateTimeSeconds(d.processed_at ?? d.received_at)}</>}
        {info && <span> · {info.title}</span>}
      </p>
      <div className="mt-2 max-w-xl">
        <JsonBlock label="Payload" value={d.payload} />
      </div>
    </li>
  );
}
