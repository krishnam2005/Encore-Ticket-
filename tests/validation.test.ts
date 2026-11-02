import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHoldSchema, webhookSchema } from "@/lib/validation";

const paid = {
  event_id: "evt_wh_1",
  type: "order.paid",
  order_id: "ord_1",
  tier_id: "tier_001_a",
  quantity: 2,
  amount_total: 17000,
  currency: "EUR",
  occurred_at: "2026-06-25T11:32:14Z",
};

const refunded = {
  event_id: "evt_wh_2",
  type: "order.refunded",
  order_id: "ord_1",
  amount_refunded: 17000,
  currency: "EUR",
  occurred_at: "2026-06-25T14:08:51Z",
};

describe("webhookSchema", () => {
  it("accepts the two payloads from the assignment verbatim", () => {
    assert.equal(webhookSchema.safeParse(paid).success, true);
    assert.equal(webhookSchema.safeParse(refunded).success, true);
  });

  it("rejects unknown event types", () => {
    assert.equal(webhookSchema.safeParse({ ...paid, type: "order.chargeback" }).success, false);
  });

  it("rejects non-positive or fractional quantities and refund amounts", () => {
    assert.equal(webhookSchema.safeParse({ ...paid, quantity: 0 }).success, false);
    assert.equal(webhookSchema.safeParse({ ...paid, quantity: 1.5 }).success, false);
    assert.equal(webhookSchema.safeParse({ ...refunded, amount_refunded: -5 }).success, false);
  });

  it("rejects a missing event_id (the idempotency key) and a bad timestamp", () => {
    const { event_id: _omit, ...withoutId } = paid;
    assert.equal(webhookSchema.safeParse(withoutId).success, false);
    assert.equal(webhookSchema.safeParse({ ...paid, occurred_at: "yesterday" }).success, false);
  });
});

describe("createHoldSchema", () => {
  it("requires a tier and a positive whole quantity", () => {
    assert.equal(createHoldSchema.safeParse({ tier_id: "tier_002_b", quantity: 1 }).success, true);
    assert.equal(createHoldSchema.safeParse({ tier_id: "tier_002_b", quantity: 0 }).success, false);
    assert.equal(createHoldSchema.safeParse({ tier_id: "tier_002_b", quantity: 2.5 }).success, false);
    assert.equal(createHoldSchema.safeParse({ quantity: 1 }).success, false);
  });
});
