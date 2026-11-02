import type { PoolClient } from "pg";
import { isRetryableError, withTransaction, getPool } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { inventoryLocking } from "@/lib/settings";
import { AVAILABLE_EXPR, availableForTier } from "./inventory";

export const HOLD_TTL_MINUTES = 10;

export interface HoldRow {
  id: string;
  tier_id: string;
  quantity: number;
  status: "active" | "expired" | "converted";
  created_at: Date;
  expires_at: Date;
}

function oversold(tierId: string, requested: number, available: number): AppError {
  return new AppError(409, "OVERSOLD", "Not enough tickets available for the requested quantity", {
    tier_id: tierId,
    requested,
    available: Math.max(0, available),
  });
}

export async function createHold(eventId: string, tierId: string, quantity: number): Promise<HoldRow> {
  return inventoryLocking() === "serializable"
    ? createHoldSerializable(eventId, tierId, quantity)
    : createHoldWithTierLock(eventId, tierId, quantity);
}

/**
 * Lock-free variant: one atomic `INSERT ... SELECT ... WHERE available >= n RETURNING`, run under
 * SERIALIZABLE isolation. The WHERE-guarded insert alone is NOT safe under READ COMMITTED (two
 * concurrent statements cannot see each other's uncommitted rows, so both pass the check). Under
 * SERIALIZABLE, Postgres detects that conflict and aborts one transaction with 40001, which
 * withTransaction retries; the retry then sees the winner's hold and gets zero rows -> OVERSOLD.
 */
async function createHoldSerializable(eventId: string, tierId: string, quantity: number): Promise<HoldRow> {
  try {
    return await withTransaction(
      async (client) => {
        const tier = await client.query("SELECT 1 FROM tiers WHERE id = $1 AND event_id = $2", [tierId, eventId]);
        if (tier.rowCount === 0) await throwMissing(client, eventId, tierId);

        const { rows } = await client.query<HoldRow>(
          `INSERT INTO holds (tier_id, quantity, expires_at)
           SELECT t.id, $2::int, clock_timestamp() + make_interval(mins => $3::int)
             FROM tiers t
            WHERE t.id = $1 AND (${AVAILABLE_EXPR}) >= $2::int
           RETURNING id, tier_id, quantity, status, created_at, expires_at`,
          [tierId, quantity, HOLD_TTL_MINUTES],
        );
        const hold = rows[0];
        if (hold) return hold;
        throw oversold(tierId, quantity, await availableForTier(client, tierId));
      },
      { isolation: "serializable" },
    );
  } catch (err) {
    if (isRetryableError(err)) {
      throw new AppError(503, "CONTENTION", "Too many concurrent requests for this tier; please retry", undefined, {
        "retry-after": "1",
      });
    }
    throw err;
  }
}

async function throwMissing(client: PoolClient, eventId: string, tierId: string): Promise<never> {
  const ev = await client.query("SELECT 1 FROM events WHERE id = $1", [eventId]);
  if (ev.rowCount === 0) throw new AppError(404, "EVENT_NOT_FOUND", `Event ${eventId} not found`);
  throw new AppError(404, "TIER_NOT_FOUND", `Tier ${tierId} not found for event ${eventId}`);
}

/**
 * Default. Concurrency: the tier row is locked FOR UPDATE for the duration of the transaction, so
 * every hold/webhook-conversion on the same tier is serialized: check-then-insert cannot
 * interleave. Different tiers never block each other.
 */
async function createHoldWithTierLock(eventId: string, tierId: string, quantity: number): Promise<HoldRow> {
  return withTransaction(async (client) => {
    const ev = await client.query("SELECT 1 FROM events WHERE id = $1", [eventId]);
    if (ev.rowCount === 0) throw new AppError(404, "EVENT_NOT_FOUND", `Event ${eventId} not found`);

    const tier = await client.query("SELECT id FROM tiers WHERE id = $1 AND event_id = $2 FOR UPDATE", [
      tierId,
      eventId,
    ]);
    if (tier.rowCount === 0) {
      throw new AppError(404, "TIER_NOT_FOUND", `Tier ${tierId} not found for event ${eventId}`);
    }

    // Hygiene only: availability already ignores expired holds.
    await client.query(
      "UPDATE holds SET status = 'expired' WHERE tier_id = $1 AND status = 'active' AND expires_at <= clock_timestamp()",
      [tierId],
    );

    const available = await availableForTier(client, tierId);
    if (quantity > available) throw oversold(tierId, quantity, available);

    const { rows } = await client.query<HoldRow>(
      `INSERT INTO holds (tier_id, quantity, expires_at)
       VALUES ($1, $2, clock_timestamp() + make_interval(mins => $3))
       RETURNING id, tier_id, quantity, status, created_at, expires_at`,
      [tierId, quantity, HOLD_TTL_MINUTES],
    );
    const hold = rows[0];
    if (!hold) throw new Error("hold insert returned no row");
    return hold;
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Atomic compare-and-set: only an active, unexpired hold can be cancelled. */
export async function cancelHold(holdId: string): Promise<HoldRow> {
  if (!UUID_RE.test(holdId)) throw new AppError(404, "HOLD_NOT_FOUND", `Hold ${holdId} not found`);
  const pool = getPool();

  const updated = await pool.query<HoldRow>(
    `UPDATE holds SET status = 'expired'
      WHERE id = $1 AND status = 'active' AND expires_at > clock_timestamp()
      RETURNING id, tier_id, quantity, status, created_at, expires_at`,
    [holdId],
  );
  const hold = updated.rows[0];
  if (hold) return hold;

  const existing = await pool.query<HoldRow>("SELECT status, expires_at FROM holds WHERE id = $1", [holdId]);
  const row = existing.rows[0];
  if (!row) throw new AppError(404, "HOLD_NOT_FOUND", `Hold ${holdId} not found`);
  throw new AppError(409, "HOLD_NOT_ACTIVE", "Hold is not active", {
    status: row.status === "active" ? "expired" : row.status,
  });
}
