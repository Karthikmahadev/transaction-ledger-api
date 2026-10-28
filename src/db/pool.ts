
import { Pool, PoolClient } from 'pg';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

/**
 * Runs `fn` inside a single DB transaction.
 * - resolves  -> COMMIT
 * - throws    -> ROLLBACK (nothing is persisted) and the error is re-thrown
 * This is the only place BEGIN/COMMIT/ROLLBACK live, so atomicity is
 * guaranteed the same way for every write path.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
