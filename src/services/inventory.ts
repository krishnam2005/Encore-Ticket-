import type { Pool, PoolClient } from "pg";
import { AppError } from "@/lib/errors";

type Queryable = Pick<Pool | PoolClient, "query">;

export interface EventRow {
  id: string;
  title: string;
  venue: string;
  starts_at: Date;
}

export interface TierRow {
  id: string;
  event_id: string;
  name: string;
  price: number;
  currency: string;
  total_inventory: number;
}

export interface TierWithAvailability extends TierRow {
  available: number;
}

/**
 * available = total - active (unexpired) holds - sold orders.
 * Derived on every read, so there is no counter that can drift.
 * Orders flagged needs_manual_refund do not consume inventory (they will be refunded).
 * clock_timestamp() (not now()) so holds expire the moment their TTL passes, even
 * inside a transaction that waited on a lock.
 */
const AVAILABLE_EXPR = `
  t.total_inventory
  - COALESCE((SELECT SUM(h.quantity) FROM holds h
              WHERE h.tier_id = t.id AND h.status = 'active' AND h.expires_at > clock_timestamp()), 0)::int
  - COALESCE((SELECT SUM(o.quantity) FROM orders o
              WHERE o.tier_id = t.id AND o.status IN ('paid', 'partially_refunded')
                AND NOT o.needs_manual_refund), 0)::int`;

/** Unclamped availability for one tier. Call while holding the tier row lock. */
export async function availableForTier(db: Queryable, tierId: string): Promise<number> {
  const { rows } = await db.query<{ available: number }>(
    `SELECT (${AVAILABLE_EXPR}) AS available FROM tiers t WHERE t.id = $1`,
    [tierId],
  );
  const row = rows[0];
  if (!row) throw new AppError(404, "TIER_NOT_FOUND", `Tier ${tierId} not found`);
  return row.available;
}

export async function getEventWithAvailability(
  db: Queryable,
  eventId: string,
): Promise<{ event: EventRow; tiers: TierWithAvailability[] }> {
  const ev = await db.query<EventRow>("SELECT id, title, venue, starts_at FROM events WHERE id = $1", [eventId]);
  const event = ev.rows[0];
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", `Event ${eventId} not found`);

  const { rows } = await db.query<TierWithAvailability>(
    `SELECT t.id, t.event_id, t.name, t.price, t.currency, t.total_inventory,
            GREATEST(0, ${AVAILABLE_EXPR}) AS available
       FROM tiers t WHERE t.event_id = $1 ORDER BY t.id`,
    [eventId],
  );
  return { event, tiers: rows };
}
