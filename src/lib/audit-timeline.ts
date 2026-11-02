import type { AuditResponse, AuditStateChange } from "./admin-types";
import { formatMoney } from "./format";
import { describeOutcome } from "./outcomes";

export type TimelineKind = "hold" | "payment" | "refund" | "inventory" | "parked" | "warning";

export interface TimelineChip {
  label: string;
  value: string;
}

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  title: string;
  at: string;
  eventId: string | null;
  note?: string;
  chips: TimelineChip[];
  raw: unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const shortId = (id: string): string => (id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

/**
 * Builds a chronological timeline from the audit API response. Every item comes from a field the API
 * returned: the hold row, order_audit rows (state changes). An "Inventory released" step is added
 * only where the API recorded `inventory_released: true` on a refund.
 */
export function buildTimeline(audit: AuditResponse): TimelineItem[] {
  const currency = audit.order?.currency?.trim() ?? "EUR";
  const money = (minor: number | null): string | null => (minor === null ? null : formatMoney(minor, currency));
  const items: TimelineItem[] = [];

  if (audit.hold) {
    const h = audit.hold;
    items.push({
      id: `hold:${h.id}`,
      kind: "hold",
      title: "Hold created",
      at: h.created_at,
      eventId: null,
      note: `Reserved ${h.quantity} ticket${h.quantity === 1 ? "" : "s"} for 10 minutes. Hold status now: ${h.status}.`,
      chips: [
        { label: "Hold", value: shortId(h.id) },
        { label: "Tier", value: h.tier_id },
        { label: "Quantity", value: String(h.quantity) },
        { label: "Expires", value: new Date(h.expires_at).toLocaleTimeString("en-GB") },
      ],
      raw: h,
    });
  }

  audit.state_changes.forEach((change, index) => {
    items.push(...fromStateChange(change, index, audit, money));
  });

  // Array.prototype.sort is stable, so items sharing a timestamp keep the order built above.
  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function fromStateChange(
  change: AuditStateChange,
  index: number,
  audit: AuditResponse,
  money: (minor: number | null) => string | null,
): TimelineItem[] {
  const d = change.detail;
  const base = { id: `change:${index}`, at: change.at, eventId: change.event_id, raw: change.detail };
  const chips = (pairs: Array<[string, string | null]>): TimelineChip[] =>
    pairs.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));

  switch (change.action) {
    case "order_created": {
      const outcome = str(d.outcome) ?? "";
      const flagged = d.needs_manual_refund === true;
      const holdId = str(d.hold_id);
      return [
        {
          ...base,
          kind: flagged ? "warning" : "payment",
          title: flagged
            ? "Payment received · flagged for manual refund"
            : holdId
              ? "Payment received · hold converted to order"
              : "Payment received · order created without a hold",
          note: describeOutcome(outcome).detail,
          chips: chips([
            ["Amount", money(num(d.amount_total))],
            ["Quantity", num(d.quantity) === null ? null : String(num(d.quantity))],
            ["Tier", str(d.tier_id)],
            ["Hold", holdId ? shortId(holdId) : null],
            ["Outcome", outcome || null],
          ]),
        },
      ];
    }

    case "refund_applied": {
      const after = str(d.status_after);
      const full = after === "refunded";
      const replayed = d.replayed_from_parked === true;
      const out: TimelineItem[] = [
        {
          ...base,
          kind: "refund",
          title: full ? "Full refund applied" : "Partial refund applied",
          note: replayed
            ? "This refund arrived before the payment and was applied automatically once the payment was processed."
            : full
              ? "Cumulative refunds now equal the order total."
              : "Inventory stays reserved until the order is fully refunded.",
          chips: chips([
            ["Refunded now", money(num(d.amount_refunded))],
            ["Cumulative", `${money(num(d.cumulative_refunded)) ?? "?"} of ${money(num(d.amount_total)) ?? "?"}`],
            ["Status", `${str(d.status_before) ?? "?"} → ${after ?? "?"}`],
            ["Parked earlier", replayed ? "yes" : null],
          ]),
        },
      ];
      if (d.inventory_released === true) {
        const q = audit.order?.quantity;
        out.push({
          id: `${base.id}:released`,
          kind: "inventory",
          title: "Inventory released",
          at: change.at,
          eventId: change.event_id,
          note: `${q === undefined ? "All" : q} ticket${q === 1 ? "" : "s"} returned to available inventory${audit.order ? ` for ${audit.order.tier_id}` : ""}.`,
          chips: chips([["Released", q === undefined ? null : String(q)]]),
          raw: { inventory_released: true },
        });
      }
      return out;
    }

    case "refund_parked":
      return [
        {
          ...base,
          kind: "parked",
          title: "Refund received before payment · parked",
          note: describeOutcome("parked_until_paid").detail,
          chips: chips([["Refund", money(num(d.amount_refunded))]]),
        },
      ];

    case "refund_ignored": {
      const reason = str(d.reason) ?? "ignored";
      return [
        {
          ...base,
          kind: "warning",
          title: `Refund ignored · ${describeOutcome(reason).title}`,
          note: describeOutcome(reason).detail,
          chips: chips([
            ["Refund", money(num(d.amount_refunded))],
            ["Order status", str(d.status)],
          ]),
        },
      ];
    }

    case "paid_conflict_ignored":
      return [
        {
          ...base,
          kind: "warning",
          title: "Conflicting payment ignored",
          note: describeOutcome("conflicting_paid_ignored").detail,
          chips: [],
        },
      ];

    default:
      return [{ ...base, kind: "warning", title: change.action, chips: [] }];
  }
}
