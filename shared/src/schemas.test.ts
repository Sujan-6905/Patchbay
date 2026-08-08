import { describe, expect, it } from 'vitest';
import { MAX_CAPTION_LENGTH, MAX_DISPLAY_NAME_LENGTH } from './constants.js';
import { generateRoomId } from './ids.js';
import {
  dataChannelMessageSchema,
  displayNameSchema,
  iceCandidateSchema,
  memberStateSchema,
  roomIdSchema,
  roomJoinSchema,
  sessionDescriptionSchema,
  signalSchema,
} from './schemas.js';

describe('roomIdSchema', () => {
  it('accepts a freshly generated room id', () => {
    expect(roomIdSchema.safeParse(generateRoomId()).success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(roomIdSchema.safeParse('').success).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(roomIdSchema.safeParse(12345).success).toBe(false);
  });
});

describe('displayNameSchema', () => {
  it('accepts a display name at exactly the length limit', () => {
    const result = displayNameSchema.safeParse('x'.repeat(MAX_DISPLAY_NAME_LENGTH));
    expect(result.success).toBe(true);
  });

  it('rejects a display name one character over the limit', () => {
    const result = displayNameSchema.safeParse('x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1));
    expect(result.success).toBe(false);
  });
});

describe('sessionDescriptionSchema', () => {
  it('accepts every valid RTCSdpType', () => {
    for (const type of ['offer', 'answer', 'pranswer', 'rollback']) {
      expect(sessionDescriptionSchema.safeParse({ type, sdp: 'v=0...' }).success).toBe(true);
    }
  });

  it('accepts a description with no sdp (rollback has none)', () => {
    expect(sessionDescriptionSchema.safeParse({ type: 'rollback' }).success).toBe(true);
  });

  it('rejects an invalid type', () => {
    expect(sessionDescriptionSchema.safeParse({ type: 'garbage' }).success).toBe(false);
  });
});

describe('iceCandidateSchema', () => {
  it('accepts a full candidate', () => {
    const result = iceCandidateSchema.safeParse({
      candidate: 'candidate:1 1 UDP 2130706431 10.0.0.1 12345 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'abcd',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty candidate object (end-of-candidates signal)', () => {
    expect(iceCandidateSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a non-numeric sdpMLineIndex', () => {
    expect(iceCandidateSchema.safeParse({ sdpMLineIndex: '0' }).success).toBe(false);
  });
});

describe('roomJoinSchema', () => {
  it('accepts a valid room id and display name', () => {
    const result = roomJoinSchema.safeParse({ roomId: generateRoomId(), displayName: 'Ada' });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed room id', () => {
    const result = roomJoinSchema.safeParse({ roomId: 'not-a-room-id!!', displayName: 'Ada' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing room id', () => {
    const result = roomJoinSchema.safeParse({ displayName: 'Ada' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty display name', () => {
    const result = roomJoinSchema.safeParse({ roomId: generateRoomId(), displayName: '  ' });
    expect(result.success).toBe(false);
  });

  it('rejects a display name over the length limit', () => {
    const result = roomJoinSchema.safeParse({
      roomId: generateRoomId(),
      displayName: 'x'.repeat(31),
    });
    expect(result.success).toBe(false);
  });

  it('trims a display name with surrounding whitespace', () => {
    const result = roomJoinSchema.safeParse({ roomId: generateRoomId(), displayName: '  Ada  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.displayName).toBe('Ada');
  });
});

describe('memberStateSchema', () => {
  it('accepts a valid mic/cam/screen-share state', () => {
    const result = memberStateSchema.safeParse({
      micEnabled: true,
      camEnabled: false,
      sharingScreen: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-boolean field', () => {
    const result = memberStateSchema.safeParse({
      micEnabled: 'yes',
      camEnabled: false,
      sharingScreen: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing field', () => {
    const result = memberStateSchema.safeParse({ micEnabled: true, camEnabled: false });
    expect(result.success).toBe(false);
  });
});

describe('signalSchema', () => {
  it('accepts a payload with only a description', () => {
    const result = signalSchema.safeParse({
      to: 'peer-1',
      description: { type: 'offer', sdp: 'v=0...' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a payload with only a candidate', () => {
    const result = signalSchema.safeParse({
      to: 'peer-1',
      candidate: { candidate: 'candidate:1 1 UDP...', sdpMid: '0', sdpMLineIndex: 0 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a payload with neither description nor candidate', () => {
    const result = signalSchema.safeParse({ to: 'peer-1' });
    expect(result.success).toBe(false);
  });

  it('rejects a payload with both description and candidate', () => {
    const result = signalSchema.safeParse({
      to: 'peer-1',
      description: { type: 'offer', sdp: 'v=0...' },
      candidate: { candidate: 'candidate:1 1 UDP...' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid sdp type', () => {
    const result = signalSchema.safeParse({
      to: 'peer-1',
      description: { type: 'bogus', sdp: 'v=0...' },
    });
    expect(result.success).toBe(false);
  });
});

describe('dataChannelMessageSchema', () => {
  it('accepts a chat message', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'chat',
      id: 'msg-1',
      text: 'hello',
      timestamp: 1_700_000_000_000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a reaction message', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'reaction',
      emoji: '🎉',
      timestamp: 1_700_000_000_000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts file-meta and file-done messages', () => {
    expect(
      dataChannelMessageSchema.safeParse({
        type: 'file-meta',
        fileId: 'f1',
        name: 'photo.png',
        size: 1024,
        mimeType: 'image/png',
      }).success,
    ).toBe(true);
    expect(dataChannelMessageSchema.safeParse({ type: 'file-done', fileId: 'f1' }).success).toBe(
      true,
    );
  });

  it('rejects a file-meta message with a malformed MIME type', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'file-meta',
      fileId: 'f1',
      name: 'evil.html',
      size: 1024,
      mimeType: 'text/html; oops <script>',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a file-meta message with an oversized name', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'file-meta',
      fileId: 'f1',
      name: 'x'.repeat(256),
      size: 1024,
      mimeType: 'image/png',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown message type', () => {
    const result = dataChannelMessageSchema.safeParse({ type: 'bogus', text: 'nope' });
    expect(result.success).toBe(false);
  });

  it('accepts a caption message', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'caption',
      text: 'hello there',
      isFinal: true,
      timestamp: 1_700_000_000_000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a caption message missing isFinal', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'caption',
      text: 'hello there',
      timestamp: 1_700_000_000_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a caption message over the length limit', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'caption',
      text: 'x'.repeat(MAX_CAPTION_LENGTH + 1),
      isFinal: false,
      timestamp: 1_700_000_000_000,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a caption message at exactly the length limit', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'caption',
      text: 'x'.repeat(MAX_CAPTION_LENGTH),
      isFinal: false,
      timestamp: 1_700_000_000_000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a chat message with empty text', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'chat',
      id: 'msg-1',
      text: '',
      timestamp: 1_700_000_000_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a chat message with text over the 2000-character limit', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'chat',
      id: 'msg-1',
      text: 'x'.repeat(2001),
      timestamp: 1_700_000_000_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a reaction message with an oversized emoji field', () => {
    const result = dataChannelMessageSchema.safeParse({
      type: 'reaction',
      emoji: 'x'.repeat(9),
      timestamp: 1_700_000_000_000,
    });
    expect(result.success).toBe(false);
  });
});
