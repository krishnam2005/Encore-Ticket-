# Encore Tickets — Inventory API

Real-time ticket inventory with safe checkout holds, plus an idempotent payment-webhook handler.
Next.js (App Router route handlers) · TypeScript strict · raw SQL via `pg` · Postgres (Neon) · Zod.

- **Live API:** https://encore-ticket-mu.vercel.app (e.g. `/events/evt_002`)
- **Loom:** _<fill in>_

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /events/:event_id` | Event + tiers, each with `available = total − active holds − sold orders` |
| `POST /events/:event_id/holds` | Body `{ "tier_id", "quantity" }` → `201 { hold_id, expires_at, ... }`; `409 OVERSOLD` if not enough stock |
| `POST /orders/:order_id/cancel-hold` | Test helper: expires an active hold. The assignment names the path param `:order_id`; it takes the **hold id** returned by the holds endpoint (no order exists yet at hold time). |
| `POST /webhooks/payments` | `order.paid` / `order.refunded`. 2xx = fully applied or durably parked; non-2xx = processor should retry |

Errors always look like `{ "error": { "code": "OVERSOLD", "message": "...", "details": { ... } } }`.
Codes: `VALIDATION_ERROR`(400) `INVALID_JSON`(400) `EVENT_NOT_FOUND`/`TIER_NOT_FOUND`/`HOLD_NOT_FOUND`(404)
`OVERSOLD`/`HOLD_NOT_ACTIVE`(409) `PAYMENT_MISMATCH`(422) `INTERNAL_ERROR`(500, no stack trace leaked).

## Schema

Source of truth: [db/schema.sql](db/schema.sql) (idempotent) and [db/seed.sql](db/seed.sql).

```
events 1───* tiers 1───* holds
                 │          │ 0..1
                 └───* orders ◄──(hold_id, UNIQUE)
