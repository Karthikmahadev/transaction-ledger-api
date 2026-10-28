import { withTransaction } from '../db/pool';
import { AccountNotFoundError, DuplicateTransactionError } from '../errors/AppError';
import { applyBalanceChange, findByReference, insertLedgerEntry } from './ledger';

interface TransferInput {
  from_account_id: string;
  to_account_id: string;
  amount: string;
  description?: string;
  reference_id: string;
}

/**
 * Debit source + credit destination in ONE DB transaction.
 * Any failure (missing account, low balance, duplicate ref) rolls back everything,
 * so a partial transfer is impossible.
 */
export async function transfer(input: TransferInput) {
  const { from_account_id: from, to_account_id: to, amount, reference_id } = input;

  return withTransaction(async (client) => {
    // Lock both rows in a fixed order (sorted by id). Two opposite transfers
    // (A->B and B->A) therefore queue up instead of deadlocking.
    const locked = await client.query(
      'SELECT id FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR NO KEY UPDATE',
      [[from, to]],
    );
    const found = new Set(locked.rows.map((r) => r.id as string));
    for (const id of [from, to]) if (!found.has(id)) throw new AccountNotFoundError(id);

    const debit = await insertLedgerEntry(client, from, {
      type: 'debit',
      amount,
      description: input.description ?? `Transfer to ${to}`,
      reference_id,
    });
    if (!debit) throw new DuplicateTransactionError(await findByReference(client, from, reference_id));

    const credit = await insertLedgerEntry(client, to, {
      type: 'credit',
      amount,
      description: input.description ?? `Transfer from ${from}`,
      reference_id,
    });
    if (!credit) throw new DuplicateTransactionError(await findByReference(client, to, reference_id));

    const fromBalance = await applyBalanceChange(client, from, 'debit', amount);
    const toBalance = await applyBalanceChange(client, to, 'credit', amount);

    return {
      reference_id,
      amount,
      from: { account_id: from, balance: fromBalance, transaction: debit },
      to: { account_id: to, balance: toBalance, transaction: credit },
    };
  });
}

