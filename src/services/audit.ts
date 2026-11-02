import { getPool } from "@/lib/db";
import { AppError } from "@/lib/errors";

export interface AuditEntry {
  at: Date;
  action: string;
  event_id: string | null;
  detail: Record<string, unknown>;
}

export interface OrderAudit {
  order_id: string;
  order: Record<string, unknown> | null;
  hold: Record<string, unknown> | null;
  state_changes: AuditEntry[];
  webhook_deliveries: Array<{
    event_id: string;
    event_type: string;
    occurred_at: Date;
    received_at: Date;
    processed_at: Date | null;
    outcome: string | null;
    payload: unknown;
  }>;
}

/**
 * Everything known about one order id: its current row, the hold it consumed, every state change
 * (order_audit, written in the same transaction as the change) and every distinct webhook received
 * (webhook_events). Duplicate deliveries are not stored twice, by design (idempotency).
 */
export async function getOrderAudit(orderId: string): Promise<OrderAudit> {
  const pool = getPool();

  const [order, changes, deliveries] = await Promise.all([
    pool.query<Record<string, unknown> & { hold_id: string | null }>(
      `SELECT id, tier_id, quantity, status, amount_total, amount_refunded, currency, hold_id,
              needs_manual_refund, created_at, updated_at
         FROM orders WHERE id = $1`,
      [orderId],
    ),
    pool.query<AuditEntry>(
      "SELECT at, action, event_id, detail FROM order_audit WHERE order_id = $1 ORDER BY id",
      [orderId],
    ),
    pool.query<OrderAudit["webhook_deliveries"][number]>(
      `SELECT id AS event_id, event_type, occurred_at, received_at, processed_at, outcome, payload
         FROM webhook_events WHERE order_id = $1 ORDER BY received_at, id`,
      [orderId],
    ),
  ]);

  const orderRow = order.rows[0] ?? null;
  if (!orderRow && changes.rowCount === 0 && deliveries.rowCount === 0) {
    throw new AppError(404, "ORDER_NOT_FOUND", `No order or webhook activity found for ${orderId}`);
  }

  let hold: Record<string, unknown> | null = null;
  if (orderRow?.hold_id) {
    const h = await pool.query<Record<string, unknown>>(
      "SELECT id, tier_id, quantity, status, created_at, expires_at FROM holds WHERE id = $1",
      [orderRow.hold_id],
    );
    hold = h.rows[0] ?? null;
  }

  return {
    order_id: orderId,
    order: orderRow,
    hold,
    state_changes: changes.rows,
    webhook_deliveries: deliveries.rows,
  };
}
