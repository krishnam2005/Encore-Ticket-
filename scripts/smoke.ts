/**
 * HTTP-only smoke test for a running deployment. No database access needed, so a reviewer can run it
 * against the live URL:
 *
 *   BASE_URL=https://encore-ticket-mu.vercel.app npm run smoke
 *   ADMIN_TOKEN=... BASE_URL=... npm run smoke        # also verifies /admin/* (optional)
 *
 * It creates its own holds and orders (unique ids), then cancels the holds and fully refunds the orders so
 * inventory returns to where it started. It assumes nobody else is using the same tiers while it runs.
 */
const BASE = (process.env.BASE_URL ?? "https://encore-ticket-mu.vercel.app").replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const RUN = Date.now().toString(36);

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  const extra = !ok && detail !== undefined ? ` -> ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : "";
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra.slice(0, 300)}`);
}

interface Resp {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

async function call(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Resp> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>, headers: res.headers };
}

const errorCode = (r: Resp): string | undefined => {
  const e = r.body.error;
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
};

async function available(eventId: string, tierId: string): Promise<number> {
  const r = await call("GET", `/events/${eventId}`);
  const tiers = r.body.tiers as Array<{ id: string; available: number }> | undefined;
  const tier = tiers?.find((t) => t.id === tierId);
  if (!tier) throw new Error(`tier ${tierId} not found in ${eventId} (HTTP ${r.status})`);
  return tier.available;
}

const myHolds: string[] = [];
async function hold(eventId: string, tierId: string, quantity: number): Promise<Resp> {
  const r = await call("POST", `/events/${eventId}/holds`, { tier_id: tierId, quantity });
  if (r.status === 201 && typeof r.body.hold_id === "string") myHolds.push(r.body.hold_id);
  return r;
}

let seq = 0;
const eid = (): string => `smoke_${RUN}_${seq++}`;
const nowIso = (): string => new Date().toISOString();
const paid = (order: string, tier: string, qty: number, amount: number, eventId = eid()) => ({
  event_id: eventId, type: "order.paid", order_id: order, tier_id: tier, quantity: qty, amount_total: amount, currency: "EUR", occurred_at: nowIso(),
});
const refund = (order: string, amount: number, eventId = eid()) => ({
  event_id: eventId, type: "order.refunded", order_id: order, amount_refunded: amount, currency: "EUR", occurred_at: nowIso(),
});
const wh = (payload: object): Promise<Resp> => call("POST", "/webhooks/payments", payload);

