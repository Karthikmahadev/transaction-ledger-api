import { Router } from 'express';


import { ah } from './asyncHandler';
import { createAccountSchema, createTransactionSchema, historyQuerySchema } from '../validators/schemas';
import { createAccount, getAccount, getBalance } from '../services/account.service';
import { parse, parseAccountId } from '../validators';
import { addTransaction, listTransactions } from '../services/transaction.service';

export const accountsRouter = Router();

// Create account
accountsRouter.post(
  '/',
  ah(async (req, res) => {
    const { name } = parse(createAccountSchema, req.body);
    res.status(201).json(await createAccount(name));
  }),
);

// Get account
accountsRouter.get(
  '/:id',
  ah(async (req, res) => {
    res.json(await getAccount(parseAccountId(req.params.id)));
  }),
);

// Get balance
accountsRouter.get(
  '/:id/balance',
  ah(async (req, res) => {
    res.json(await getBalance(parseAccountId(req.params.id)));
  }),
);

// Add transaction
accountsRouter.post(
  '/:id/transactions',
  ah(async (req, res) => {
    const accountId = parseAccountId(req.params.id);
    const body = parse(createTransactionSchema, req.body);
    res.status(201).json(await addTransaction(accountId, body));
  }),
);

// Transaction history (filter + pagination, latest first)
accountsRouter.get(
  '/:id/transactions',
  ah(async (req, res) => {
    const accountId = parseAccountId(req.params.id);
    const query = parse(historyQuerySchema, req.query);
    res.json(await listTransactions(accountId, query));
  }),
);
