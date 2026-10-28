
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { runMigrations } from '../src/db/migrate';
import { pool } from '../src/db/pool';

const app = createApp();

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await pool.end();
});

const newAccount = async (name = 'Test User') =>
  (await request(app).post('/accounts').send({ name })).body.id as string;

const tx = (id: string, body: object) =>
  request(app).post(`/accounts/${id}/transactions`).send(body);

const balanceOf = async (id: string) =>
  (await request(app).get(`/accounts/${id}/balance`)).body.balance as string;

let counter = 0;
const ref = () => `ref-${Date.now()}-${counter++}`;

describe('1. Create account', () => {
  it('creates an account with balance 0 and system-generated id/created_at', async () => {
    const res = await request(app).post('/accounts').send({ name: 'Alice' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Alice', balance: '0.00' });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(res.body.created_at).getTime()).not.toBeNaN();
  });

  it('rejects a client-supplied balance', async () => {
    const res = await request(app)
      .post('/accounts')
      .send({ name: 'Eve', balance: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    {},
    { name: '' },
    { name: '   ' },
    { name: 42 },
  ])('rejects invalid name %j', async (body) => {
    const res = await request(app).post('/accounts').send(body);

    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/accounts')
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('2. Transactions', () => {
  it('credit increases, debit decreases (100 + 50 - 30 - 20)', async () => {
    const id = await newAccount();

    expect(
      (await tx(id, {
        type: 'credit',
        amount: 100,
        reference_id: ref(),
      })).status,
    ).toBe(201);

    await tx(id, { type: 'credit', amount: 50, reference_id: ref() });
    await tx(id, { type: 'debit', amount: 30, reference_id: ref() });

    const last = await tx(id, {
      type: 'debit',
      amount: 20,
      description: 'rent',
      reference_id: ref(),
    });

    expect(last.body.balance).toBe('100.00');
    expect(await balanceOf(id)).toBe('100.00');
  });

  it('rejects overdraft and leaves balance unchanged', async () => {
    const id = await newAccount();

    await tx(id, { type: 'credit', amount: 100, reference_id: ref() });

    const res = await tx(id, {
      type: 'debit',
      amount: 150,
      reference_id: 'too-much',
    });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balanceOf(id)).toBe('100.00');

    const history = await request(app).get(
      `/accounts/${id}/transactions`,
    );

    expect(history.body.pagination.total).toBe(1);

    const retry = await tx(id, {
      type: 'credit',
      amount: 10,
      reference_id: 'too-much',
    });

    expect(retry.status).toBe(201);
  });

  it('duplicate reference_id returns 409 without changing balance', async () => {
    const id = await newAccount();
    const r = ref();

    const first = await tx(id, {
      type: 'credit',
      amount: 100,
      reference_id: r,
    });

    const second = await tx(id, {
      type: 'credit',
      amount: 100,
      reference_id: r,
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(second.body.error.details.transaction.id).toBe(
      first.body.transaction.id,
    );
    expect(await balanceOf(id)).toBe('100.00');
  });

  it('allows the same reference_id on different accounts', async () => {
    const [a, b] = [await newAccount(), await newAccount()];
    const r = ref();

    expect(
      (await tx(a, { type: 'credit', amount: 5, reference_id: r })).status,
    ).toBe(201);

    expect(
      (await tx(b, { type: 'credit', amount: 5, reference_id: r })).status,
    ).toBe(201);
  });
});

describe('7/8. Validation & errors', () => {
  it.each([
    [{ type: 'transfer', amount: 10, reference_id: 'x' }, 'invalid type'],
    [{ amount: 10, reference_id: 'x' }, 'missing type'],
    [{ type: 'credit', amount: 0, reference_id: 'x' }, 'zero amount'],
    [{ type: 'credit', amount: -5, reference_id: 'x' }, 'negative amount'],
    [{ type: 'credit', amount: 'abc', reference_id: 'x' }, 'non-numeric amount'],
    [{ type: 'credit', amount: 1.234, reference_id: 'x' }, '3 decimals'],
    [{ type: 'credit', reference_id: 'x' }, 'missing amount'],
    [{ type: 'credit', amount: 10 }, 'missing reference_id'],
    [{ type: 'credit', amount: 10, reference_id: '  ' }, 'blank reference_id'],
  ])('400 for %j (%s)', async (body, _description) => {
    const id = await newAccount();
    const res = await tx(id, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await balanceOf(id)).toBe('0.00');
  });

  it('404 for unknown account, 400 for malformed id', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';

    const a = await tx(missing, {
      type: 'credit',
      amount: 10,
      reference_id: 'x',
    });

    expect(a.status).toBe(404);
    expect(a.body.error.code).toBe('ACCOUNT_NOT_FOUND');

    expect(
      (await request(app).get(`/accounts/${missing}/balance`)).status,
    ).toBe(404);

    expect(
      (await request(app).get(`/accounts/${missing}/transactions`)).status,
    ).toBe(404);

    const bad = await request(app).get(
      '/accounts/not-a-uuid/balance',
    );

    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_ACCOUNT_ID');
  });

  it('unknown route returns the standard error envelope', async () => {
    const res = await request(app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('3. Balance', () => {
  it('returns account_id and balance', async () => {
    const id = await newAccount();

    const res = await request(app).get(`/accounts/${id}/balance`);

    expect(res.body).toEqual({
      account_id: id,
      balance: '0.00',
    });
  });
});

describe('4. History', () => {
  it('filters by type, paginates, and sorts latest-first', async () => {
    const id = await newAccount();

    for (let i = 1; i <= 5; i++) {
      await tx(id, {
        type: 'credit',
        amount: 100,
        description: `c${i}`,
        reference_id: `c${i}`,
      });
    }

    for (let i = 1; i <= 2; i++) {
      await tx(id, {
        type: 'debit',
        amount: 10,
        description: `d${i}`,
        reference_id: `d${i}`,
      });
    }

    const all = await request(app).get(
      `/accounts/${id}/transactions?limit=3`,
    );

    expect(all.body.pagination).toEqual({
      page: 1,
      limit: 3,
      total: 7,
      total_pages: 3,
    });

    expect(all.body.data.map((t: any) => t.description)).toEqual([
      'd2',
      'd1',
      'c5',
    ]);

    const page3 = await request(app).get(
      `/accounts/${id}/transactions?limit=3&page=3`,
    );

    expect(page3.body.data.map((t: any) => t.description)).toEqual([
      'c1',
    ]);

    const credits = await request(app).get(
      `/accounts/${id}/transactions?type=credit`,
    );

    expect(credits.body.pagination.total).toBe(5);
    expect(
      credits.body.data.every((t: any) => t.type === 'credit'),
    ).toBe(true);

    const beyond = await request(app).get(
      `/accounts/${id}/transactions?page=99`,
    );

    expect(beyond.status).toBe(200);
    expect(beyond.body.data).toEqual([]);
  });

  it.each([
    'page=0',
    'page=-1',
    'page=abc',
    'limit=0',
    'limit=101',
    'limit=1.5',
    'type=refund',
  ])('400 for invalid query %s', async (qs) => {
    const id = await newAccount();

    const res = await request(app).get(
      `/accounts/${id}/transactions?${qs}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('5. Data integrity', () => {
  it('transactions cannot be updated or deleted (DB trigger)', async () => {
    const id = await newAccount();

    await tx(id, {
      type: 'credit',
      amount: 10,
      reference_id: ref(),
    });

    await expect(
      pool.query(
        'UPDATE transactions SET amount = 999 WHERE account_id = $1',
        [id],
      ),
    ).rejects.toThrow(/immutable/);

    await expect(
      pool.query(
        'DELETE FROM transactions WHERE account_id = $1',
        [id],
      ),
    ).rejects.toThrow(/immutable/);
  });

  it('no update/delete routes exist', async () => {
    const id = await newAccount();

    const t = await tx(id, {
      type: 'credit',
      amount: 10,
      reference_id: ref(),
    });

    const url = `/accounts/${id}/transactions/${t.body.transaction.id}`;

    expect(
      (await request(app).put(url).send({ amount: 1 })).status,
    ).toBe(404);

    expect(
      (await request(app).delete(url)).status,
    ).toBe(404);
  });

  it('balance equals credits minus debits', async () => {
    const id = await newAccount();

    await tx(id, { type: 'credit', amount: 100.5, reference_id: 'a' });
    await tx(id, { type: 'debit', amount: 20.25, reference_id: 'b' });
    await tx(id, { type: 'debit', amount: 9999, reference_id: 'c' });

    const { rows } = await pool.query(
      `SELECT COALESCE(
         SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END),
         0
       ) AS s
       FROM transactions
       WHERE account_id = $1`,
      [id],
    );

    expect(rows[0].s).toBe(await balanceOf(id));
    expect(rows[0].s).toBe('80.25');
  });

  it('CONCURRENCY: 10 parallel debits of 30 on balance 100 -> exactly 3 succeed', async () => {
    const id = await newAccount();

    await tx(id, {
      type: 'credit',
      amount: 100,
      reference_id: 'seed',
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        tx(id, {
          type: 'debit',
          amount: 30,
          reference_id: `p${i}`,
        }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(7);
    expect(await balanceOf(id)).toBe('10.00');
  });

  it('CONCURRENCY: 20 parallel requests with the same reference_id -> exactly one applied', async () => {
    const id = await newAccount();

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        tx(id, {
          type: 'credit',
          amount: 50,
          reference_id: 'same',
        }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(19);
    expect(await balanceOf(id)).toBe('50.00');
  });
});

describe('9. Transfer', () => {
  const transfer = (body: object) =>
    request(app).post('/transfers').send(body);

  it('moves money atomically (A:100, B:50 -> A:70, B:80)', async () => {
    const [a, b] = [
      await newAccount('A'),
      await newAccount('B'),
    ];

    await tx(a, { type: 'credit', amount: 100, reference_id: 's1' });
    await tx(b, { type: 'credit', amount: 50, reference_id: 's2' });

    const res = await transfer({
      from_account_id: a,
      to_account_id: b,
      amount: 30,
      reference_id: 't1',
    });

    expect(res.status).toBe(201);
    expect(res.body.from.balance).toBe('70.00');
    expect(res.body.to.balance).toBe('80.00');
    expect(await balanceOf(a)).toBe('70.00');
    expect(await balanceOf(b)).toBe('80.00');

    const hist = await request(app).get(
      `/accounts/${b}/transactions?type=credit`,
    );

    expect(hist.body.data[0]).toMatchObject({
      reference_id: 't1',
      amount: '30.00',
    });
  });

  it('insufficient balance: 422 and neither account changes', async () => {
    const [a, b] = [
      await newAccount(),
      await newAccount(),
    ];

    await tx(a, { type: 'credit', amount: 10, reference_id: 's' });

    const res = await transfer({
      from_account_id: a,
      to_account_id: b,
      amount: 30,
      reference_id: 't',
    });

    expect(res.status).toBe(422);
    expect(await balanceOf(a)).toBe('10.00');
    expect(await balanceOf(b)).toBe('0.00');

    expect(
      (await request(app).get(`/accounts/${b}/transactions`))
        .body.pagination.total,
    ).toBe(0);
  });

  it('missing destination: 404 and source untouched', async () => {
    const a = await newAccount();

    await tx(a, { type: 'credit', amount: 10, reference_id: 's' });

    const res = await transfer({
      from_account_id: a,
      to_account_id: '00000000-0000-4000-8000-000000000000',
      amount: 5,
      reference_id: 't',
    });

    expect(res.status).toBe(404);
    expect(await balanceOf(a)).toBe('10.00');
  });

  it('rejects same-account transfer, duplicate reference, and bad amount', async () => {
    const [a, b] = [
      await newAccount(),
      await newAccount(),
    ];

    await tx(a, { type: 'credit', amount: 100, reference_id: 's' });

    expect(
      (await transfer({
        from_account_id: a,
        to_account_id: a,
        amount: 5,
        reference_id: 't',
      })).status,
    ).toBe(400);

    expect(
      (await transfer({
        from_account_id: a,
        to_account_id: b,
        amount: 0,
        reference_id: 't',
      })).status,
    ).toBe(400);

    expect(
      (await transfer({
        from_account_id: a,
        to_account_id: b,
        amount: 5,
        reference_id: 'dup',
      })).status,
    ).toBe(201);

    const dup = await transfer({
      from_account_id: a,
      to_account_id: b,
      amount: 5,
      reference_id: 'dup',
    });

    expect(dup.status).toBe(409);
    expect(await balanceOf(a)).toBe('95.00');
  });

  it('CONCURRENCY: opposite parallel transfers do not deadlock and conserve money', async () => {
    const [a, b] = [
      await newAccount(),
      await newAccount(),
    ];

    await tx(a, { type: 'credit', amount: 1000, reference_id: 'sa' });
    await tx(b, { type: 'credit', amount: 1000, reference_id: 'sb' });

    const jobs = Array.from({ length: 20 }, (_, i) =>
      i % 2 === 0
        ? transfer({
            from_account_id: a,
            to_account_id: b,
            amount: 10,
            reference_id: `ab${i}`,
          })
        : transfer({
            from_account_id: b,
            to_account_id: a,
            amount: 10,
            reference_id: `ba${i}`,
          }),
    );

    const results = await Promise.all(jobs);

    expect(results.every((r) => r.status === 201)).toBe(true);

    const total =
      Number(await balanceOf(a)) + Number(await balanceOf(b));

    expect(total).toBe(2000);
  });
});
