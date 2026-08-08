export const MAX_ROOM_MEMBERS = 4;

export const ROOM_TTL_MINUTES_DEFAULT = 30;

export const MAX_DISPLAY_NAME_LENGTH = 30;

/** Fixed id + label for the negotiated RTCDataChannel each peer connection opens alongside media: "negotiated" mode means both sides declare it upfront, so it's usable without extra renegotiation. */
export const DATA_CHANNEL_ID = 0;
export const DATA_CHANNEL_LABEL = 'patchbay';

export const FILE_CHUNK_SIZE = 16 * 1024;
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
/** `bufferedAmountLowThreshold` for chunked file sends; backpressure pauses sending past this. */
export const BUFFERED_AMOUNT_LOW_THRESHOLD = 256 * 1024;

export const MAX_CAPTION_LENGTH = 500;

/** Hard cap on transcript size sent to /api/ai/summarize; oldest entries are truncated first. */
export const MAX_SUMMARIZE_TRANSCRIPT_CHARS = 24_000;
