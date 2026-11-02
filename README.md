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
| `GET /admin/audit?order_id=` | *Stretch.* Every state change for an order, the hold it consumed, and every webhook received. Needs `Authorization: Bearer $ADMIN_TOKEN` |
| `GET /admin/metrics` | *Stretch.* In-memory counters (requests, errors by code, webhook outcomes, tx retries). Same auth. |

Errors always look like `{ "error": { "code": "OVERSOLD", "message": "...", "details": { ... }, "request_id": "..." } }`.
Codes: `VALIDATION_ERROR`(400) `INVALID_JSON`(400) `UNAUTHORIZED`(401) `EVENT_NOT_FOUND`/`TIER_NOT_FOUND`/`HOLD_NOT_FOUND`/`ORDER_NOT_FOUND`/`NOT_FOUND`(404)
`OVERSOLD`/`HOLD_NOT_ACTIVE`(409) `PAYMENT_MISMATCH`(422) `RATE_LIMITED`(429, with `Retry-After`) `CONTENTION`(503, lock-free mode only)
`INTERNAL_ERROR`(500, no stack trace leaked). Every response carries an `x-request-id` header (an incoming one is honored).

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
| `order_audit` | *Stretch.* Append-only `bigserial` log: `order_id`, `at`, `action`, `event_id`, `detail jsonb`. Written in the **same transaction** as each state change. No FK to `orders` on purpose (a refund can be parked before its order exists). |

Indexes (all partial, sized to the hot queries):
- `holds_active_idx (tier_id, created_at, id) WHERE status='active'` — availability sum + oldest-hold matching
- `orders_sold_idx (tier_id) WHERE status IN (paid, partially_refunded) AND NOT needs_manual_refund` — availability sum
- `webhook_events_pending_idx (order_id, occurred_at) WHERE processed_at IS NULL` — finds parked refunds
- `tiers_event_id_idx (event_id)`
- `order_audit_order_idx (order_id, id)`

## Design decisions

**No oversell (concurrency).** `POST holds` runs in one transaction that first does
`SELECT … FROM tiers WHERE id = $1 FOR UPDATE`, then computes availability and inserts. Concurrent
holds on the same tier queue on that row lock, so check-then-insert can't interleave; different tiers
never block each other. The webhook paid path takes the *same* tier lock, so a payment and a hold can't
race either. This is the **default** (`INVENTORY_LOCKING=tier-lock`) because it is easy to reason about and extend
(the paid path needs several statements under the same guarantee) and never retries. Cost: hold creation for one
hot tier is serialized, which is fine at this scale (each critical section is a few ms).

**Lock-free alternative (stretch, opt-in: `INVENTORY_LOCKING=serializable`).** A bare
`INSERT … SELECT … WHERE available >= n RETURNING` is **not safe** under Postgres's default READ COMMITTED: two concurrent
statements cannot see each other's uncommitted rows, so both pass the check and you oversell. The only correct lock-free
version runs that single statement in a `SERIALIZABLE` transaction: Postgres aborts one of two conflicting transactions
(SQLSTATE `40001`) and `withTransaction` retries it (jittered backoff, up to 15 attempts); the retry sees the winner's
hold, inserts zero rows, and the caller gets `OVERSOLD`. In this mode the webhook transaction is also `SERIALIZABLE`
(so hold-vs-payment races stay covered); if retries are ever exhausted the API answers `503 CONTENTION`, never a wrong count.
*Measured* (local server → Neon, the 40-concurrent-holds-on-20-seats demo): both modes sold exactly 20 and rejected the
rest with `OVERSOLD`; serializable mode needed **50 retried transactions** (`db_tx_retries_total`) where tier-lock needs 0.
So lock-free is correct but pays for it in retries under contention, which is why it is not the default.

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
npm test                    # unit + DB-backed tests (node:test); ~2-3 min against a remote Neon DB
```

`npm run demo` and `npm test` **truncate** `holds`, `orders`, `webhook_events` and `order_audit` in the target DB. Point the
demo at the deployed API with `BASE_URL=https://<deployment> npm run demo` (it still needs `DATABASE_URL` for resets and
state assertions). If you already ran `db:migrate` before the audit stretch goal, run it again: it only adds `order_audit`.

**Upgrading an existing deployment?** Run `npm run db:migrate` against the database that deployment uses *before* (or right after)
deploying new code. The schema is idempotent, and newer code needs newer tables (`order_audit`): without it every webhook that
changes an order returns a 500 (the transaction rolls back, so no data is corrupted, but nothing is processed).

**Smoke test against any deployment (no database access needed):**

