import { Router } from 'express';
import type { RoomStore } from '../rooms/RoomStore.js';

export function createHealthRouter(roomStore: RoomStore): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      rooms: roomStore.roomCount(),
      members: roomStore.memberCount(),
    });
  });

  return router;
}
