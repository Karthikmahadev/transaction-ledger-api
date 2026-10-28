-- Accounts: balance can never go negative (DB-level safety net)
CREATE TABLE accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Transactions: the immutable ledger
CREATE TABLE transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id),
  type          TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  description   TEXT NOT NULL DEFAULT '',
  reference_id  TEXT NOT NULL CHECK (length(trim(reference_id)) > 0),
  -- clock_timestamp() = real insert time (now() would be the txn start time)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Same reference_id allowed on different accounts, never twice on one account
  CONSTRAINT uq_account_reference UNIQUE (account_id, reference_id)
);

-- Serves: WHERE account_id = ? [AND type = ?] ORDER BY created_at DESC, id DESC
CREATE INDEX idx_transactions_account_created
  ON transactions (account_id, created_at DESC, id DESC);

-- Immutability enforced by the database, not just by the absence of endpoints
CREATE FUNCTION forbid_transaction_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions are immutable (% is not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transactions_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_transaction_mutation();
