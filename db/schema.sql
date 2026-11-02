-- Encore Tickets inventory schema. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS events (
  id         text PRIMARY KEY,
  title      text        NOT NULL,
  venue      text        NOT NULL,
  starts_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS tiers (
  id              text PRIMARY KEY,
  event_id        text    NOT NULL REFERENCES events (id),
  name            text    NOT NULL,
  price           integer NOT NULL CHECK (price >= 0),           -- minor units (cents)
  currency        char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), -- ISO 4217
  total_inventory integer NOT NULL CHECK (total_inventory >= 0),
  UNIQUE (event_id, name)
);
CREATE INDEX IF NOT EXISTS tiers_event_id_idx ON tiers (event_id);

CREATE TABLE IF NOT EXISTS holds (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id    text        NOT NULL REFERENCES tiers (id),
  quantity   integer     NOT NULL CHECK (quantity > 0),
  status     text        NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'expired', 'converted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
-- Serves the availability sum and the webhook hold-matching query.
CREATE INDEX IF NOT EXISTS holds_active_idx
  ON holds (tier_id, created_at, id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS orders (
  id                  text PRIMARY KEY,                           -- processor's order id
  tier_id             text        NOT NULL REFERENCES tiers (id),
  quantity            integer     NOT NULL CHECK (quantity > 0),
  status              text        NOT NULL DEFAULT 'paid'
                      CHECK (status IN ('paid', 'refunded', 'partially_refunded')),
  amount_total        integer     NOT NULL CHECK (amount_total >= 0),
  amount_refunded     integer     NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  currency            char(3)     NOT NULL,
  hold_id             uuid UNIQUE REFERENCES holds (id),          -- NULL if paid after hold expiry
  needs_manual_refund boolean     NOT NULL DEFAULT false,         -- paid but no inventory left
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_refunded <= amount_total)
);
-- Serves the "sold" sum in availability.
CREATE INDEX IF NOT EXISTS orders_sold_idx
  ON orders (tier_id) WHERE status IN ('paid', 'partially_refunded') AND NOT needs_manual_refund;

CREATE TABLE IF NOT EXISTS webhook_events (
  id          text PRIMARY KEY,                                   -- processor's event_id = idempotency key
  event_type  text        NOT NULL,
  order_id    text        NOT NULL,
  payload     jsonb       NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,                                       -- NULL = parked (refund before paid)
  outcome     text
);
-- Finds parked refunds when the paid event finally arrives.
CREATE INDEX IF NOT EXISTS webhook_events_pending_idx
  ON webhook_events (order_id, occurred_at) WHERE processed_at IS NULL;