```bash
BASE_URL=https://encore-ticket-mu.vercel.app npm run smoke
ADMIN_TOKEN=... BASE_URL=https://encore-ticket-mu.vercel.app npm run smoke   # also checks /admin/*
```

It runs Scenarios A, B and C, out-of-order and partial/full refunds, the error cases and (with a token) the admin metrics and audit,
using unique ids, then cancels its holds and refunds its orders so inventory returns to where it started. It assumes nobody else is
using the same tiers while it runs. Unlike `npm run demo`, it does not truncate anything.

Optional environment variables (see `.env.example`):

| Variable | Default | Effect |
|---|---|---|
| `INVENTORY_LOCKING` | `tier-lock` | `serializable` switches to the lock-free hold + serializable webhook transactions |
| `HOLDS_RATE_LIMIT_PER_MIN` | `120` | Per-client limit on `POST …/holds` (`0` disables). 429 + `Retry-After` when exceeded |
| `ADMIN_TOKEN` | unset | Enables `/admin/*` (Bearer auth). Unset = those routes return 404 |

Windows note: if your network has no IPv6 route, Node may fail to resolve the Neon host (`ENOTFOUND`). Locally I worked
around it with a preload: `$env:NODE_OPTIONS = "--require ./scripts/ipv4-dns.cjs"`. Not needed on Vercel.

## Frontend console (optional extra)

The assignment says no UI is needed; this is an optional console to *see* the lifecycle. It is a thin client over the
existing endpoints and changes nothing in the backend. Same Next.js app, same deployment: open `/`.

| Page | What it does (all via the real API) |
|---|---|
| `/` Dashboard | Inventory totals from `GET /events/:id`; session-only counters (see limits below) |
| `/events` | Tiers, prices, total and available inventory per event |
| `/reserve` | `POST /events/:id/holds`, live countdown, `POST /orders/:hold_id/cancel-hold`, "simulate payment" on a hold |
| `/simulator` | `order.paid` / `order.refunded` webhooks (new `event_id` each send; **re-send exact payload** to prove idempotency; full vs partial refund) |
| `/activity` | Every request: method, path, status, timing, request/response JSON, copy-to-clipboard |
| `/ops` Admin → Overview | `GET /admin/metrics`: requests, error responses, errors by code, webhook outcomes, holds by tier, transaction retries; refresh + optional 10s auto-refresh |
| `/ops/audit` Admin → Order audit | `GET /admin/audit?order_id=`: order summary, a chronological timeline (hold, payment, refund, inventory release, parked/ignored events, each with timestamp, event id and metadata) and the webhook deliveries |
| `/ops/monitoring` Admin → System monitoring | Live probes of the public and admin APIs (real latency, from the browser), instance info and operational signals from the metrics, capacity from `GET /events/:id`, plus an explicit list of what the APIs cannot tell us |

**Admin access.** The admin pages ask for the server's `ADMIN_TOKEN` and verify it against `/admin/metrics` before accepting it.
The token lives in React state only: never in `localStorage`/`sessionStorage`/cookies, never in the activity log, lost on reload;
"Clear token" locks every admin page. A 401 (also mid-session) clears the token and says so; a 404 explains that `ADMIN_TOKEN`
is not configured on the server. The pages live under `/ops` because `/admin/*` is owned by the API route handlers (a page and a
route handler cannot share a path). Nothing in the backend changed for this.

Code layout: `src/lib/api-client.ts` (fetch, never throws) · `src/lib/api-context.tsx` (activity log + session state) ·
`src/lib/use-webhooks.ts` (payload builders) · `src/components/*` (UI) · `app/(dashboard)/*` (pages).
Tailwind v4 + lucide-react; no other new dependencies.

Config (both public, no secrets): `NEXT_PUBLIC_API_BASE_URL` (empty = same origin; another origin needs CORS) and
`NEXT_PUBLIC_EVENT_IDS` (default `evt_001,evt_002`).

Honest limits, imposed by what the API exposes:
- There is **no list-events endpoint**, so event ids come from `NEXT_PUBLIC_EVENT_IDS`.
- There is **no endpoint that lists holds or orders**, so "Active holds", "Paid orders" and "Fully refunded" on the dashboard are
  labelled *this session* and count only actions taken in that browser tab (reset on reload). No global figure is invented.
  "Held or sold" is `total − available`; the API does not split the two.
- Full refund in the UI is `order total − refunds the API confirmed` and is only known for orders paid from this UI;
  for any other order id you type the amount yourself.
- Hold countdowns use the browser clock for display; the server alone decides expiry.

## Verification — what was actually run

