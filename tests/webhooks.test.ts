/**
 * Database-backed tests: they call the services directly (no HTTP) against the real Postgres in
 * DATABASE_URL and TRUNCATE holds/orders/webhook_events/order_audit before each test.
 * Run with `npm test`; add INVENTORY_LOCKING=serializable to exercise the lock-free mode.
 */
import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { getPool } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { inventoryLocking } from "@/lib/settings";
import type { PaidPayload, RefundPayload } from "@/lib/validation";
import { cancelHold, createHold } from "@/services/holds";
import { getEventWithAvailability } from "@/services/inventory";
import { getOrderAudit } from "@/services/audit";
import { processWebhook } from "@/services/webhooks";

let seq = 0;
const nextId = (p: string): string => `${p}_${Date.now().toString(36)}_${seq++}`;

const paid = (o: Partial<PaidPayload> = {}): PaidPayload => ({
  event_id: nextId("evt_wh"),
  type: "order.paid",
  order_id: "ord_T1",
  tier_id: "tier_001_a",
  quantity: 2,
  amount_total: 17000,
  currency: "EUR",
  occurred_at: new Date().toISOString(),
  ...o,
});

const refund = (o: Partial<RefundPayload> = {}): RefundPayload => ({
  event_id: nextId("evt_wh"),
  type: "order.refunded",
  order_id: "ord_T1",
  amount_refunded: 17000,
  currency: "EUR",
  occurred_at: new Date().toISOString(),
  ...o,
});

async function available(eventId: string, tierId: string): Promise<number> {
  const { tiers } = await getEventWithAvailability(getPool(), eventId);
  const tier = tiers.find((t) => t.id === tierId);
  assert.ok(tier, `tier ${tierId} exists`);
  return tier.available;
}

const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await getPool().query<{ n: string }>(sql, params)).rows[0]?.n);

// File-level: runs once after every suite in this file has finished.
after(async () => {
  await getPool().end();
});

