import { Router } from 'express';
export const healthRouter = Router();
healthRouter.get('/', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
