import express from 'express';
import { accountsRouter } from './routes/accounts.routes';
import { transfersRouter } from './routes/transfers.routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Built separately from server.ts so tests can import the app without opening a port.
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use('/accounts', accountsRouter);
  app.use('/transfers', transfersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
