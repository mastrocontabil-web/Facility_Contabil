import { pino } from 'pino';
import { config } from '../config.js';

const level =
  process.env.LOG_LEVEL ??
  (config.env === 'test' ? 'silent' : config.isProd ? 'info' : 'debug');

export const logger = pino({
  level,
  transport:
    config.isProd || config.env === 'test'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});
