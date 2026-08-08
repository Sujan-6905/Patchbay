import { Router } from 'express';
import { config } from '../config.js';

export function createTurnConfigRouter(): Router {
  const router = Router();

  router.get('/turn-config', (_req, res) => {
    res.json({ iceServers: config.iceServers });
  });

  return router;
}
