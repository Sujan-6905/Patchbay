import { MAX_ROOM_MEMBERS, roomIdSchema } from '@patchbay/shared';
import { Router } from 'express';
import type { RoomStore } from '../rooms/RoomStore.js';

export function createRoomsRouter(roomStore: RoomStore): Router {
  const router = Router();

  // Best-effort pre-join check so the Lobby can surface "Room is full" before navigating;
  // room:join over the socket remains the authoritative check (a room can still fill up
  // in the moment between this call and the actual join).
  router.get('/rooms/:roomId/status', (req, res) => {
    const parsed = roomIdSchema.safeParse(req.params.roomId);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid room id' });
      return;
    }

    const members = roomStore.getMembers(parsed.data);
    if (members === undefined) {
      res.json({ exists: false, memberCount: 0, full: false });
      return;
    }

    res.json({
      exists: true,
      memberCount: members.length,
      full: members.length >= MAX_ROOM_MEMBERS,
    });
  });

  return router;
}
