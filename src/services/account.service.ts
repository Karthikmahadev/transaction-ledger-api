import { pool } from '../db/pool';
import { AccountNotFoundError } from '../errors/AppError';

export async function createAccount(name: string) {
  // balance is NOT in the INSERT: the DB default (0) is the only way it gets set
  const { rows } = await pool.query(
    'INSERT INTO accounts (name) VALUES ($1) RETURNING id, name, balance, created_at',
    [name],
  );
  return rows[0];
}

export async function getAccount(id: string) {
  const { rows } = await pool.query(
    'SELECT id, name, balance, created_at FROM accounts WHERE id = $1',
    [id],
  );
  if (!rows[0]) throw new AccountNotFoundError(id);
  return rows[0];
}

export async function getBalance(id: string) {
  const { rows } = await pool.query(
    'SELECT id AS account_id, balance FROM accounts WHERE id = $1',
    [id],
  );
  if (!rows[0]) throw new AccountNotFoundError(id);
  return rows[0] as { account_id: string; balance: string };
}
