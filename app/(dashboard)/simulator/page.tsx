"use client";

import { Copy, RefreshCw, Send, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { BusinessRules } from "@/components/BusinessRules";
import { CallResult } from "@/components/CallResult";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select } from "@/components/ui";
import type { ActivityEntry } from "@/lib/api-client";
import { useApi } from "@/lib/api-context";
import type { PaidPayload, RefundPayload, WebhookPayload } from "@/lib/api-types";
import { EVENT_IDS } from "@/lib/config";
import { formatMoney, newOrderId } from "@/lib/format";
import { buildPaid, buildRefund, useWebhookSender } from "@/lib/use-webhooks";

type Last = Omit<ActivityEntry, "id">;

interface Sent<P extends WebhookPayload> {
  payload: P;
  entry: Last;
  resend: boolean;
}

export default function SimulatorPage() {
  return (
    <>
      <PageHeader
        title="Payment simulator"
        description="Play the payment processor: send order.paid and order.refunded webhooks to POST /webhooks/payments and see exactly how the backend reacts."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <PaymentCard />
        <RefundCard />
      </div>
      <div className="mt-6">
        <BusinessRules />
      </div>
    </>
  );
}

/* ---------------- order.paid ---------------- */

function PaymentCard() {
  const { events } = useApi();
  const send = useWebhookSender();

  const [eventId, setEventId] = useState<string>(EVENT_IDS[0] ?? "");
  const [tierId, setTierId] = useState<string>("");
  const [orderId, setOrderId] = useState<string>(() => newOrderId());
  const [quantity, setQuantity] = useState<string>("1");
  const [amountOverride, setAmountOverride] = useState<string>("");
  const [currencyOverride, setCurrencyOverride] = useState<string>("");
  const [busy, setBusy] = useState<"send" | "resend" | null>(null);
  const [sent, setSent] = useState<Sent<PaidPayload> | null>(null);

  const event = events[eventId]?.event ?? null;
  const tier = event?.tiers.find((t) => t.id === tierId) ?? event?.tiers[0] ?? null;
  const qty = Number(quantity);
  const qtyValid = Number.isInteger(qty) && qty > 0;

  const expectedAmount = tier && qtyValid ? tier.price * qty : null;
  const amountText = amountOverride !== "" ? amountOverride : expectedAmount !== null ? String(expectedAmount) : "";
  const amount = Number(amountText);
  const amountValid = amountText !== "" && Number.isInteger(amount) && amount >= 0;
  const currency = (currencyOverride || tier?.currency || "EUR").toUpperCase();
  const currencyValid = /^[A-Z]{3}$/.test(currency);
  const canSend = Boolean(tier) && qtyValid && amountValid && currencyValid && orderId.trim() !== "";

  async function sendNew() {
    if (!tier) return;
    setBusy("send");
    const payload = buildPaid({
      order_id: orderId.trim(),
      tier_id: tier.id,
      quantity: qty,
      amount_total: amount,
      currency,
    });
    const res = await send(payload);
    setSent({ payload, entry: res.entry, resend: false });
    setBusy(null);
  }

  async function resendSame() {
    if (!sent) return;
    setBusy("resend");
    const res = await send(sent.payload); // identical payload, identical event_id
    setSent({ payload: sent.payload, entry: res.entry, resend: true });
    setBusy(null);
  }

  return (
    <Card title="order.paid" description="A successful payment for an order." className="h-fit">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void sendNew();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event">
            <Select
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                setTierId("");
                setAmountOverride("");
              }}
            >
              {EVENT_IDS.map((id) => (
                <option key={id} value={id}>
                  {events[id]?.event?.title ?? id}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tier ID">
            <Select
              value={tier?.id ?? ""}
              onChange={(e) => {
                setTierId(e.target.value);
                setAmountOverride("");
              }}
            >
              {event?.tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Order ID" hint="The processor's order id is the primary key of the order.">
          <div className="flex gap-2">
            <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} className="font-mono" />
            <Button type="button" onClick={() => setOrderId(newOrderId())} aria-label="Generate new order id" icon={<RefreshCw className="size-4" aria-hidden />} />
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantity">
            <Input
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setAmountOverride("");
              }}
            />
          </Field>
          <Field label="Amount total (minor units)">
            <Input type="number" min={0} step={1} value={amountText} onChange={(e) => setAmountOverride(e.target.value)} />
          </Field>
          <Field label="Currency">
            <Input value={currency} maxLength={3} onChange={(e) => setCurrencyOverride(e.target.value)} className="font-mono uppercase" />
          </Field>
        </div>

        <p className="text-xs text-zinc-500">
          {expectedAmount !== null && tier
            ? `Matches the tier price: ${formatMoney(expectedAmount, tier.currency)}. `
            : ""}
          Change the amount to see the API reject a mismatch with 422.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={busy === "send"} disabled={!canSend} icon={<Send className="size-4" aria-hidden />}>
            Send payment webhook
          </Button>
          <Button
            type="button"
            loading={busy === "resend"}
            disabled={!sent}
            onClick={() => void resendSame()}
            icon={<Copy className="size-4" aria-hidden />}
          >
            Re-send exact same payload
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          Each send generates a new event_id. Re-send reuses the previous one to demonstrate idempotency.
        </p>
      </form>

      {sent && (
        <div className="mt-5 space-y-3 border-t border-zinc-100 pt-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={sent.resend ? "warn" : "info"}>{sent.resend ? "Duplicate delivery" : "First delivery"}</Badge>
            <span className="font-mono text-zinc-500">event_id: {sent.payload.event_id}</span>
          </div>
          <CallResult entry={sent.entry} />
        </div>
      )}
    </Card>
  );
}

