import type { ClientToServerEvents, ServerToClientEvents } from '@patchbay/shared';
import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from './apiBase';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  socket ??= io(API_BASE_URL || undefined, { autoConnect: true });
  return socket;
}
