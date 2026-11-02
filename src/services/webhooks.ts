import type { PoolClient } from "pg";
import { withTransaction } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  webhookSchema,
  type PaidPayload,
  type RefundPayload,
  type WebhookPayload,
} from "@/lib/validation";
import { inventoryTransactionOptions } from "@/lib/settings";
import { availableForTier } from "./inventory";

export interface WebhookResult {
  status: "processed" | "duplicate" | "pending";
  outcome: string;
}

interface OrderRow {
  id: string;
  tier_id: string;
  quantity: number;
  status: "paid" | "refunded" | "partially_refunded";
  amount_total: number;
  amount_refunded: number;
  currency: string;
}

function log(level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown>): void {
  console[level === "info" ? "log" : level](JSON.stringify({ level, msg, ...extra }));
}

/** Appends to order_audit inside the caller's transaction, so audit and state change commit together. */
async function audit(
  client: PoolClient,
  orderId: string,
  action: string,
  eventId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await client.query("INSERT INTO order_audit (order_id, action, event_id, detail) VALUES ($1, $2, $3, $4::jsonb)", [
    orderId,
    action,
    eventId,
    JSON.stringify(detail),
  ]);
}

/**
 * One transaction per delivery:
 *   1. advisory lock on the order id  -> paid/refund events for one order are serialized
 *   2. INSERT webhook_events ON CONFLICT DO NOTHING  -> idempotency gate (event_id is the key)
 *   3. apply the state change
 * If anything throws, the transaction (including the dedupe row) rolls back and the caller
 * returns non-2xx, so the processor retries and the event is processed from scratch.
 * A 2xx therefore means "fully applied, or durably parked", never "maybe".
 */
export async function processWebhook(p: WebhookPayload): Promise<WebhookResult> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`order:${p.order_id}`]);

    const inserted = await client.query(
      `INSERT INTO webhook_events (id, event_type, order_id, payload, occurred_at)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [p.event_id, p.type, p.order_id, JSON.stringify(p), p.occurred_at],
    );

    if (inserted.rowCount === 0) {
      const same = await client.query<{ same: boolean }>(
        "SELECT (payload = $2::jsonb) AS same FROM webhook_events WHERE id = $1",
        [p.event_id, JSON.stringify(p)],
      );
      if (same.rows[0]?.same === false) {
        log("warn", "event_id reused with different payload; first delivery wins", { event_id: p.event_id });
        return { status: "duplicate", outcome: "duplicate_payload_mismatch" };
      }
      return { status: "duplicate", outcome: "duplicate" };
    }

    if (p.type === "order.paid") {
      const outcome = await applyPaid(client, p);
      await markProcessed(client, p.event_id, outcome);
      await replayParkedRefunds(client, p.order_id, p.event_id);
      return { status: "processed", outcome };
    }

    const order = await lockOrder(client, p.order_id);
    if (!order) {
      // Refund beat the payment. Keep the event durably (processed_at stays NULL) and ack:
      // it is applied when the matching order.paid arrives.
      await client.query("UPDATE webhook_events SET outcome = 'parked_until_paid' WHERE id = $1", [p.event_id]);
      await audit(client, p.order_id, "refund_parked", p.event_id, { amount_refunded: p.amount_refunded });
      return { status: "pending", outcome: "parked_until_paid" };
    }
    const outcome = await applyRefund(client, order, p);
    await markProcessed(client, p.event_id, outcome);
    return { status: "processed", outcome };
  }, inventoryTransactionOptions());
}

async function lockOrder(client: PoolClient, orderId: string): Promise<OrderRow | undefined> {
  const { rows } = await client.query<OrderRow>(
    `SELECT id, tier_id, quantity, status, amount_total, amount_refunded, currency
       FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId],
  );
  return rows[0];
}

async function markProcessed(client: PoolClient, eventId: string, outcome: string): Promise<void> {
  await client.query("UPDATE webhook_events SET processed_at = now(), outcome = $2 WHERE id = $1", [
    eventId,
    outcome,
  ]);
}

