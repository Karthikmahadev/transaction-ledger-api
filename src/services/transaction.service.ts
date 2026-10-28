import { pool, withTransaction } from '../db/pool';
import { DuplicateTransactionError } from '../errors/AppError';
import { getBalance } from './account.service';
import {
  TRANSACTION_COLUMNS,
  TxType,
  applyBalanceChange,
  findByReference,
  insertLedgerEntry,
} from './ledger';

interface NewTransaction {
  type: TxType;
  amount: string;
  description: string;
  reference_id: string;
}

/**
 * Create a transaction + update the balance as ONE atomic unit.
 *  1. insert ledger row (dedupes on account_id + reference_id)
 *  2. update balance (debit is guarded by `balance >= amount`)
 * Any throw -> ROLLBACK -> neither the row nor the balance change is persisted.
 */
export async function addTransaction(accountId: string, input: NewTransaction) {
  return withTransaction(async (client) => {
    const tx = await insertLedgerEntry(client, accountId, input);
    if (!tx) {
      const existing = await findByReference(client, accountId, input.reference_id);
      throw new DuplicateTransactionError(existing); // rolls back; balance untouched
    }
    const balance = await applyBalanceChange(client, accountId, input.type, input.amount);
    return { transaction: tx, balance };
  });
}

interface HistoryQuery {
  type?: TxType;
  page: number;
  limit: number;
}

export async function listTransactions(accountId: string, q: HistoryQuery) {
  await getBalance(accountId); // 404 if account does not exist

  const params: unknown[] = [accountId];
  let where = 'account_id = $1';
  if (q.type) {
    params.push(q.type);
    where += ` AND type = $${params.length}`;
  }

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM transactions WHERE ${where}`,
    params,
  );
  const total: number = countResult.rows[0].total;

  const { rows } = await pool.query(
    `SELECT ${TRANSACTION_COLUMNS} FROM transactions
     WHERE ${where}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, q.limit, (q.page - 1) * q.limit],
  );

  return {
    data: rows,
    pagination: {
      page: q.page,
      limit: q.limit,
      total,
      total_pages: Math.ceil(total / q.limit),
    },
  };
}
