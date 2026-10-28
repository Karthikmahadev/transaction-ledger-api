# Transaction Ledger API

A backend API for a simple transaction ledger: create accounts, post credit/debit
transactions, read balances, browse paginated history, and (bonus) transfer money
between accounts atomically.

**Stack:** Node.js 20+, TypeScript, Express 4, PostgreSQL 16, Zod, Vitest + Supertest.

## Quick start

Prerequisites: Node.js 20+, Docker (for Postgres).

```bash
docker compose up -d          # start PostgreSQL on :5432
cp .env.example .env          # default values work with docker-compose
npm install
npm run migrate               # creates tables, constraints, trigger
npm run dev                   # http://localhost:3000
```

Run the tests (needs the database from above):

```bash
npm test
```

Production build: `npm run build && npm start`.

> No Docker? Point `DATABASE_URL` in `.env` at any PostgreSQL 13+ instance and run `npm run migrate`.

## Endpoints

| Method | Path                                | Description                         |
|--------|-------------------------------------|-------------------------------------|
| POST   | `/accounts`                         | Create account (balance starts at 0)|
| GET    | `/accounts/:id`                     | Get account                         |
| GET    | `/accounts/:id/balance`             | Get current balance                 |
| POST   | `/accounts/:id/transactions`        | Add credit/debit transaction        |
| GET    | `/accounts/:id/transactions`        | History: `type`, `page`, `limit`    |
| POST   | `/transfers`                        | Atomic transfer between accounts    |
| GET    | `/health`                           | Liveness check                      |

Full request/response examples: [docs/API.md](docs/API.md).

## Project structure

```
migrations/001_init.sql        schema, constraints, immutability trigger
src/
  server.ts                    starts HTTP server, graceful shutdown
  app.ts                       builds the Express app (importable by tests)
  config.ts                    env configuration
  db/pool.ts                   pg pool + withTransaction() helper
  db/migrate.ts, migrate-cli.ts  tiny migration runner
  routes/                      HTTP layer: parse input, call service, send response
  validators/                  Zod schemas + parse helpers
  services/                    business logic and SQL
    ledger.ts                  shared building blocks (insert row, change balance)
    account.service.ts
    transaction.service.ts
    transfer.service.ts
  errors/AppError.ts           typed errors with HTTP status + stable code
  middleware/errorHandler.ts   single place that formats every error
tests/api.test.ts              integration tests incl. concurrency tests
```

## How data integrity is guaranteed

| Requirement | Mechanism |
|---|---|
| Atomicity | Ledger insert and balance update run in one DB transaction (`withTransaction`). Any error triggers `ROLLBACK`. |
| No overdraft (even under concurrency) | Debit is `UPDATE ... SET balance = balance - $2 WHERE id = $1 AND balance >= $2`. Check and write are one atomic statement. A `CHECK (balance >= 0)` constraint is a second safety net. |
| Duplicate `reference_id` | `UNIQUE (account_id, reference_id)` + `INSERT ... ON CONFLICT DO NOTHING`. Safe under parallel requests. Same reference is allowed on different accounts. |
| Immutability | A `BEFORE UPDATE OR DELETE` trigger on `transactions` raises an exception, and the API exposes no mutation endpoints. |
| Balance consistency | Balance only changes inside the same transaction that inserts the matching ledger row. A test asserts `balance == sum(credits) - sum(debits)`. |
| Transfers | Debit + credit in one DB transaction. Both accounts are locked in sorted-id order, so opposite transfers (A->B, B->A) cannot deadlock. |
| Money precision | `NUMERIC(14,2)` in the DB; amounts and balances are strings in JSON (no float rounding). |

## Assumptions

1. **Single currency**; amounts have at most 2 decimal places (max 12 integer digits). Amounts may be sent as a number or a numeric string. Responses return money as strings (e.g. `"100.00"`).
2. **Duplicate `reference_id`** returns `409 Conflict` with code `DUPLICATE_TRANSACTION` and the original transaction in `error.details.transaction`. No new row is created and the balance is unchanged.
3. **Insufficient balance** returns `422 Unprocessable Entity`. Rejected transactions are not stored, so they do not consume their `reference_id`.
4. **Malformed account id** (not a UUID) returns `400 INVALID_ACCOUNT_ID`; a well-formed but unknown id returns `404 ACCOUNT_NOT_FOUND`.
5. **`POST /accounts` rejects unknown fields** (e.g. a client-supplied `balance`) with 400 rather than silently ignoring them.
6. `description` is optional (defaults to empty string, max 500 chars). `reference_id` max 128 chars.
7. **Pagination:** `page` defaults to 1, `limit` defaults to 20 (max 100). A page beyond the last returns an empty `data` array with correct metadata. History order is `created_at DESC`, with `id DESC` as a tiebreaker.
8. **Transfers** create one debit row on the source and one credit row on the destination, both using the client's `reference_id` (allowed because uniqueness is per account). Reusing a reference on either account returns 409.
9. No authentication/authorization, as it is out of scope for this assessment.
10. `transactions.created_at` uses `clock_timestamp()` (actual insert time) rather than `now()` (transaction start time) so ordering reflects real insertion order.