async function applyPaid(client: PoolClient, p: PaidPayload): Promise<string> {
  const existing = await lockOrder(client, p.order_id);
  if (existing) {
    // Same order, different event_id (e.g. processor re-emitted it). Never double-deduct.
    const same =
      existing.tier_id === p.tier_id &&
      existing.quantity === p.quantity &&
      existing.amount_total === p.amount_total &&
      existing.currency.trim() === p.currency;
    if (!same) {
      log("error", "conflicting order.paid for existing order; ignored", { order_id: p.order_id, event_id: p.event_id });
      await audit(client, p.order_id, "paid_conflict_ignored", p.event_id, {
        received: { tier_id: p.tier_id, quantity: p.quantity, amount_total: p.amount_total, currency: p.currency },
      });
      return "conflicting_paid_ignored";
    }
    return "order_already_exists";
  }

  // Same lock as createHold: serializes against concurrent holds on this tier.
  const tier = await client.query<{ price: number; currency: string }>(
    "SELECT price, currency FROM tiers WHERE id = $1 FOR UPDATE",
    [p.tier_id],
  );
  const t = tier.rows[0];
  if (!t) throw new AppError(422, "TIER_NOT_FOUND", `Tier ${p.tier_id} not found`);
  if (t.currency.trim() !== p.currency || t.price * p.quantity !== p.amount_total) {
    throw new AppError(422, "PAYMENT_MISMATCH", "amount_total/currency does not match tier price", {
      expected: { amount_total: t.price * p.quantity, currency: t.currency.trim() },
      received: { amount_total: p.amount_total, currency: p.currency },
    });
  }

  // Deterministic hold matching (payload carries no hold reference): the oldest active,
  // unexpired hold for the same tier and quantity; ties broken by id.
  const hold = await client.query<{ id: string }>(
    `SELECT id FROM holds
      WHERE tier_id = $1 AND quantity = $2 AND status = 'active' AND expires_at > clock_timestamp()
      ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    [p.tier_id, p.quantity],
  );
  const holdId = hold.rows[0]?.id ?? null;

  let needsManualRefund = false;
  let outcome = "paid_from_hold";
  if (holdId) {
    // Hold inventory is handed over to the order: net availability is unchanged.
    await client.query("UPDATE holds SET status = 'converted' WHERE id = $1", [holdId]);
  } else {
    // Paid after expiry (or no matching hold): honor it only if stock is still free.
    const available = await availableForTier(client, p.tier_id);
    if (available >= p.quantity) {
      outcome = "paid_without_hold";
    } else {
      needsManualRefund = true;
      outcome = "paid_no_inventory_needs_manual_refund";
      log("error", "payment received but no inventory; flagged for manual refund", {
        order_id: p.order_id,
        tier_id: p.tier_id,
        quantity: p.quantity,
      });
    }
  }

  await client.query(
    `INSERT INTO orders (id, tier_id, quantity, status, amount_total, currency, hold_id, needs_manual_refund)
     VALUES ($1, $2, $3, 'paid', $4, $5, $6, $7)`,
    [p.order_id, p.tier_id, p.quantity, p.amount_total, p.currency, holdId, needsManualRefund],
  );
  await audit(client, p.order_id, "order_created", p.event_id, {
    outcome,
    status: "paid",
    tier_id: p.tier_id,
    quantity: p.quantity,
    amount_total: p.amount_total,
    currency: p.currency,
    hold_id: holdId,
    needs_manual_refund: needsManualRefund,
  });
  return outcome;
}

/** Only a full refund ('refunded') stops the order counting as sold, releasing all its tickets. */
async function applyRefund(
  client: PoolClient,
  order: OrderRow,
  p: RefundPayload,
  replayedFromParked = false,
): Promise<string> {
  const ignored = async (reason: string): Promise<string> => {
    await audit(client, order.id, "refund_ignored", p.event_id, {
      reason,
      amount_refunded: p.amount_refunded,
      status: order.status,
      replayed_from_parked: replayedFromParked,
    });
    return reason;
  };

  if (order.currency.trim() !== p.currency) {
    log("error", "refund currency mismatch; ignored", { order_id: order.id, event_id: p.event_id });
    return ignored("refund_currency_mismatch_ignored");
  }
  if (order.status === "refunded") return ignored("already_refunded");

  // amount_refunded is treated as the amount of THIS refund (summed across events).
  // Duplicate deliveries never reach here (webhook_events gate), so a refund is summed once.
  const total = order.amount_refunded + p.amount_refunded;
  if (total > order.amount_total) {
    // Cumulative refunds may never exceed the order amount: apply nothing, flag loudly.
    // Still 2xx: retrying the same event cannot make it valid.
    log("error", "refund would exceed order amount; ignored", {
      order_id: order.id,
      event_id: p.event_id,
      already_refunded: order.amount_refunded,
      amount_refunded: p.amount_refunded,
      amount_total: order.amount_total,
    });
    return ignored("refund_exceeds_order_ignored");
  }
  const status = total === order.amount_total ? "refunded" : "partially_refunded";
  await client.query(
    `UPDATE orders
        SET status = $2, amount_refunded = $3,
            needs_manual_refund = CASE WHEN $2 = 'refunded' THEN false ELSE needs_manual_refund END,
            updated_at = now()
      WHERE id = $1`,
    [order.id, status, total],
  );
  await audit(client, order.id, "refund_applied", p.event_id, {
    status_before: order.status,
    status_after: status,
    amount_refunded: p.amount_refunded,
    cumulative_refunded: total,
    amount_total: order.amount_total,
    inventory_released: status === "refunded",
    replayed_from_parked: replayedFromParked,
  });
  return status;
}

async function replayParkedRefunds(client: PoolClient, orderId: string, currentEventId: string): Promise<void> {
  const { rows } = await client.query<{ id: string; payload: unknown }>(
    `SELECT id, payload FROM webhook_events
      WHERE order_id = $1 AND event_type = 'order.refunded' AND processed_at IS NULL AND id <> $2
      ORDER BY occurred_at, id FOR UPDATE`,
    [orderId, currentEventId],
  );
  for (const row of rows) {
    const parsed = webhookSchema.parse(row.payload);
    if (parsed.type !== "order.refunded") continue;
    const order = await lockOrder(client, orderId);
    if (!order) throw new Error("order vanished while replaying parked refunds");
    const outcome = await applyRefund(client, order, parsed, true);
    await markProcessed(client, row.id, `${outcome}_after_parked`);
  }
}
