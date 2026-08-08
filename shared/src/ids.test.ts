import { describe, expect, it } from 'vitest';
import { generateRoomId, ROOM_ID_PATTERN } from './ids.js';

describe('generateRoomId', () => {
  it('produces ids matching the room id pattern', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateRoomId()).toMatch(ROOM_ID_PATTERN);
    }
  });

  it('excludes ambiguous characters', () => {
    const id = generateRoomId();
    expect(id).not.toMatch(/[0oO1lI]/);
  });
});
