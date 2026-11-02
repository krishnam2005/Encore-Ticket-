import type { TransactionOptions } from "./db";

/**
 * INVENTORY_LOCKING selects how inventory-changing transactions stay correct under concurrency:
 *
 *   tier-lock     (default) pessimistic: SELECT ... FOR UPDATE on the tier row serializes holds and
 *                 payment conversions per tier. Simple, no retries.
 *   serializable  optimistic / lock-free: no explicit locks; SERIALIZABLE isolation makes Postgres
 *                 abort one of two conflicting transactions (SQLSTATE 40001) and we retry it.
 */
export type InventoryLocking = "tier-lock" | "serializable";

export function inventoryLocking(): InventoryLocking {
  return process.env.INVENTORY_LOCKING === "serializable" ? "serializable" : "tier-lock";
}

export function inventoryTransactionOptions(): TransactionOptions {
  return inventoryLocking() === "serializable" ? { isolation: "serializable" } : {};
}