/* ---------------- order.refunded ---------------- */

function RefundCard() {
  const { orders } = useApi();
  const send = useWebhookSender();

  const [orderId, setOrderId] = useState<string>("");
  const [mode, setMode] = useState<"full" | "partial">("partial");
  const [amountText, setAmountText] = useState<string>("");
  const [currencyOverride, setCurrencyOverride] = useState<string>("");
  const [busy, setBusy] = useState<"send" | "resend" | null>(null);
  const [sent, setSent] = useState<Sent<RefundPayload> | null>(null);

  const known = useMemo(() => orders.find((o) => o.order_id === orderId.trim()) ?? null, [orders, orderId]);
  const remaining = known ? known.amount_total - known.refunded : null;

  const amount = mode === "full" && remaining !== null ? remaining : Number(amountText);
  const amountValid = Number.isInteger(amount) && amount > 0 && (mode === "full" || amountText !== "");
  const currency = (currencyOverride || known?.currency || "EUR").toUpperCase();
  const currencyValid = /^[A-Z]{3}$/.test(currency);
  const canSend = orderId.trim() !== "" && amountValid && currencyValid;

  async function sendNew() {
    setBusy("send");
    const payload = buildRefund({ order_id: orderId.trim(), amount_refunded: amount, currency });
    const res = await send(payload);
    setSent({ payload, entry: res.entry, resend: false });
    setBusy(null);
  }

  async function resendSame() {
    if (!sent) return;
    setBusy("resend");
    const res = await send(sent.payload);
    setSent({ payload: sent.payload, entry: res.entry, resend: true });
    setBusy(null);
  }

  return (
    <Card title="order.refunded" description="A refund of an order, partial or full." className="h-fit">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void sendNew();
        }}
      >
        <Field label="Order ID" hint="Pick an order paid in this session, or type any id (a refund for an unknown order is parked until its payment arrives).">
          <Input list="session-orders" value={orderId} onChange={(e) => setOrderId(e.target.value)} placeholder="ord_…" className="font-mono" />
          <datalist id="session-orders">
            {orders.map((o) => (
              <option key={o.order_id} value={o.order_id} />
            ))}
          </datalist>
        </Field>

        {known && (
          <Alert tone="info" title="Order paid in this session">
            Total {formatMoney(known.amount_total, known.currency)} · refunded so far (confirmed by the API){" "}
            {formatMoney(known.refunded, known.currency)} · {known.fullyRefunded ? "fully refunded" : `remaining ${formatMoney(known.amount_total - known.refunded, known.currency)}`}
          </Alert>
        )}

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-zinc-700">Refund type</legend>
          <div className="inline-flex rounded-lg border border-zinc-200 p-0.5">
            {(["partial", "full"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={
                  "rounded-md px-3 py-1 text-sm transition-colors " +
                  (mode === m ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100")
                }
              >
                {m === "full" ? "Full" : "Partial"}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Amount refunded (minor units)"
            hint={
              mode === "full"
                ? remaining !== null
                  ? "Full refund = everything not yet refunded."
                  : "Unknown order: enter the order's full amount yourself."
                : "A partial refund never releases inventory."
            }
          >
            <Input
              type="number"
              min={1}
              step={1}
              value={mode === "full" && remaining !== null ? String(remaining) : amountText}
              readOnly={mode === "full" && remaining !== null}
              onChange={(e) => setAmountText(e.target.value)}
            />
          </Field>
          <Field label="Currency">
            <Input value={currency} maxLength={3} onChange={(e) => setCurrencyOverride(e.target.value)} className="font-mono uppercase" />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" loading={busy === "send"} disabled={!canSend} icon={<Undo2 className="size-4" aria-hidden />}>
            Send refund webhook
          </Button>
          <Button
            type="button"
            loading={busy === "resend"}
            disabled={!sent}
            onClick={() => void resendSame()}
            icon={<Copy className="size-4" aria-hidden />}
          >
            Re-send exact same payload
          </Button>
        </div>
        <p className="text-xs text-zinc-500">
          Refund status is whatever the API answers below; nothing is assumed to succeed. Duplicate refunds are counted once.
        </p>
      </form>

      {sent && (
        <div className="mt-5 space-y-3 border-t border-zinc-100 pt-5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={sent.resend ? "warn" : "info"}>{sent.resend ? "Duplicate delivery" : "First delivery"}</Badge>
            <span className="font-mono text-zinc-500">event_id: {sent.payload.event_id}</span>
          </div>
          <CallResult entry={sent.entry} />
        </div>
      )}
    </Card>
  );
}
