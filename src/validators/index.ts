import { ZodTypeAny, z } from 'zod';
import { InvalidAccountIdError, ValidationError } from '../errors/AppError';
import { accountIdSchema } from './schemas';

/** Parses `data` with `schema`; on failure throws a 400 listing every problem. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      field: i.path.join('.') || '(body)',
      message: i.message,
    }));
    throw new ValidationError('Invalid request data', issues);
  }
  return result.data;
}

export function parseAccountId(raw: string): string {
  const result = accountIdSchema.safeParse(raw);
  if (!result.success) throw new InvalidAccountIdError(raw);
  return result.data;
}
