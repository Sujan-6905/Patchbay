import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomStore } from './RoomStore.js';

describe('RoomStore', () => {
  let store: RoomStore;
  let idCounter: number;

  beforeEach(() => {
    idCounter = 0;
    store = new RoomStore(() => `room-${idCounter++}`);
  });

  it('creates a room with a fresh id', () => {
    const roomId = store.create();
    expect(roomId).toBe('room-0');
    expect(store.has(roomId)).toBe(true);
    expect(store.getMembers(roomId)).toEqual([]);
  });

  it('retries id generation until it finds one that is not already taken', () => {
    const idQueue = ['dup', 'dup', 'fresh'];
    const collidingStore = new RoomStore(() => idQueue.shift() ?? 'unexpected-fallback');
    collidingStore.create(); // takes 'dup'
    const secondRoomId = collidingStore.create();
    expect(secondRoomId).toBe('fresh');
    expect(collidingStore.roomCount()).toBe(2);
  });

  it('has() returns false for an id that was never created', () => {
    expect(store.has('never-created')).toBe(false);
  });

  it('getMember returns undefined for an unknown room or an unknown peer', () => {
    expect(store.getMember('unknown-room', 'peer-a')).toBeUndefined();
    const roomId = store.create();
    store.join(roomId, 'peer-a', 'Alice');
    expect(store.getMember(roomId, 'ghost-peer')).toBeUndefined();
  });

  it('joins a peer to an existing room and returns prior members', () => {
    const roomId = store.create();
    const first = store.join(roomId, 'peer-a', 'Alice');
    expect(first).toEqual({ ok: true, members: [] });

    const second = store.join(roomId, 'peer-b', 'Bob');
    expect(second).toEqual({ ok: true, members: [{ peerId: 'peer-a', displayName: 'Alice' }] });

    expect(store.getMembers(roomId)).toEqual([
      { peerId: 'peer-a', displayName: 'Alice' },
      { peerId: 'peer-b', displayName: 'Bob' },
    ]);
  });

  it('rejects joining a room that does not exist', () => {
    const result = store.join('does-not-exist', 'peer-a', 'Alice');
    expect(result).toEqual({
      ok: false,
      error: { code: 'ROOM_NOT_FOUND', message: expect.any(String) },
    });
  });

  it('rejects a peer joining the same room twice', () => {
    const roomId = store.create();
    store.join(roomId, 'peer-a', 'Alice');
    const result = store.join(roomId, 'peer-a', 'Alice');
    expect(result).toEqual({
      ok: false,
      error: { code: 'ALREADY_IN_ROOM', message: expect.any(String) },
    });
  });

  it('rejects joining once the room is at capacity (4 members)', () => {
    const roomId = store.create();
    store.join(roomId, 'peer-a', 'Alice');
    store.join(roomId, 'peer-b', 'Bob');
    store.join(roomId, 'peer-c', 'Cara');
    store.join(roomId, 'peer-d', 'Dan');

    const result = store.join(roomId, 'peer-e', 'Eve');
    expect(result).toEqual({
      ok: false,
      error: { code: 'ROOM_FULL', message: expect.any(String) },
    });
  });

  it('removes a member on leave and keeps the room alive if others remain', () => {
    const roomId = store.create();
    store.join(roomId, 'peer-a', 'Alice');
    store.join(roomId, 'peer-b', 'Bob');

    const remaining = store.leave(roomId, 'peer-a');
    expect(remaining).toEqual([{ peerId: 'peer-b', displayName: 'Bob' }]);
    expect(store.has(roomId)).toBe(true);
  });

  it('deletes the room once the last member leaves', () => {
    const roomId = store.create();
    store.join(roomId, 'peer-a', 'Alice');

    const remaining = store.leave(roomId, 'peer-a');
    expect(remaining).toEqual([]);
    expect(store.has(roomId)).toBe(false);
  });

  it('leave on an unknown room or member is a no-op returning undefined', () => {
    expect(store.leave('does-not-exist', 'peer-a')).toBeUndefined();

    const roomId = store.create();
    expect(store.leave(roomId, 'ghost-peer')).toBeUndefined();
  });

  it('sweeps empty rooms older than the TTL', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const staleRoomId = store.create();
    vi.setSystemTime(now + 1000);
    const freshRoomId = store.create();

    const removed = store.sweepExpired(500, now + 1000);
    expect(removed).toBe(1);
    expect(store.has(staleRoomId)).toBe(false);
    expect(store.has(freshRoomId)).toBe(true);

    vi.useRealTimers();
  });

  it('does not sweep non-empty rooms even past the TTL', () => {
    const roomId = store.create();
    store.join(roomId, 'peer-a', 'Alice');

    const removed = store.sweepExpired(0, Date.now() + 10_000);
    expect(removed).toBe(0);
    expect(store.has(roomId)).toBe(true);
  });

  it('does not sweep a room exactly at the TTL boundary: only strictly past it', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const roomId = store.create();

    // now - createdAt === 0 === ttlMs; sweepExpired requires strictly greater than ttlMs.
    expect(store.sweepExpired(0, now)).toBe(0);
    expect(store.has(roomId)).toBe(true);

    vi.useRealTimers();
  });

  it('tracks room and member counts', () => {
    const roomA = store.create();
    const roomB = store.create();
    store.join(roomA, 'peer-a', 'Alice');
    store.join(roomA, 'peer-b', 'Bob');
    store.join(roomB, 'peer-c', 'Cara');

    expect(store.roomCount()).toBe(2);
    expect(store.memberCount()).toBe(3);
  });
});