describe("webhook handling", () => {
  beforeEach(async () => {
    await getPool().query("TRUNCATE webhook_events, orders, holds, order_audit");
  });

  it("Scenario A: hold then paid converts the hold; availability is deducted exactly once", async () => {
    const hold = await createHold("evt_001", "tier_001_a", 2);
    assert.equal(await available("evt_001", "tier_001_a"), 48);
    const r = await processWebhook(paid());
    assert.equal(r.outcome, "paid_from_hold");
    assert.equal(await available("evt_001", "tier_001_a"), 48);
    const status = (await getPool().query("SELECT status FROM holds WHERE id = $1", [hold.id])).rows[0]?.status;
    assert.equal(status, "converted");
  });

  it("Scenario B: the same event_id twice leaves the same end state as once", async () => {
    await createHold("evt_001", "tier_001_a", 2);
    const evt = paid();
    const first = await processWebhook(evt);
    const second = await processWebhook(evt);
    assert.equal(first.status, "processed");
    assert.equal(second.status, "duplicate");
    assert.equal(await count("SELECT count(*) n FROM orders"), 1);
    assert.equal(await count("SELECT count(*) n FROM webhook_events"), 1);
    assert.equal(await available("evt_001", "tier_001_a"), 48);
  });

  it("concurrent identical deliveries produce exactly one order and one 'processed'", async () => {
    await createHold("evt_001", "tier_001_a", 2);
    const evt = paid();
    const results = await Promise.all(Array.from({ length: 6 }, () => processWebhook(evt)));
    assert.equal(results.filter((r) => r.status === "processed").length, 1);
    assert.equal(results.filter((r) => r.status === "duplicate").length, 5);
    assert.equal(await count("SELECT count(*) n FROM orders"), 1);
    assert.equal(await available("evt_001", "tier_001_a"), 48);
  });

  it("the same order re-emitted under a new event_id does not double-deduct", async () => {
    await createHold("evt_001", "tier_001_a", 2);
    await processWebhook(paid());
    const again = await processWebhook(paid());
    assert.equal(again.outcome, "order_already_exists");
    assert.equal(await count("SELECT count(*) n FROM orders"), 1);
    assert.equal(await available("evt_001", "tier_001_a"), 48);
  });

  it("a conflicting paid for an existing order is ignored, not applied", async () => {
    await createHold("evt_001", "tier_001_a", 2);
    await processWebhook(paid());
    const r = await processWebhook(paid({ quantity: 5, amount_total: 42500 }));
    assert.equal(r.outcome, "conflicting_paid_ignored");
    assert.equal(await count("SELECT quantity n FROM orders WHERE id = 'ord_T1'"), 2);
  });

  it("a payment that does not match the tier price is rejected and leaves no trace", async () => {
    await assert.rejects(
      () => processWebhook(paid({ amount_total: 1 })),
      (err: unknown) => err instanceof AppError && err.status === 422 && err.code === "PAYMENT_MISMATCH",
    );
    assert.equal(await count("SELECT count(*) n FROM webhook_events"), 0, "dedupe row rolled back so a retry can succeed");
    assert.equal(await count("SELECT count(*) n FROM orders"), 0);
  });

  it("refund before paid is parked, then applied when the payment arrives", async () => {
    const early = await processWebhook(refund());
    assert.equal(early.status, "pending");
    assert.equal(await count("SELECT count(*) n FROM webhook_events WHERE processed_at IS NULL"), 1);

    await createHold("evt_001", "tier_001_a", 2);
    await processWebhook(paid());
    assert.equal((await getPool().query("SELECT status FROM orders WHERE id = 'ord_T1'")).rows[0]?.status, "refunded");
    assert.equal(await count("SELECT count(*) n FROM webhook_events WHERE processed_at IS NULL"), 0);
    assert.equal(await available("evt_001", "tier_001_a"), 50, "full refund released the tickets");
  });

  it("partial refunds keep inventory held; only the full refund releases it", async () => {
    await createHold("evt_001", "tier_001_a", 2);
    await processWebhook(paid());
    await processWebhook(refund({ amount_refunded: 5000 }));
    assert.equal((await getPool().query("SELECT status FROM orders")).rows[0]?.status, "partially_refunded");
    assert.equal(await available("evt_001", "tier_001_a"), 48);
    await processWebhook(refund({ amount_refunded: 12000 }));
    assert.equal((await getPool().query("SELECT status FROM orders")).rows[0]?.status, "refunded");
    assert.equal(await available("evt_001", "tier_001_a"), 50);
  });

  it("duplicate refunds are summed once; a refund beyond the order total is ignored", async () => {
    await createHold("evt_001", "tier_001_a", 2);
    await processWebhook(paid());
    const partial = refund({ amount_refunded: 6000 });
    await Promise.all([processWebhook(partial), processWebhook(partial), processWebhook(partial)]);
    assert.equal(await count("SELECT amount_refunded n FROM orders"), 6000);
    const over = await processWebhook(refund({ amount_refunded: 12000 }));
    assert.equal(over.outcome, "refund_exceeds_order_ignored");
    assert.equal(await count("SELECT amount_refunded n FROM orders"), 6000);
  });

  it("payment after expiry: honored when stock is free, flagged (and non-consuming) when it is not", async () => {
    const hold = await createHold("evt_002", "tier_002_b", 2);
    await cancelHold(hold.id);
    const ok = await processWebhook(paid({ order_id: "ord_late", tier_id: "tier_002_b", quantity: 2, amount_total: 1600 }));
    assert.equal(ok.outcome, "paid_without_hold");
    assert.equal(await available("evt_002", "tier_002_b"), 18);

    await createHold("evt_002", "tier_002_b", 18); // everything now held
    const flagged = await processWebhook(
      paid({ order_id: "ord_nostock", tier_id: "tier_002_b", quantity: 1, amount_total: 800 }),
    );
    assert.equal(flagged.outcome, "paid_no_inventory_needs_manual_refund");
    assert.equal(await available("evt_002", "tier_002_b"), 0);
  });

  it("audit trail lists each state change in order, including parked refunds", async () => {
    await processWebhook(refund({ amount_refunded: 5000 })); // parked
    await createHold("evt_001", "tier_001_a", 2);
    await processWebhook(paid()); // creates order, replays parked partial refund
    await processWebhook(refund({ amount_refunded: 12000 })); // completes the refund

    const trail = await getOrderAudit("ord_T1");
    assert.deepEqual(
      trail.state_changes.map((s) => s.action),
      ["refund_parked", "order_created", "refund_applied", "refund_applied"],
    );
    assert.equal(trail.order?.status, "refunded");
    assert.ok(trail.hold, "the consumed hold is included");
    assert.equal(trail.webhook_deliveries.length, 3);

    await assert.rejects(
      () => getOrderAudit("ord_does_not_exist"),
      (err: unknown) => err instanceof AppError && err.status === 404,
    );
  });
});

describe(`concurrent holds (INVENTORY_LOCKING=${inventoryLocking()})`, () => {
  beforeEach(async () => {
    await getPool().query("TRUNCATE webhook_events, orders, holds, order_audit");
  });

  it("never oversells: 30 parallel single-ticket holds on a 20-seat tier", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, () => createHold("evt_002", "tier_002_b", 1)),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const codes = results.flatMap((r) => (r.status === "rejected" && r.reason instanceof AppError ? [r.reason.code] : []));
    const unexpected = results.filter(
      (r) => r.status === "rejected" && !(r.reason instanceof AppError),
    ).length;

    assert.equal(unexpected, 0, "only structured errors");
    assert.ok(ok <= 20, `sold ${ok} of 20 seats`);
    assert.equal(await available("evt_002", "tier_002_b"), 20 - ok);
    assert.equal(ok + codes.length, 30);
    if (inventoryLocking() === "tier-lock") assert.equal(ok, 20, "row lock serializes: every seat is sold");
    const rejected: Record<string, number> = {};
    for (const c of codes) rejected[c] = (rejected[c] ?? 0) + 1;
    console.log(`      ${ok} succeeded, rejected: ${JSON.stringify(rejected)}`);
  });

  it("two requests for the last ticket: exactly one wins", async () => {
    await createHold("evt_002", "tier_002_b", 19);
    const results = await Promise.allSettled([
      createHold("evt_002", "tier_002_b", 1),
      createHold("evt_002", "tier_002_b", 1),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const loser = results.find((r) => r.status === "rejected");
    assert.ok(loser && loser.status === "rejected" && loser.reason instanceof AppError);
    assert.equal(loser.reason.code, "OVERSOLD");
    assert.equal(await available("evt_002", "tier_002_b"), 0);
  });
});
