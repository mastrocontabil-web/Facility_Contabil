import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import { HttpError } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Rota não encontrada' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Dados inválidos', details: err.flatten() });
    return;
  }
  if (err instanceof MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: `Upload inválido: ${err.message}` });
    return;
  }
  if (err instanceof HttpError) {
    if (err.status >= 500) logger.error({ err }, err.message);
    res.status(err.status).json({ error: err.message, details: err.details ?? undefined });
    return;
  }
  // erro com status numérico anexado
  const anyErr = err as { status?: unknown; statusCode?: unknown; message?: unknown };
  const s = Number(anyErr.status ?? anyErr.statusCode);
  if (Number.isInteger(s) && s >= 400 && s < 600) {
    res.status(s).json({ error: String(anyErr.message ?? 'Erro') });
    return;
  }

  logger.error({ err }, 'Erro não tratado');
  res.status(500).json({ error: 'Erro interno' });
}
