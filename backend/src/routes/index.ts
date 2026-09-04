import { Router } from 'express';
import { healthRouter } from './health.js';
import { meRouter } from './me.js';
import { requireAuth } from '../middleware/auth.js';
import { clientsRouter } from '../clients/router.js';
import { statementsRouter } from '../statements/router.js';
import { rulesRouter } from '../rules/router.js';
import { classificacoesRouter } from '../classificacoes/router.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/clients', requireAuth, clientsRouter);
apiRouter.use('/statements', requireAuth, statementsRouter);
apiRouter.use('/rules', requireAuth, rulesRouter);
apiRouter.use('/classificacoes', requireAuth, classificacoesRouter);
