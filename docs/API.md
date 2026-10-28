# API Documentation

Base URL: `http://localhost:3000` · All bodies are JSON · Money values are returned as strings.

## Error format (all errors)

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [{ "field": "amount", "message": "amount must be greater than 0 with at most 2 decimal places" }]
  }
}
```

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad body/query: missing name, invalid type, amount <= 0, missing reference_id, bad pagination |
| 400 | `INVALID_JSON` | Malformed JSON body |
| 400 | `INVALID_ACCOUNT_ID` | Account id is not a UUID |
| 404 | `ACCOUNT_NOT_FOUND` | Valid UUID but no such account |
| 404 | `ROUTE_NOT_FOUND` | Unknown route/method |
| 409 | `DUPLICATE_TRANSACTION` | `reference_id` already used on that account |
| 413 | `PAYLOAD_TOO_LARGE` | Body over 100 KB |
| 422 | `INSUFFICIENT_BALANCE` | Debit/transfer exceeds balance |
| 500 | `INTERNAL_ERROR` | Unexpected error (details only in server logs) |

---

## POST /accounts
Create an account. Balance always starts at `0`; sending `balance` (or any unknown field) is rejected.

Request
```json
{ "name": "Alice" }
```
`201 Created`
```json
{ "id": "c77e8e8a-9d4a-48f6-b3f2-962b978ca091", "name": "Alice", "balance": "0.00", "created_at": "2026-10-28T05:57:08.466Z" }
```
Errors: `400` (name missing/blank/not a string, unknown field).

## GET /accounts/:id
`200 OK` returns the same shape as above. Errors: `400 INVALID_ACCOUNT_ID`, `404`.

## GET /accounts/:id/balance
`200 OK`
```json
{ "account_id": "c77e8e8a-9d4a-48f6-b3f2-962b978ca091", "balance": "100.00" }
```
Errors: `400 INVALID_ACCOUNT_ID`, `404 ACCOUNT_NOT_FOUND`.

## POST /accounts/:id/transactions
Request
```json
{ "type": "credit", "amount": 100, "description": "Salary", "reference_id": "pay-2026-10" }
```
| Field | Rules |
|---|---|
| `type` | required, `credit` or `debit` |
| `amount` | required, > 0, max 2 decimals (number or numeric string) |
| `description` | optional, max 500 chars |
| `reference_id` | required, non-blank, max 128 chars, unique per account |

`201 Created`
```json
{
  "transaction": {
    "id": "c393fd75-68ef-4518-9e04-3b9d8eb07c1b",
    "account_id": "c77e8e8a-9d4a-48f6-b3f2-962b978ca091",
    "type": "credit",
    "amount": "100.00",
    "description": "Salary",
    "reference_id": "pay-2026-10",
    "created_at": "2026-10-28T05:57:08.505Z"
  },
  "balance": "100.00"
}
```
`409 Conflict` (duplicate `reference_id` on this account; nothing changes)
```json
{
  "error": {
    "code": "DUPLICATE_TRANSACTION",
    "message": "A transaction with this reference_id already exists for this account",
    "details": { "transaction": { "id": "...", "reference_id": "pay-2026-10", "amount": "100.00", "...": "..." } }
  }
}
```
`422 Unprocessable Entity` (debit larger than balance; nothing changes)
```json
{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "Insufficient balance for this debit", "details": null } }
```
Other errors: `400 VALIDATION_ERROR`, `400 INVALID_ACCOUNT_ID`, `404 ACCOUNT_NOT_FOUND`.

## GET /accounts/:id/transactions
Query parameters (all optional)

| Param | Default | Rules |
|---|---|---|
| `type` | both | `credit` or `debit` |
| `page` | 1 | integer >= 1 |
| `limit` | 20 | integer 1 to 100 |

Example: `GET /accounts/{id}/transactions?type=debit&page=1&limit=2`

`200 OK` (latest first)
```json
{
  "data": [
    { "id": "...", "account_id": "...", "type": "debit", "amount": "10.00", "description": "d2", "reference_id": "d2", "created_at": "2026-10-28T06:01:10.120Z" },
    { "id": "...", "account_id": "...", "type": "debit", "amount": "10.00", "description": "d1", "reference_id": "d1", "created_at": "2026-10-28T06:01:09.870Z" }
  ],
  "pagination": { "page": 1, "limit": 2, "total": 2, "total_pages": 1 }
}
```
Errors: `400 VALIDATION_ERROR` (bad page/limit/type), `400 INVALID_ACCOUNT_ID`, `404 ACCOUNT_NOT_FOUND`.

## POST /transfers (bonus)
Atomically debits the source and credits the destination. Either both happen or neither.

Request
```json
{
  "from_account_id": "<uuid>",
  "to_account_id": "<uuid>",
  "amount": 30,
  "description": "Rent share",
  "reference_id": "transfer-001"
}
```
`201 Created`
```json
{
  "reference_id": "transfer-001",
  "amount": "30.00",
  "from": { "account_id": "<uuid>", "balance": "70.00", "transaction": { "type": "debit", "...": "..." } },
  "to":   { "account_id": "<uuid>", "balance": "80.00", "transaction": { "type": "credit", "...": "..." } }
}
```
Errors: `400` (same account, invalid amount/ids/reference), `404 ACCOUNT_NOT_FOUND` (either account), `409 DUPLICATE_TRANSACTION`, `422 INSUFFICIENT_BALANCE`.

---

## curl cheat sheet
```bash
curl -X POST localhost:3000/accounts -H 'content-type: application/json' -d '{"name":"Alice"}'
curl -X POST localhost:3000/accounts/$ID/transactions -H 'content-type: application/json' \
  -d '{"type":"credit","amount":100,"description":"Salary","reference_id":"r1"}'
curl localhost:3000/accounts/$ID/balance
curl "localhost:3000/accounts/$ID/transactions?type=credit&page=1&limit=10"
```
