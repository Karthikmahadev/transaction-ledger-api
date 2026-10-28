/** Base class: anything we throw on purpose carries its HTTP status + a stable code. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

export class InvalidAccountIdError extends AppError {
  constructor(id: string) {
    super(400, 'INVALID_ACCOUNT_ID', 'Account id must be a valid UUID', { id });
  }
}

export class AccountNotFoundError extends AppError {
  constructor(id: string) {
    super(404, 'ACCOUNT_NOT_FOUND', `Account ${id} not found`, { account_id: id });
  }
}

export class InsufficientBalanceError extends AppError {
  constructor() {
    super(422, 'INSUFFICIENT_BALANCE', 'Insufficient balance for this debit');
  }
}

export class DuplicateTransactionError extends AppError {
  constructor(existing: unknown) {
    super(
      409,
      'DUPLICATE_TRANSACTION',
      'A transaction with this reference_id already exists for this account',
      { transaction: existing },
    );
  }
}