webhook_events   (standalone; order_id is a plain text key, NOT an FK: a refund can arrive before its order exists)
```

| Table | Notable columns / constraints |
|---|---|
| `events` | `id` text PK, `title`, `venue`, `starts_at timestamptz` |
| `tiers` | FK `event_id`; `price integer CHECK >= 0` (minor units); `currency char(3) CHECK ^[A-Z]{3}$`; `total_inventory CHECK >= 0`; `UNIQUE(event_id, name)` |
| `holds` | `id uuid`; FK `tier_id`; `quantity CHECK > 0`; `status CHECK IN (active, expired, converted)`; `CHECK expires_at > created_at` |
| `orders` | `id` = processor's order id (PK); FK `tier_id`; `status CHECK IN (paid, refunded, partially_refunded)`; `amount_total`, `amount_refunded` with `CHECK amount_refunded <= amount_total`; `hold_id` UNIQUE FK (NULL if paid after expiry); `needs_manual_refund boolean` |
| `webhook_events` | `id` = processor `event_id` (PK = idempotency key); `payload jsonb`; `processed_at` (NULL = parked refund waiting for its paid event); `outcome` text for audit |

Indexes (all partial, sized to the hot queries):
- `holds_active_idx (tier_id, created_at, id) WHERE status='active'` — availability sum + oldest-hold matching
- `orders_sold_idx (tier_id) WHERE status IN (paid, partially_refunded) AND NOT needs_manual_refund` — availability sum
- `webhook_events_pending_idx (order_id, occurred_at) WHERE processed_at IS NULL` — finds parked refunds
- `tiers_event_id_idx (event_id)`

## Design decisions

**No oversell (concurrency).** `POST holds` runs in one transaction that first does
`SELECT … FROM tiers WHERE id = $1 FOR UPDATE`, then computes availability and inserts. Concurrent
holds on the same tier queue on that row lock, so check-then-insert can't interleave; different tiers
never block each other. The webhook paid path takes the *same* tier lock, so a payment and a hold can't
race either. I chose this over the lockless `INSERT … SELECT … WHERE available >= n` because it is easier to
reason about and extend (the paid path needs several statements under the same guarantee). Cost: hold
creation for one hot tier is serialized, which is fine at this scale (each critical section is a few ms).

**Availability is derived, never stored.** `total − Σ active unexpired holds − Σ sold orders`. No counter
can drift out of sync with holds/orders. Sold = orders in `paid`/`partially_refunded` that aren't flagged
`needs_manual_refund`.

**Expiry: on-read, no cron.** Every availability query filters `status='active' AND expires_at > clock_timestamp()`,
so a hold stops counting the instant its 10 minutes pass. The `status` column is tidied lazily
(`createHold` flips stale rows for its tier), and `cancel-hold` flips explicitly.
*Trade-off:* `status='active'` can lag reality for expired-but-unswept rows (inventory math is never wrong,
but a naive `SELECT … WHERE status='active'` elsewhere would be). *Not chosen:* a cron/pg_cron sweep — extra
infrastructure, and it would still need the read-time filter to be exact. With a day more I'd add a daily
sweep purely for hygiene. `clock_timestamp()` is used instead of `now()` so a transaction that waited on a
lock doesn't see a stale clock.

**Webhook idempotency.** One transaction per delivery:
1. `pg_advisory_xact_lock(hashtext('order:'||order_id))` — serializes events for the same order (paid vs refund races).
2. `INSERT INTO webhook_events … ON CONFLICT (id) DO NOTHING`. Zero rows inserted ⇒ duplicate ⇒ 200 `duplicate`, no work.
   A concurrent duplicate blocks on the unique index until the first commits, then sees the conflict.
3. Apply the state change. Any exception rolls back everything **including the dedupe row**, and the handler returns non-2xx,
   so the retry is processed from scratch. A 2xx therefore never means "maybe".
`orders.id` (processor order id) as PK is a second net: the same order re-emitted under a *new* `event_id` is a no-op,
and a *conflicting* paid (different tier/qty/amount) for an existing order is ignored and logged, not applied.
An `event_id` re-used with a different payload: first delivery wins, a warning is logged.

**Linking a payment to a hold (assumption).** The `order.paid` payload carries no hold reference and I did not add one.
Matching is deterministic: the **oldest active, unexpired hold for the same `tier_id` + `quantity`**
(`ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`), converted to `converted`. *Limitation:* if two customers hold
the same tier and quantity, the payment consumes the oldest one, which may not be that customer's. Since the two are
interchangeable for inventory purposes the totals stay correct, but the other customer's hold could expire first. A real
integration should pass the hold id as processor metadata.

**Payment after hold expiry.** If no matching active hold exists: if stock is still available, the order is created
(`paid_without_hold`); otherwise the order is recorded with `needs_manual_refund = true`, does not consume inventory,
an error is logged, and we still return 200 (retrying can't create stock).

**Refunds.**
- *Full refund* (cumulative refunds == `amount_total`) → `refunded`; all tickets return to inventory.
- *Partial refund* → `partially_refunded`; **no inventory released**.
- **Assumption:** `amount_refunded` is the amount of *that single refund event*; events are summed. If the processor
  actually sends a cumulative total, this logic must change to "take the max".
- Duplicate deliveries never double-count (idempotency gate). A refund that would push the cumulative total above
  `amount_total` is not applied, logged and flagged `refund_exceeds_order_ignored` (2xx — retrying can't make it valid);
  the `CHECK (amount_refunded <= amount_total)` constraint backs this up in the database.

**Out-of-order (refund before paid).** The refund can't be applied (we don't know the order; the refund payload has no
tier/quantity), so it is stored in `webhook_events` with `processed_at = NULL` and acknowledged with 200 `pending`.
When the matching `order.paid` is processed, parked refunds for that order are replayed (in `occurred_at` order) in
the same transaction. Chosen over returning non-2xx because the processor's retry schedule is outside our control and
the data is already durable.

**Permanently invalid webhooks.** Malformed JSON/schema → 400. Unknown tier or amount/currency not matching the tier's
price → 422 and nothing is stored. These are non-2xx deliberately (they should be seen and alerted on), but note a
processor that retries forever on 4xx would keep retrying; in production I'd dead-letter these instead.

**Past events.** Holds are not rejected for events in the past — the assignment doesn't specify it and the
seeded `evt_002` date is in the past relative to today, which would break Scenario C.

## Run locally

Prereqs: Node 20+, a Postgres database (I used [Neon](https://neon.tech); use the *pooled* connection string).

```bash
npm install
cp .env.example .env        # set DATABASE_URL
npm run db:migrate          # applies db/schema.sql + db/seed.sql (idempotent)
npm run dev                 # http://localhost:3000
npm run demo                # in another terminal: runs all scenarios, exits non-zero on failure
```

`npm run demo` **truncates** `holds`, `orders` and `webhook_events` in the target DB. Point it at the deployed API with
`BASE_URL=https://<deployment> npm run demo` (it still needs `DATABASE_URL` for resets and state assertions).

Windows note: if your network has no IPv6 route, Node may fail to resolve the Neon host (`ENOTFOUND`). Locally I worked
around it with a preload: `$env:NODE_OPTIONS = "--require ./scripts/ipv4-dns.cjs"`. Not needed on Vercel.

## Verification — what was actually run

`npm run demo` against a real Neon Postgres, run twice: against the local Next dev server and against the
**deployed Vercel API** (`BASE_URL=https://encore-ticket-mu.vercel.app`): **49/49 checks passed both times** (Scenarios A, B, C,
refund-before-paid, partial/full refund, duplicate/over-refund, payment after expiry, error responses), including
5 concurrent identical webhook deliveries (one order) and 40 concurrent single-ticket holds on 20 seats (exactly 20 succeed).
`tsc --noEmit` (strict + `noUncheckedIndexedAccess`) and `next build` are clean.

Not verified / not done — stated plainly:
- There are no unit tests; the integration script is the only test suite.
- Concurrency was tested with up to 40 parallel requests from one client, not a load test.
- Not implemented (stretch goals): rate limiting, `/admin/audit`, request ids/metrics. Only JSON-line `console` logs exist.
- No webhook signature verification — a real processor integration must verify signatures before trusting payloads.
- Holds are anonymous (no user/session), as the assignment specifies none.

## What I'd do with another day
- Webhook signature verification + dead-letter table for permanently invalid events.
- Pass a hold id through the processor's metadata instead of matching by tier/quantity.
- `/admin/audit?order_id=` from `webhook_events.outcome` + an `order_events` table.
- Rate limit on the holds endpoint; per-user caps on outstanding holds (hold-hoarding is a real abuse vector).
- Unit tests for the webhook state machine, a k6 load test for the tier lock, and a periodic expired-hold sweep.
