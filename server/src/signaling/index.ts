import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@patchbay/shared';
import { memberStateSchema, roomJoinSchema, signalSchema } from '@patchbay/shared';
import type { Server, Socket } from 'socket.io';
import type { SlidingWindowRateLimiter } from '../rateLimiter.js';
import type { RoomStore } from '../rooms/RoomStore.js';

type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Behind a reverse proxy (Render, Cloudflare Tunnel), the raw TCP peer is the proxy, not the
 * real client; engine.io doesn't apply Express's `trust proxy` setting itself, so this reads
 * `X-Forwarded-For` directly, falling back to the socket address for direct/local connections. */
function getClientIp(socket: TypedSocket): string {
  const forwardedFor = socket.handshake.headers['x-forwarded-for'];
  const first = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0];
  return first?.trim() || socket.handshake.address;
}

function leaveCurrentRoom(io: TypedServer, socket: TypedSocket, roomStore: RoomStore): void {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const leavingMember = roomStore.getMember(roomId, socket.id);
  const remaining = roomStore.leave(roomId, socket.id);
  socket.data.roomId = null;
  void socket.leave(roomId);

  if (remaining !== undefined && leavingMember) {
    io.to(roomId).emit('room:peer-left', leavingMember);
  }
}

export function registerSignalingHandlers(
  io: TypedServer,
  roomStore: RoomStore,
  roomCreateLimiter: SlidingWindowRateLimiter,
): void {
  io.on('connection', (socket) => {
    socket.data.roomId = null;

    socket.on('room:create', (ack) => {
      if (!roomCreateLimiter.isAllowed(getClientIp(socket))) {
        ack({
          ok: false,
          error: { code: 'RATE_LIMITED', message: 'Too many rooms created. Try again shortly.' },
        });
        return;
      }
      const roomId = roomStore.create();
      ack({ ok: true, roomId });
    });

    socket.on('room:join', (payload, ack) => {
      const parsed = roomJoinSchema.safeParse(payload);
      if (!parsed.success) {
        ack({
          ok: false,
          error: { code: 'INVALID_PAYLOAD', message: 'Invalid room id or display name' },
        });
        return;
      }

      if (socket.data.roomId) {
        ack({
          ok: false,
          error: { code: 'ALREADY_IN_ROOM', message: 'Leave your current room first' },
        });
        return;
      }

      const result = roomStore.join(parsed.data.roomId, socket.id, parsed.data.displayName);
      if (!result.ok) {
        ack(result);
        return;
      }

      socket.data.roomId = parsed.data.roomId;
      void socket.join(parsed.data.roomId);
      socket
        .to(parsed.data.roomId)
        .emit('room:peer-joined', { peerId: socket.id, displayName: parsed.data.displayName });
      ack(result);
    });

    socket.on('room:leave', () => {
      leaveCurrentRoom(io, socket, roomStore);
    });

    socket.on('member:state', (payload) => {
      const parsed = memberStateSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn(`dropped malformed member:state payload from ${socket.id}`);
        return;
      }

      const roomId = socket.data.roomId;
      if (!roomId) return;

      socket.to(roomId).emit('room:member-state', { peerId: socket.id, ...parsed.data });
    });

    socket.on('signal', (payload) => {
      const parsed = signalSchema.safeParse(payload);
      if (!parsed.success) {
        console.warn(`dropped malformed signal payload from ${socket.id}`);
        return;
      }

      const roomId = socket.data.roomId;
      if (!roomId) {
        console.warn(`dropped signal from ${socket.id}: not in a room`);
        return;
      }

      const room = roomStore.getMembers(roomId);
      const targetInRoom = room?.some((member) => member.peerId === parsed.data.to);
      if (!targetInRoom) {
        console.warn(
          `dropped signal from ${socket.id}: target ${parsed.data.to} not in room ${roomId}`,
        );
        return;
      }

      io.to(parsed.data.to).emit('signal', { ...parsed.data, from: socket.id });
    });

    socket.on('disconnect', () => {
      leaveCurrentRoom(io, socket, roomStore);
    });
  });
}
