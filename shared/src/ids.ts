import { customAlphabet } from 'nanoid';

// Excludes 0/O/1/l/i and vowel-heavy runs so codes read cleanly aloud on a call.
export const ROOM_ID_ALPHABET = '346789abcdefghjkmnpqrtwxy';
export const ROOM_ID_LENGTH = 6;

export const generateRoomId = customAlphabet(ROOM_ID_ALPHABET, ROOM_ID_LENGTH);

export const ROOM_ID_PATTERN = new RegExp(`^[${ROOM_ID_ALPHABET}]{${ROOM_ID_LENGTH}}$`);