async function main(): Promise<void> {
  console.log(`\nSmoke test against ${BASE}   (run ${RUN})`);

  const reach = await call("GET", "/events/evt_002").catch((e: unknown) => ({ status: 0, body: { error: String(e) }, headers: new Headers() }) as Resp);
  if (reach.status !== 200) {
    console.log(`  FAIL  API not reachable / not healthy (HTTP ${reach.status})`);
    process.exit(1);
  }
  const start = {
    a: await available("evt_001", "tier_001_a"),
    b: await available("evt_001", "tier_001_b"),
    c: await available("evt_001", "tier_001_c"),
    sa: await available("evt_002", "tier_002_a"),
    sb: await available("evt_002", "tier_002_b"),
  };
  console.log(`  starting availability: ${JSON.stringify(start)}`);

  const orderA = `ord_smoke_${RUN}_A`;
  const orderB = `ord_smoke_${RUN}_B`;
  const orderO = `ord_smoke_${RUN}_OOO`;
  const orderP = `ord_smoke_${RUN}_P`;

  console.log("\nScenario A: happy path");
  const ha = await hold("evt_001", "tier_001_a", 1);
  check("hold created (201) with hold_id and expires_at", ha.status === 201 && typeof ha.body.hold_id === "string" && typeof ha.body.expires_at === "string", ha.body);
  check("availability dropped by 1", (await available("evt_001", "tier_001_a")) === start.a - 1);
  const pa = await wh(paid(orderA, "tier_001_a", 1, 8500));
  check("paid webhook processed from the hold", pa.status === 200 && pa.body.outcome === "paid_from_hold", pa.body);
  check("tickets stay out of inventory (no double count)", (await available("evt_001", "tier_001_a")) === start.a - 1);

  console.log("\nScenario B: idempotent delivery");
  await hold("evt_001", "tier_001_c", 1);
  const dup = paid(orderB, "tier_001_c", 1, 3000);
  const b1 = await wh(dup);
  const afterFirst = await available("evt_001", "tier_001_c");
  const b2 = await wh(dup);
  const b3 = await wh(dup);
  check("first delivery processed", b1.status === 200 && b1.body.status === "processed", b1.body);
  check("redeliveries acknowledged as duplicates (2xx)", b2.status === 200 && b2.body.status === "duplicate" && b3.body.status === "duplicate", [b2.body, b3.body]);
  check("no double deduction", (await available("evt_001", "tier_001_c")) === afterFirst);
  const par = paid(`ord_smoke_${RUN}_PAR`, "tier_001_c", 1, 3000);
  const burst = await Promise.all(Array.from({ length: 5 }, () => wh(par)));
  check("5 concurrent identical deliveries: exactly one processed", burst.filter((r) => r.body.status === "processed").length === 1 && burst.every((r) => r.status === 200), burst.map((r) => r.body.status));
  await wh(refund(`ord_smoke_${RUN}_PAR`, 3000)); // clean up that order

  console.log("\nScenario C: race for the last Student ticket");
  const a0 = await available("evt_002", "tier_002_b");
  if (a0 < 1) {
    console.log("  SKIP  Student tier is sold out right now; reset the data or wait for holds to expire");
  } else {
    if (a0 > 1) await hold("evt_002", "tier_002_b", a0 - 1); // leave exactly one
    check("exactly one Student ticket left", (await available("evt_002", "tier_002_b")) === 1);
    const [c1, c2] = await Promise.all([hold("evt_002", "tier_002_b", 1), hold("evt_002", "tier_002_b", 1)]);
    const codes = [c1.status, c2.status].sort();
    check("exactly one 201 and one 409", codes[0] === 201 && codes[1] === 409, codes);
    const loser = c1.status === 409 ? c1 : c2;
    check("loser gets structured OVERSOLD error with request_id", errorCode(loser) === "OVERSOLD" && typeof (loser.body.error as { request_id?: unknown })?.request_id === "string", loser.body);
    check("never oversold: availability is exactly 0", (await available("evt_002", "tier_002_b")) === 0);
  }

  console.log("\nOut-of-order: refund arrives BEFORE the payment");
  const early = await wh(refund(orderO, 1500));
  check("refund acknowledged and parked (200, pending)", early.status === 200 && early.body.status === "pending", early.body);
  await hold("evt_002", "tier_002_a", 1);
  const late = await wh(paid(orderO, "tier_002_a", 1, 1500));
  check("payment processed", late.status === 200 && late.body.status === "processed", late.body);
  check("parked refund applied: tickets released again", (await available("evt_002", "tier_002_a")) === start.sa);

  console.log("\nPartial and full refunds");
  const base = await available("evt_001", "tier_001_b");
  await hold("evt_001", "tier_001_b", 2);
  await wh(paid(orderP, "tier_001_b", 2, 9000));
  const part = refund(orderP, 3000);
  const r1 = await wh(part);
  await wh(part); // duplicate
  check("partial refund applied", r1.body.outcome === "partially_refunded", r1.body);
  check("partial refund does NOT release inventory", (await available("evt_001", "tier_001_b")) === base - 2);
  const over = await wh(refund(orderP, 7000));
  check("refund beyond the order total is ignored (2xx)", over.status === 200 && over.body.outcome === "refund_exceeds_order_ignored", over.body);
  const full = await wh(refund(orderP, 6000));
  check("remaining amount completes the refund (duplicate was counted once)", full.body.outcome === "refunded", full.body);
  check("full refund releases all tickets", (await available("evt_001", "tier_001_b")) === base);

  console.log("\nErrors and observability");
  const bad = await hold("evt_002", "tier_002_b", 0);
  check("quantity 0 -> 400 VALIDATION_ERROR", bad.status === 400 && errorCode(bad) === "VALIDATION_ERROR", bad.body);
  const nf = await call("GET", "/events/does_not_exist");
  check("unknown event -> 404 EVENT_NOT_FOUND", nf.status === 404 && errorCode(nf) === "EVENT_NOT_FOUND", nf.body);
  const wrongTier = await hold("evt_002", "tier_001_a", 1);
  check("tier from another event -> 404", wrongTier.status === 404, wrongTier.body);
  const mismatch = await wh(paid(`ord_smoke_${RUN}_BAD`, "tier_002_a", 1, 1));
  check("wrong amount -> 422 PAYMENT_MISMATCH (non-2xx so the processor retries)", mismatch.status === 422 && errorCode(mismatch) === "PAYMENT_MISMATCH", mismatch.body);
  const junk = await wh({ hello: "world" });
  check("malformed webhook -> 400", junk.status === 400, junk.body);
  const traced = await call("GET", "/events/evt_002", undefined, { "x-request-id": `trace-${RUN}` });
  check("x-request-id is echoed", traced.headers.get("x-request-id") === `trace-${RUN}`);
  const stray = await call("POST", `/orders/00000000-0000-0000-0000-000000000000/cancel-hold`);
  check("cancelling an unknown hold -> 404 HOLD_NOT_FOUND", stray.status === 404 && errorCode(stray) === "HOLD_NOT_FOUND", stray.body);

  console.log("\nAdmin endpoints");
  const noAuth = await call("GET", "/admin/metrics");
  if (noAuth.status === 404) {
    console.log("  INFO  /admin/* answers 404: ADMIN_TOKEN is not set on this deployment, so the admin API is disabled");
  } else {
    check("no token -> 401", noAuth.status === 401, noAuth.status);
    const wrong = await call("GET", "/admin/metrics", undefined, { authorization: "Bearer definitely-wrong" });
    check("wrong token -> 401", wrong.status === 401, wrong.status);
  }
  if (!ADMIN_TOKEN) {
    console.log("  SKIP  authenticated admin checks (set ADMIN_TOKEN to run them)");
  } else {
    const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };
    const metrics = await call("GET", "/admin/metrics", undefined, auth);
    const counters = metrics.body.counters as Record<string, number> | undefined;
    check("metrics with token -> 200 with counters and locking mode", metrics.status === 200 && counters !== undefined && typeof metrics.body.inventory_locking === "string", metrics.body);
    check("metrics saw this run's traffic (OVERSOLD / webhooks)", Object.keys(counters ?? {}).some((k) => k.startsWith("webhooks_total")) && Object.keys(counters ?? {}).some((k) => k.startsWith("api_errors_total")));

    const audit = await call("GET", `/admin/audit?order_id=${orderP}`, undefined, auth);
    const changes = (audit.body.state_changes as Array<{ action: string; detail: Record<string, unknown> }> | undefined) ?? [];
    check("audit for the partial+full refund order -> 200", audit.status === 200, audit.body);
    check("audit lists order_created then two refund_applied", changes.map((c) => c.action).join(",") === "order_created,refund_applied,refund_applied", changes.map((c) => c.action));
    check("audit marks inventory_released only on the final refund", changes[1]?.detail.inventory_released === false && changes[2]?.detail.inventory_released === true);
    const deliveries = (audit.body.webhook_deliveries as unknown[] | undefined) ?? [];
    check("duplicate delivery stored once (paid + partial + over-refund + full = 4)", deliveries.length === 4, deliveries.length);

    const ooo = await call("GET", `/admin/audit?order_id=${orderO}`, undefined, auth);
    const oooActions = ((ooo.body.state_changes as Array<{ action: string }> | undefined) ?? []).map((c) => c.action).join(",");
    check("out-of-order audit: refund_parked, order_created, refund_applied", oooActions === "refund_parked,order_created,refund_applied", oooActions);

    const missing = await call("GET", `/admin/audit?order_id=ord_none_${RUN}`, undefined, auth);
    check("unknown order -> 404 ORDER_NOT_FOUND", missing.status === 404 && errorCode(missing) === "ORDER_NOT_FOUND", missing.body);
  }

  console.log("\nCleanup (cancel my holds, fully refund my remaining orders)");
  await Promise.all(myHolds.map((id) => call("POST", `/orders/${id}/cancel-hold`)));
  await wh(refund(orderA, 8500));
  await wh(refund(orderB, 3000));
  const end = {
    a: await available("evt_001", "tier_001_a"),
    b: await available("evt_001", "tier_001_b"),
    c: await available("evt_001", "tier_001_c"),
    sa: await available("evt_002", "tier_002_a"),
    sb: await available("evt_002", "tier_002_b"),
  };
  check("inventory is back to the starting levels", JSON.stringify(end) === JSON.stringify(start), { start, end });

  console.log(failures === 0 ? "\nSMOKE TEST PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
