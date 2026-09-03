import 'dotenv/config';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './lib/logger.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`backend ouvindo em http://localhost:${config.port} (${config.env})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logger.info(`${sig} recebido, encerrando...`);
    server.close(() => process.exit(0));
  });
}
