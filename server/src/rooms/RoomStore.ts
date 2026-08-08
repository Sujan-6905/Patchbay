import { MAX_ROOM_MEMBERS } from '@patchbay/shared';
import type { RoomError, RoomMember } from '@patchbay/shared';

interface Room {
  id: string;
  members: Map<string, RoomMember>;
  createdAt: number;
  lastActivityAt: number;
}

export type RoomJoinResult = { ok: true; members: RoomMember[] } | { ok: false; error: RoomError };

/**
 * Pure, in-memory room membership store. No Socket.IO dependency; socket handlers are
 * thin wrappers around this. A Redis-backed implementation could satisfy the same
 * interface to support horizontal scaling later.
 */
export class RoomStore {
  private rooms = new Map<string, Room>();

  constructor(private readonly generateId: () => string) {}

  create(): string {
    let id = this.generateId();
    while (this.rooms.has(id)) {
      id = this.generateId();
    }
    const now = Date.now();
    this.rooms.set(id, { id, members: new Map(), createdAt: now, lastActivityAt: now });
    return id;
  }

  join(roomId: string, peerId: string, displayName: string): RoomJoinResult {
    const room = this.rooms.get(roomId);
    if (!room) {
      return {
        ok: false,
        error: { code: 'ROOM_NOT_FOUND', message: `Room ${roomId} does not exist` },
      };
    }
    if (room.members.has(peerId)) {
      return {
        ok: false,
        error: { code: 'ALREADY_IN_ROOM', message: 'Already a member of this room' },
      };
    }
    if (room.members.size >= MAX_ROOM_MEMBERS) {
      return {
        ok: false,
        error: {
          code: 'ROOM_FULL',
          message: `Room is full (${MAX_ROOM_MEMBERS}/${MAX_ROOM_MEMBERS})`,
        },
      };
    }
    const existingMembers = Array.from(room.members.values());
    room.members.set(peerId, { peerId, displayName });
    room.lastActivityAt = Date.now();
    return { ok: true, members: existingMembers };
  }

  /** Removes a member and deletes the room if it becomes empty. Returns the remaining members, or undefined if the room/member didn't exist. */
  leave(roomId: string, peerId: string): RoomMember[] | undefined {
    const room = this.rooms.get(roomId);
    if (!room || !room.members.has(peerId)) return undefined;
    room.members.delete(peerId);
    room.lastActivityAt = Date.now();
    if (room.members.size === 0) {
      this.rooms.delete(roomId);
      return [];
    }
    return Array.from(room.members.values());
  }

  getMembers(roomId: string): RoomMember[] | undefined {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.members.values()) : undefined;
  }

  getMember(roomId: string, peerId: string): RoomMember | undefined {
    return this.rooms.get(roomId)?.members.get(peerId);
  }

  has(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  memberCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.members.size;
    return total;
  }

  /** Removes rooms that were created but never joined (or emptied) within `ttlMs`. */
  sweepExpired(ttlMs: number, now = Date.now()): number {
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (room.members.size === 0 && now - room.createdAt > ttlMs) {
        this.rooms.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
