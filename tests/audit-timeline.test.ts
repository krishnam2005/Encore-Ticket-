import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditResponse } from "@/lib/admin-types";
import { buildTimeline } from "@/lib/audit-timeline";

// Shaped like a real GET /admin/audit response: parked refund -> payment -> replayed refund -> final refund.
const audit: AuditResponse = {
  order_id: "ord_T1",
  order: {
    id: "ord_T1",
    tier_id: "tier_001_a",
    quantity: 2,
    status: "refunded",
    amount_total: 17000,
    amount_refunded: 17000,
    currency: "EUR",
    hold_id: "e1111111-2222-3333-4444-555555555555",
    needs_manual_refund: false,
    created_at: "2026-11-02T10:00:03.000Z",
    updated_at: "2026-11-02T10:00:05.000Z",
  },
  hold: {
    id: "e1111111-2222-3333-4444-555555555555",
    tier_id: "tier_001_a",
    quantity: 2,
    status: "converted",
    created_at: "2026-11-02T10:00:01.000Z",
    expires_at: "2026-11-02T10:10:01.000Z",
  },
  state_changes: [
    { at: "2026-11-02T10:00:00.000Z", action: "refund_parked", event_id: "e_r1", detail: { amount_refunded: 5000 } },
    {
      at: "2026-11-02T10:00:03.000Z",
      action: "order_created",
      event_id: "e_p1",
      detail: { outcome: "paid_from_hold", hold_id: "e1111111-2222-3333-4444-555555555555", amount_total: 17000, quantity: 2, tier_id: "tier_001_a", needs_manual_refund: false },
    },
    {
      at: "2026-11-02T10:00:03.010Z",
      action: "refund_applied",
      event_id: "e_r1",
      detail: { status_before: "paid", status_after: "partially_refunded", amount_refunded: 5000, cumulative_refunded: 5000, amount_total: 17000, inventory_released: false, replayed_from_parked: true },
    },
    {
      at: "2026-11-02T10:00:05.000Z",
      action: "refund_applied",
      event_id: "e_r2",
      detail: { status_before: "partially_refunded", status_after: "refunded", amount_refunded: 12000, cumulative_refunded: 17000, amount_total: 17000, inventory_released: true, replayed_from_parked: false },
    },
  ],
  webhook_deliveries: [],
};

describe("buildTimeline", () => {
  const items = buildTimeline(audit);

  it("orders events chronologically and includes the hold", () => {
    assert.deepEqual(
      items.map((i) => i.kind),
      ["parked", "hold", "payment", "refund", "refund", "inventory"],
    );
    const times = items.map((i) => new Date(i.at).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  it("distinguishes partial from full refunds and marks the replayed one", () => {
    const refunds = items.filter((i) => i.kind === "refund");
    assert.equal(refunds[0]?.title, "Partial refund applied");
    assert.ok(refunds[0]?.chips.some((c) => c.label === "Parked earlier"));
    assert.equal(refunds[1]?.title, "Full refund applied");
  });

  it("adds an 'Inventory released' step only after the refund that the API flagged as releasing it", () => {
    const released = items.filter((i) => i.kind === "inventory");
    assert.equal(released.length, 1);
    assert.equal(items.indexOf(released[0]!), items.length - 1);
    assert.match(released[0]!.note ?? "", /2 tickets returned/);
  });

  it("formats money with the order's currency", () => {
    const payment = items.find((i) => i.kind === "payment");
    assert.ok(payment?.chips.some((c) => c.label === "Amount" && c.value.includes("170")));
  });

  it("flags payments marked for manual refund as warnings, and unknown actions safely", () => {
    const flagged = buildTimeline({
      ...audit,
      hold: null,
      state_changes: [
        { at: "2026-11-02T10:00:00Z", action: "order_created", event_id: "x", detail: { outcome: "paid_no_inventory_needs_manual_refund", needs_manual_refund: true } },
        { at: "2026-11-02T10:00:01Z", action: "something_new", event_id: null, detail: {} },
      ],
    });
    assert.equal(flagged[0]?.kind, "warning");
    assert.match(flagged[0]?.title ?? "", /manual refund/);
    assert.equal(flagged[1]?.title, "something_new");
  });
});
