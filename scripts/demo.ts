/**
 * End-to-end scenarios against a running server (default http://localhost:3000).
 * Usage: npm run demo            (BASE_URL=https://... npm run demo for the deployed API)
 * WARNING: truncates holds, orders and webhook_events in the database DATABASE_URL points at.
 */
import { Client } from "pg";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
}

interface Resp {
  status: number;
  body: Record<string, unknown>;
}

async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<Resp> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function available(eventId: string, tierId: string): Promise<number> {
  const { body } = await call("GET", `/events/${eventId}`);
  const tiers = body.tiers as Array<{ id: string; available: number }>;
  const tier = tiers.find((t) => t.id === tierId);
  if (!tier) throw new Error(`tier ${tierId} missing`);
  return tier.available;
}

const hold = (eventId: string, tierId: string, quantity: number): Promise<Resp> =>
  call("POST", `/events/${eventId}/holds`, { tier_id: tierId, quantity });

let seq = 0;
const eid = (): string => `evt_wh_${Date.now()}_${seq++}`;

const paid = (orderId: string, tierId: string, quantity: number, amount: number, eventId = eid()) => ({
  event_id: eventId,
  type: "order.paid",
  order_id: orderId,
  tier_id: tierId,
  quantity,
  amount_total: amount,
  currency: "EUR",
  occurred_at: new Date().toISOString(),
});

