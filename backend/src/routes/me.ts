import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export const meRouter = Router();

/** Confirma que o token é válido e devolve a identidade. Útil no boot do frontend. */
meRouter.get('/', requireAuth, (req, res) => {
  res.json({ userId: req.auth!.userId, email: req.auth!.email });
});
