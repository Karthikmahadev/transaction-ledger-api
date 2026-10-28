import { config } from './config';
import { pool } from './db/pool';
import { createApp } from './app';

const server = createApp().listen(config.port, () => {
  console.log(`Ledger API listening on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => pool.end().then(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