const refunded = (orderId: string, amount: number, eventId = eid()) => ({
  event_id: eventId,
  type: "order.refunded",
  order_id: orderId,
  amount_refunded: amount,
  currency: "EUR",
  occurred_at: new Date().toISOString(),
});

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const db = new Client({ connectionString });
  await db.connect();
  const reset = async (): Promise<void> => {
    await db.query("TRUNCATE webhook_events, orders, holds, order_audit");
  };
  const scalar = async (sql: string, params: unknown[] = []): Promise<unknown> =>
    Object.values((await db.query(sql, params)).rows[0] ?? {})[0];

  try {
    console.log("\nScenario A: happy path (hold -> paid webhook)");
    await reset();
    check("starts at 50 available", (await available("evt_001", "tier_001_a")) === 50);
    const h = await hold("evt_001", "tier_001_a", 2);
    check("hold created (201) with expires_at", h.status === 201 && typeof h.body.expires_at === "string", h);
    check("hold reduces availability to 48", (await available("evt_001", "tier_001_a")) === 48);
    const a = await call("POST", "/webhooks/payments", paid("ord_A", "tier_001_a", 2, 17000));
    check("webhook acked 200 processed", a.status === 200 && a.body.status === "processed", a);
    check("still 48 available (hold became order, no double count)", (await available("evt_001", "tier_001_a")) === 48);
    check("hold converted", (await scalar("SELECT status FROM holds WHERE id = $1", [h.body.hold_id])) === "converted");
    check("order stored as paid", (await scalar("SELECT status FROM orders WHERE id = 'ord_A'")) === "paid");

    console.log("\nScenario B: idempotent delivery (same event_id twice, plus a re-emit)");
    await reset();
    await hold("evt_001", "tier_001_a", 2);
    const same = paid("ord_B", "tier_001_a", 2, 17000, "evt_wh_fixed_B");
    const b1 = await call("POST", "/webhooks/payments", same);
    const b2 = await call("POST", "/webhooks/payments", same);
    const b3 = await call("POST", "/webhooks/payments", paid("ord_B", "tier_001_a", 2, 17000)); // new event_id, same order
    check("1st processed", b1.status === 200 && b1.body.status === "processed", b1);
    check("2nd is duplicate (200)", b2.status === 200 && b2.body.status === "duplicate", b2);
    check("same order re-emitted under new event_id is a no-op", b3.status === 200 && b3.body.outcome === "order_already_exists", b3);
    check("exactly one order row", (await scalar("SELECT count(*)::int FROM orders")) === 1);
    check("availability deducted once (48)", (await available("evt_001", "tier_001_a")) === 48);
    const parallel = paid("ord_B2", "tier_001_a", 1, 8500, "evt_wh_parallel_B2");
    await Promise.all(Array.from({ length: 5 }, () => call("POST", "/webhooks/payments", parallel)));
    check("5 concurrent identical deliveries -> one order", (await scalar("SELECT count(*)::int FROM orders WHERE id = 'ord_B2'")) === 1);
    check("5 concurrent identical deliveries -> deducted once (47)", (await available("evt_001", "tier_001_a")) === 47);

    console.log("\nScenario C: race for the last Student ticket (tier_002_b, 20 total)");
    await reset();
    const pre = await hold("evt_002", "tier_002_b", 19);
    check("19 held, 1 left", pre.status === 201 && (await available("evt_002", "tier_002_b")) === 1);
    const [c1, c2] = await Promise.all([hold("evt_002", "tier_002_b", 1), hold("evt_002", "tier_002_b", 1)]);
    const statuses = [c1.status, c2.status].sort();
    check("exactly one 201 and one 409", statuses[0] === 201 && statuses[1] === 409, [c1, c2]);
    const loser = c1.status === 409 ? c1 : c2;
    const err = loser.body.error as { code?: string } | undefined;
    check("loser gets structured OVERSOLD error", err?.code === "OVERSOLD", loser.body);
    check("availability is 0, never negative", (await available("evt_002", "tier_002_b")) === 0);

    await reset();
    const burst = await Promise.all(Array.from({ length: 40 }, () => hold("evt_002", "tier_002_b", 1)));
    const ok = burst.filter((r) => r.status === 201).length;
    check("40 concurrent single-ticket holds on 20 seats -> exactly 20 succeed", ok === 20, { ok });
    check("others are 409", burst.filter((r) => r.status === 409).length === 20);

    console.log("\nScenario D: refund arrives BEFORE paid");
    await reset();
    const r = await call("POST", "/webhooks/payments", refunded("ord_D", 1500, "evt_wh_D_refund"));
    check("refund acked 200 as pending (durably parked)", r.status === 200 && r.body.status === "pending", r);
    check("parked row has processed_at NULL", (await scalar("SELECT processed_at IS NULL FROM webhook_events WHERE id = 'evt_wh_D_refund'")) === true);
    await hold("evt_002", "tier_002_a", 1);
    const p = await call("POST", "/webhooks/payments", paid("ord_D", "tier_002_a", 1, 1500));
    check("paid processed", p.status === 200 && p.body.status === "processed", p);
    check("order ends refunded", (await scalar("SELECT status FROM orders WHERE id = 'ord_D'")) === "refunded");
    check("tickets back in inventory (80)", (await available("evt_002", "tier_002_a")) === 80);
    check("parked refund marked processed", (await scalar("SELECT processed_at IS NOT NULL FROM webhook_events WHERE id = 'evt_wh_D_refund'")) === true);
    const rd = await call("POST", "/webhooks/payments", refunded("ord_D", 1500, "evt_wh_D_refund"));
    check("redelivered refund is a duplicate", rd.body.status === "duplicate", rd);

    console.log("\nScenario E: partial vs full refund");
    await reset();
    await hold("evt_001", "tier_001_b", 2);
    await call("POST", "/webhooks/payments", paid("ord_E", "tier_001_b", 2, 9000));
    await call("POST", "/webhooks/payments", refunded("ord_E", 4500));
    check("partial refund -> partially_refunded", (await scalar("SELECT status FROM orders WHERE id = 'ord_E'")) === "partially_refunded");
    check("partial refund does NOT release inventory (198)", (await available("evt_001", "tier_001_b")) === 198);
    await call("POST", "/webhooks/payments", refunded("ord_E", 4500));
    check("rest of the money -> refunded", (await scalar("SELECT status FROM orders WHERE id = 'ord_E'")) === "refunded");
    check("full refund releases all tickets (200)", (await available("evt_001", "tier_001_b")) === 200);

    console.log("\nScenario E2: refund duplicates and over-refunds");
    await reset();
    await hold("evt_001", "tier_001_b", 2);
    await call("POST", "/webhooks/payments", paid("ord_E2", "tier_001_b", 2, 9000));
    const part = refunded("ord_E2", 6000, "evt_wh_E2_part");
    await call("POST", "/webhooks/payments", part);
    await call("POST", "/webhooks/payments", part);
    await Promise.all(Array.from({ length: 4 }, () => call("POST", "/webhooks/payments", part)));
    check("duplicate refund deliveries sum only once (6000)", (await scalar("SELECT amount_refunded FROM orders WHERE id = 'ord_E2'")) === 6000);
    const over = await call("POST", "/webhooks/payments", refunded("ord_E2", 6000));
    check("refund pushing total past order amount is ignored (2xx, flagged)", over.status === 200 && over.body.outcome === "refund_exceeds_order_ignored", over);
    check("amount_refunded unchanged (6000), status partially_refunded", (await scalar("SELECT amount_refunded FROM orders WHERE id = 'ord_E2'")) === 6000 && (await scalar("SELECT status FROM orders WHERE id = 'ord_E2'")) === "partially_refunded");
    check("inventory still held back (198)", (await available("evt_001", "tier_001_b")) === 198);

    console.log("\nScenario F: payment after hold expiry");
    await reset();
    const hf = await hold("evt_002", "tier_002_b", 2);
    const cancel = await call("POST", `/orders/${String(hf.body.hold_id)}/cancel-hold`);
    check("cancel-hold expires it", cancel.status === 200 && cancel.body.status === "expired", cancel);
    const cancel2 = await call("POST", `/orders/${String(hf.body.hold_id)}/cancel-hold`);
    check("cancelling twice -> 409 HOLD_NOT_ACTIVE", cancel2.status === 409, cancel2);
    check("expired hold released stock (20)", (await available("evt_002", "tier_002_b")) === 20);
    const f1 = await call("POST", "/webhooks/payments", paid("ord_F1", "tier_002_b", 2, 1600));
    check("stock free -> order created without hold", f1.body.outcome === "paid_without_hold", f1);
    check("and deducts inventory (18)", (await available("evt_002", "tier_002_b")) === 18);
    await hold("evt_002", "tier_002_b", 18); // everything now held
    const f2 = await call("POST", "/webhooks/payments", paid("ord_F2", "tier_002_b", 1, 800));
    check("no stock -> acked 200 but flagged", f2.status === 200 && f2.body.outcome === "paid_no_inventory_needs_manual_refund", f2);
    check("flagged order stored", (await scalar("SELECT needs_manual_refund FROM orders WHERE id = 'ord_F2'")) === true);
    check("flagged order does not consume inventory (0 available, not negative)", (await available("evt_002", "tier_002_b")) === 0);

    console.log("\nErrors");
    const bad = await hold("evt_002", "tier_002_b", 0);
    check("quantity 0 -> 400 VALIDATION_ERROR", bad.status === 400 && (bad.body.error as { code: string }).code === "VALIDATION_ERROR", bad);
    const nf = await call("GET", "/events/nope");
    check("unknown event -> 404 EVENT_NOT_FOUND", nf.status === 404, nf);
    const wrongTier = await hold("evt_002", "tier_001_a", 1);
    check("tier from another event -> 404", wrongTier.status === 404, wrongTier);
    const mism = await call("POST", "/webhooks/payments", paid("ord_X", "tier_002_a", 1, 1));
    check("amount mismatch -> 422 (non-2xx so processor retries/alerts)", mism.status === 422, mism);
    check("failed webhook left no trace (rolled back)", (await scalar("SELECT count(*)::int FROM webhook_events WHERE order_id = 'ord_X'")) === 0);
    const junk = await call("POST", "/webhooks/payments", { hello: "world" });
    check("malformed webhook -> 400", junk.status === 400, junk);
  } finally {
    await db.end();
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