`npm run demo` against a real Neon Postgres, run twice: against the local Next dev server and against the
**deployed Vercel API** (`BASE_URL=https://encore-ticket-mu.vercel.app`): **49/49 checks passed both times** (Scenarios A, B, C,
refund-before-paid, partial/full refund, duplicate/over-refund, payment after expiry, error responses), including
5 concurrent identical webhook deliveries (one order) and 40 concurrent single-ticket holds on 20 seats (exactly 20 succeed).
`tsc --noEmit` (strict + `noUncheckedIndexedAccess`) and `next build` are clean.

The frontend was driven end to end in a real browser (Microsoft Edge via Playwright) against a local production build
(`next build && next start`) talking to the real Neon database: dashboard stats, create hold + countdown, pay, cancel,
OVERSOLD error, payment duplicate re-send, 422 mismatch, partial/full refund, refund-before-paid, activity console and the
mobile layout — all behaved as the API specifies. That browser script is not checked into the repo, and the frontend has
**not** been re-tested against the Vercel deployment.

**Stretch goals** (added after the core was done and verified; the core demo was re-run after each):
- **Admin UI** (`/ops/*`) was driven in a real browser (Edge via Playwright, 45 checks, run 3 times in a row, all green) against a local
  production build and the real Neon database with real seeded data: token gate (wrong token → 401 message, correct token → unlock,
  mid-session 401 → signed out, server without `ADMIN_TOKEN` → 404 message), live metrics, the audit timeline (including a refund that
  arrived before its payment), the monitoring probes, "token never in storage / activity log / after reload", and no horizontal
  overflow at 390 px. That browser script is not in the repo. Not yet run against the Vercel deployment.
- **Tests** (`npm test`, `node:test`): 36 tests in total. 13 are pure (metrics parsing/aggregation, the audit-timeline builder).
  The other 23: validation schemas, rate limiter, and DB-backed webhook tests (duplicate event,
  6 concurrent identical deliveries, re-emitted order, conflicting paid, rollback on mismatch, refund-before-paid, partial/full,
  duplicate/over-refund, payment after expiry, audit trail) plus concurrent-hold tests. All 23 passed in `tier-lock` mode and
  in `serializable` mode (one run in serializable mode lost a test to an intermittent local DNS failure; that test passed on re-run).
- **Lock-free hold**: see the design section. Same demo (49 checks) passes in both modes.
- **Rate limit** verified over HTTP with the limit set to 3: requests 1-3 → 201, 4-5 → 429 with `Retry-After` and a structured body;
  a different client IP was unaffected; `GET` was not limited.
- **Audit + metrics + request ids**: verified over HTTP (401 without/with a wrong token, 404 for an unknown order, audit trail for a
  paid → partial refund → full refund order showing `inventory_released`, `x-request-id` echoed/generated and present in error bodies).

Not verified / not done — stated plainly:
- **Live deployment:** `npm run smoke` against https://encore-ticket-mu.vercel.app passed every public-API check (scenarios A/B/C,
  out-of-order, partial/full refunds, error cases, request id, admin endpoints answering 401 without a token) and left inventory
  unchanged. The first live run exposed a real deployment problem (the live database lacked the `order_audit` table, so webhooks
  returned 500 until the migration was applied there), which is why the upgrade note above exists. The authenticated `/admin/*`
  checks and the admin UI pages have not been exercised on the live site by me; `/admin/*` there needs `ADMIN_TOKEN` set in Vercel.
- **Rate limit and metrics are per server instance** (in-memory). On serverless each instance counts separately and resets on cold
  start, so the limit blunts one abusive client but is not a global guarantee. Production answer: a shared store (Redis/Upstash).
- Metrics are a simple in-process counter endpoint, not Prometheus/OpenTelemetry. Logs are JSON lines on stdout.
- Serializable mode was exercised with 40 concurrent requests from one machine, not a real load test; its retry cost grows with contention.
- Tests run against a real remote database and are slow (network round trips), and they wipe that database's holds/orders/webhooks.
- No webhook signature verification — a real processor integration must verify signatures before trusting payloads.
- Holds are anonymous (no user/session), as the assignment specifies none.

## What I'd do with another day
- Webhook signature verification + dead-letter table for permanently invalid events.
- Pass a hold id through the processor's metadata instead of matching by tier/quantity.
- Shared rate-limit/metrics store; export metrics via OpenTelemetry.
- Per-user caps on outstanding holds (hold-hoarding is a real abuse vector).
- A real load test (k6) comparing `tier-lock` vs `serializable` at higher concurrency, and a periodic expired-hold sweep.
