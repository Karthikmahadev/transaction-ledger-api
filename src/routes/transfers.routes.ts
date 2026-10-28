import { Router } from 'express';

import { ah } from './asyncHandler';
import { transfer } from '../services/transfer.service';
import { transferSchema } from '../validators/schemas';
import { parse } from '../validators';

export const transfersRouter = Router();

transfersRouter.post(
  '/',
  ah(async (req, res) => {
    const body = parse(transferSchema, req.body);
    res.status(201).json(await transfer(body));
  }),
);
