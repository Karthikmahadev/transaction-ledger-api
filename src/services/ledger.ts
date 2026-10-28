import { PoolClient } from 'pg';
import { AccountNotFoundError, InsufficientBalanceError } from '../errors/AppError';

export type TxType = 'credit' | 'debit';

export interface LedgerEntry {
  type: TxType;
  amount: string;
  description: string;
  reference_id: string;
}

const COLUMNS = 'id, account_id, type, amount, description, reference_id, created_at';

/**
 * Inserts one ledger row.
 * - Duplicate (account_id, reference_id): the UNIQUE constraint makes Postgres skip
 *   the insert (ON CONFLICT DO NOTHING) -> we return null. Race-proof: two parallel
 *   requests with the same reference can never both insert.
 * - Unknown account: the foreign key rejects it (23503) -> mapped to 404.
 */
export async function insertLedgerEntry(
  client: PoolClient,
  accountId: string,
  entry: LedgerEntry,
) {
  try {
    const { rows } = await client.query(
      `INSERT INTO transactions (account_id, type, amount, description, reference_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id, reference_id) DO NOTHING
       RETURNING ${COLUMNS}`,
      [accountId, entry.type, entry.amount, entry.description, entry.reference_id],
    );
    return rows[0] ?? null;
  } catch (err: any) {
    if (err?.code === '23503') throw new AccountNotFoundError(accountId);
    throw err;
  }
}

/**
 * Atomically changes the balance and returns the new one.
 * For debits the "enough money?" check lives INSIDE the UPDATE's WHERE clause, so
 * check + write is a single atomic step (no read-then-write race condition).
 */
export async function applyBalanceChange(
  client: PoolClient,
  accountId: string,
  type: TxType,
  amount: string,
): Promise<string> {
  const sql =
    type === 'credit'
      ? 'UPDATE accounts SET balance = balance + $2 WHERE id = $1 RETURNING balance'
      : 'UPDATE accounts SET balance = balance - $2 WHERE id = $1 AND balance >= $2 RETURNING balance';
  const { rows } = await client.query(sql, [accountId, amount]);
  if (!rows[0]) {
    // 0 rows: either the account is gone or (debit) the balance was too low
    if (type === 'debit') {
      const exists = await client.query('SELECT 1 FROM accounts WHERE id = $1', [accountId]);
      if (exists.rowCount) throw new InsufficientBalanceError();
    }
    throw new AccountNotFoundError(accountId);
  }
  return rows[0].balance;
}

export async function findByReference(client: PoolClient, accountId: string, referenceId: string) {
  const { rows } = await client.query(
    `SELECT ${COLUMNS} FROM transactions WHERE account_id = $1 AND reference_id = $2`,
    [accountId, referenceId],
  );
  return rows[0] ?? null;
}

export { COLUMNS as TRANSACTION_COLUMNS };
