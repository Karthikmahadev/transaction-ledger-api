
import { z } from 'zod';

const uuid = z
  .string({ error: 'must be a string' })
  .uuid('must be a valid UUID')
  .transform((s) => s.toLowerCase());

/**
 * Money must be positive and have at most 2 decimal places.
 * Keep the value as a string to avoid floating-point precision errors.
 */
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

export const amountSchema = z
  .union([z.string(), z.number()], {
    error: 'amount is required and must be a number',
  })
  .transform((v) => String(v).trim())
  .refine(
    (v) => MONEY.test(v),
    'amount must be greater than 0 with at most 2 decimal places',
  )
  .refine(
    (v) => !MONEY.test(v) || Number(v) > 0,
    'amount must be greater than 0',
  );

const referenceId = z
  .string({ error: 'reference_id is required and must be a string' })
  .trim()
  .min(1, 'reference_id is required')
  .max(128, 'reference_id must be at most 128 characters');

const description = z
  .string({ error: 'description must be a string' })
  .trim()
  .max(500, 'description must be at most 500 characters');

// Reject unknown fields, such as a client-supplied balance.
export const createAccountSchema = z
  .object({
    name: z
      .string({ error: 'name is required and must be a string' })
      .trim()
      .min(1, 'name is required')
      .max(100, 'name must be at most 100 characters'),
  })
  .strict();

export const createTransactionSchema = z.object({
  type: z.enum(['credit', 'debit'], {
    error: "type must be 'credit' or 'debit'",
  }),
  amount: amountSchema,
  description: description.optional().default(''),
  reference_id: referenceId,
});

export const transferSchema = z
  .object({
    from_account_id: uuid,
    to_account_id: uuid,
    amount: amountSchema,
    description: description.optional(),
    reference_id: referenceId,
  })
  .refine(
    (data) => data.from_account_id !== data.to_account_id,
    {
      message: 'from_account_id and to_account_id must be different',
      path: ['to_account_id'],
    },
  );

const positiveInt = (name: string, def: string, max: number) =>
  z
    .string({ error: `${name} must be a single integer` })
    .regex(/^\d+$/, `${name} must be a positive integer`)
    .default(def)
    .transform(Number)
    .refine(
      (n) => n >= 1 && n <= max,
      `${name} must be between 1 and ${max}`,
    );

export const historyQuerySchema = z.object({
  type: z
    .enum(['credit', 'debit'], {
      error: "type must be 'credit' or 'debit'",
    })
    .optional(),
  page: positiveInt('page', '1', 1_000_000),
  limit: positiveInt('limit', '20', 100),
});

export const accountIdSchema = uuid;
