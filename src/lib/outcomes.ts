export type OutcomeTone = "good" | "neutral" | "warn" | "bad";

interface OutcomeInfo {
  tone: OutcomeTone;
  title: string;
  detail: string;
}

/** Plain-language explanation of the `outcome` string the webhook endpoint returns. */
const OUTCOMES: Record<string, OutcomeInfo> = {
  paid_from_hold: {
    tone: "good",
    title: "Paid: hold converted to an order",
    detail: "A matching active hold was found (oldest hold with the same tier and quantity) and became the order. Availability is unchanged.",
  },
  paid_without_hold: {
    tone: "neutral",
    title: "Paid with no active hold; order created from free stock",
    detail: "No matching active hold (expired or never made), but stock was still available, so the order was honored and inventory reduced.",
  },
  paid_no_inventory_needs_manual_refund: {
    tone: "warn",
    title: "Paid, but no inventory left: flagged for manual refund",
    detail: "The payment is recorded and acknowledged (a retry could not create stock). The order does not consume inventory and needs a manual refund.",
  },
  order_already_exists: {
    tone: "neutral",
    title: "Order already exists: no change",
    detail: "Same order id re-emitted under a new event id. Nothing was deducted twice.",
  },
  conflicting_paid_ignored: {
    tone: "bad",
    title: "Conflicting paid event ignored",
    detail: "An order with this id already exists with different tier, quantity or amount. The original was kept and the conflict logged.",
  },
  duplicate: {
    tone: "good",
    title: "Duplicate delivery: no change",
    detail: "This event id was already processed. Idempotency gate hit, so the end state is identical to receiving it once.",
  },
  duplicate_payload_mismatch: {
    tone: "warn",
    title: "Duplicate event id with a different payload",
    detail: "The first delivery wins; this one was ignored and a warning logged.",
  },
  parked_until_paid: {
    tone: "warn",
    title: "Refund received before the payment: parked",
    detail: "Stored durably and acknowledged. It will be applied automatically when the matching order.paid arrives.",
  },
  partially_refunded: {
    tone: "good",
    title: "Partial refund applied",
    detail: "Order is partially refunded. Inventory is NOT released.",
  },
  refunded: {
    tone: "good",
    title: "Full refund applied",
    detail: "Cumulative refunds equal the order total. All tickets in the order return to available inventory.",
  },
  already_refunded: {
    tone: "neutral",
    title: "Order already fully refunded: no change",
    detail: "Nothing further to refund.",
  },
  refund_exceeds_order_ignored: {
    tone: "bad",
    title: "Refund would exceed the order total: ignored",
    detail: "Cumulative refunds may never exceed the original amount. Nothing was applied.",
  },
  refund_currency_mismatch_ignored: {
    tone: "bad",
    title: "Refund currency does not match the order: ignored",
    detail: "Nothing was applied.",
  },
};

export function describeOutcome(outcome: string): OutcomeInfo {
  const parked = outcome.endsWith("_after_parked");
  const base = parked ? outcome.slice(0, -"_after_parked".length) : outcome;
  const info = OUTCOMES[base];
  if (!info) return { tone: "neutral", title: outcome, detail: "Outcome returned by the API." };
  return parked
    ? { ...info, title: `${info.title} (from a parked refund)`, detail: info.detail }
    : info;
}
