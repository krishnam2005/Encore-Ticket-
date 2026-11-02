"use client";

import { Ban, CreditCard, Ticket } from "lucide-react";
import { useMemo, useState } from "react";
import { BusinessRules } from "@/components/BusinessRules";
import { CallResult } from "@/components/CallResult";
import { Countdown } from "@/components/Countdown";
import { CopyText } from "@/components/JsonBlock";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, type Tone } from "@/components/ui";
import type { ActivityEntry } from "@/lib/api-client";
import { useApi, type SessionHold } from "@/lib/api-context";
import type { HoldCancelled, HoldCreated } from "@/lib/api-types";
import { EVENT_IDS, HOLD_TTL_MINUTES } from "@/lib/config";
import { formatDateTime, formatMoney, newOrderId } from "@/lib/format";
import { buildPaid, useWebhookSender } from "@/lib/use-webhooks";

type Last = Omit<ActivityEntry, "id">;

const HOLD_TONE: Record<SessionHold["status"], Tone> = { active: "info", expired: "neutral", converted: "good" };

export default function ReservePage() {
  const { events, request, refreshEvents, holds, addHold, updateHold } = useApi();
  const sendWebhook = useWebhookSender();

  const readyEvents = EVENT_IDS.flatMap((id) => {
    const e = events[id]?.event;
    return e ? [e] : [];
  });
  const [eventId, setEventId] = useState<string>(EVENT_IDS[0] ?? "");
  const [tierId, setTierId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("1");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastHoldCall, setLastHoldCall] = useState<Last | null>(null);
  const [rowCalls, setRowCalls] = useState<Record<string, Last>>({});

  const event = events[eventId]?.event ?? null;
  const tier = useMemo(() => {
    if (!event) return null;
    return event.tiers.find((t) => t.id === tierId) ?? event.tiers[0] ?? null;
  }, [event, tierId]);

  const qty = Number(quantity);
  const qtyValid = Number.isInteger(qty) && qty > 0;
  const total = tier && qtyValid ? tier.price * qty : null;

  async function createHold() {
    if (!tier || !qtyValid) return;
    setBusy("create");
    const res = await request<HoldCreated>("POST", `/events/${encodeURIComponent(eventId)}/holds`, {
      tier_id: tier.id,
      quantity: qty,
    });
    setLastHoldCall(res.entry);
    if (res.data) {
      addHold({ ...res.data, event_id: eventId, tier_name: tier.name, unit_price: tier.price, currency: tier.currency });
    }
    await refreshEvents(); // also after a 409, so the shown availability is current
    setBusy(null);
  }

  async function cancel(hold: SessionHold) {
    setBusy(`cancel:${hold.hold_id}`);
    const res = await request<HoldCancelled>("POST", `/orders/${hold.hold_id}/cancel-hold`);
    setRowCalls((p) => ({ ...p, [hold.hold_id]: res.entry }));
    if (res.data) updateHold(hold.hold_id, { status: res.data.status });
    await refreshEvents();
    setBusy(null);
  }

  async function pay(hold: SessionHold) {
    setBusy(`pay:${hold.hold_id}`);
    const payload = buildPaid({
      order_id: newOrderId(),
      tier_id: hold.tier_id,
      quantity: hold.quantity,
      amount_total: hold.unit_price * hold.quantity,
      currency: hold.currency,
    });
    const res = await sendWebhook(payload);
    setRowCalls((p) => ({ ...p, [hold.hold_id]: res.entry }));
    // The hold becomes 'converted' only if the API says it matched one (outcome paid_from_hold).
    if (res.data?.outcome === "paid_from_hold") updateHold(hold.hold_id, { status: "converted" });
    setBusy(null);
  }

  return (
    <>
      <PageHeader
        title="Reserve tickets"
        description={`Create a ${HOLD_TTL_MINUTES}-minute hold, then pay for it or cancel it. Everything shown here is the API's own answer.`}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <Card title="New hold" description="POST /events/:event_id/holds">
            {readyEvents.length === 0 ? (
              <Alert tone="warn" title="No events loaded">
                Waiting for the API. Use Refresh on the Events page if this persists.
              </Alert>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createHold();
                }}
              >
                <Field label="Event">
                  <Select
                    value={eventId}
                    onChange={(e) => {
                      setEventId(e.target.value);
                      setTierId("");
                    }}
                  >
                    {readyEvents.map((ev) => (
                      <option key={ev.id} value={ev.id}>
                        {ev.title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Ticket tier">
                  <Select value={tier?.id ?? ""} onChange={(e) => setTierId(e.target.value)}>
                    {event?.tiers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {formatMoney(t.price, t.currency)} · {t.available} left
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Quantity"
                  hint="Leave it above what is available to see the OVERSOLD error the API returns."
                >
                  <Input type="number" min={1} step={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </Field>

                <div className="flex items-baseline justify-between rounded-lg bg-zinc-50 px-3 py-2.5 text-sm">
                  <span className="text-zinc-500">Total</span>
                  <span className="font-semibold tabular-nums text-zinc-900">
                    {total !== null && tier ? formatMoney(total, tier.currency) : "—"}
                  </span>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  loading={busy === "create"}
                  disabled={!tier || !qtyValid}
                  icon={<Ticket className="size-4" aria-hidden />}
                  className="w-full"
                >
                  Create hold
                </Button>
                {!qtyValid && <p className="text-xs text-red-600">Quantity must be a whole number of at least 1.</p>}
              </form>
            )}
          </Card>

          {lastHoldCall && (
            <Card title="API response">
              <CallResult entry={lastHoldCall} />
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:col-span-3">
          <Card
            title="Your holds (this session)"
            description="Held in this browser tab only; the API has no endpoint to list holds."
          >
            {holds.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500">No holds yet. Create one to see it here.</p>
            ) : (
              <ul className="space-y-3">
                {holds.map((h) => {
                  const call = rowCalls[h.hold_id];
                  return (
                    <li key={h.hold_id} className="rounded-lg border border-zinc-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-zinc-900">
                            {h.quantity} × {h.tier_name}
                            <span className="ml-2 font-normal text-zinc-500">{formatMoney(h.unit_price * h.quantity, h.currency)}</span>
                          </p>
                          <p className="mt-1 flex items-center gap-1 font-mono text-xs text-zinc-500">
                            {h.hold_id}
                            <CopyText text={h.hold_id} label="hold id" />
                          </p>
                        </div>
                        <Badge tone={HOLD_TONE[h.status]}>{h.status}</Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-zinc-500">
                          Expires {formatDateTime(h.expires_at)}
                          <div className="mt-1">
                            <Countdown expiresAt={h.expires_at} active={h.status === "active"} />
                          </div>
                        </div>
                        {h.status === "active" && (
                          <div className="flex gap-2">
                            <Button
                              variant="primary"
                              loading={busy === `pay:${h.hold_id}`}
                              onClick={() => void pay(h)}
                              icon={<CreditCard className="size-4" aria-hidden />}
                            >
                              Simulate payment
                            </Button>
                            <Button
                              variant="danger"
                              loading={busy === `cancel:${h.hold_id}`}
                              onClick={() => void cancel(h)}
                              icon={<Ban className="size-4" aria-hidden />}
                            >
                              Cancel hold
                            </Button>
                          </div>
                        )}
                      </div>
                      {call && (
                        <div className="mt-3 border-t border-zinc-100 pt-3">
                          <CallResult entry={call} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <p className="text-xs text-zinc-500">
            Status shown is what the API last told this page. If the 10 minutes elapse, the server stops counting the hold immediately,
            but this list is not refreshed by the timer; a later cancel will answer 409 HOLD_NOT_ACTIVE.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <BusinessRules />
      </div>
    </>
  );
}
