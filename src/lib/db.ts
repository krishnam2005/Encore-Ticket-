import { Pool, type PoolClient } from "pg";
import { inc } from "./observability";

const globalForPool = globalThis as unknown as { pgPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000 });
}

export function getPool(): Pool {
  globalForPool.pgPool ??= createPool();
  return globalForPool.pgPool;
}

export interface TransactionOptions {
  /** SERIALIZABLE transactions are retried automatically on serialization failures. */
  isolation?: "read committed" | "serializable";
  maxRetries?: number;
}

/** SQLSTATE 40001 = serialization_failure, 40P01 = deadlock_detected. Both are safe to retry. */
export function isRetryableError(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) return false;
  const code = (err as { code: unknown }).code;
  return code === "40001" || code === "40P01";
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `fn` in a single transaction; commits on success, rolls back on any throw. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const serializable = options.isolation === "serializable";
  const maxRetries = serializable ? (options.maxRetries ?? 15) : 0;

  for (let attempt = 0; ; attempt++) {
    const client = await getPool().connect();
    try {
      await client.query(serializable ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (!isRetryableError(err) || attempt >= maxRetries) throw err;
      inc("db_tx_retries_total", { sqlstate: String((err as { code: unknown }).code) });
      // fall through to the finally block (releases the client), then retry with jittered backoff
      await sleep(Math.random() * 15 * (attempt + 1));
    } finally {
      client.release();
    }
  }
}
