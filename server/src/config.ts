import { ROOM_TTL_MINUTES_DEFAULT } from '@patchbay/shared';

/** CORS_ORIGIN accepts one origin or a comma-separated list; a split frontend/backend
 * deployment needs both the production origin and every preview-deployment origin allowed.
 * Trailing slashes are stripped: the `Origin` header a browser sends is always bare
 * scheme+host+port, so a copy-pasted "https://example.com/" would otherwise never match. */
function parseCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  const origins = raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const [single] = origins;
  return origins.length === 1 && single ? single : origins;
}

function parseTurnServers(): RTCIceServerConfig[] {
  const urls = process.env.TURN_URLS;
  if (!urls) return [];
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;
  return [
    {
      urls: urls.split(',').map((u) => u.trim()),
      ...(username ? { username } : {}),
      ...(credential ? { credential } : {}),
    },
  ];
}

export interface RTCIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const config = {
  port: Number(process.env.PORT ?? 5001),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: parseCorsOrigin(),
  roomTtlMinutes: Number(process.env.ROOM_TTL_MINUTES ?? ROOM_TTL_MINUTES_DEFAULT),
  aiRateLimitWindowMs: Number(process.env.AI_RATE_LIMIT_WINDOW_MS ?? 60_000),
  aiRateLimitMax: Number(process.env.AI_RATE_LIMIT_MAX ?? 5),
  roomCreateRateLimitWindowMs: Number(process.env.ROOM_CREATE_RATE_LIMIT_WINDOW_MS ?? 60_000),
  roomCreateRateLimitMax: Number(process.env.ROOM_CREATE_RATE_LIMIT_MAX ?? 10),
  /** Socket.IO's own payload cap for signaling messages (SDP/ICE); generous for a large SDP
   * with many ICE candidates, but small enough to reject abuse; DataChannel media/file
   * transfer never goes through this server at all, so it doesn't need to account for those. */
  socketMaxPayloadBytes: Number(process.env.SOCKET_MAX_PAYLOAD_BYTES ?? 128 * 1024),
  /** Server-held Groq key powering the built-in (free for users) meeting summaries. A getter
   * so tests can stub the env var per-case; never sent to or visible from the client. */
  get groqApiKey(): string {
    return process.env.GROQ_API_KEY ?? '';
  },
  get iceServers(): RTCIceServerConfig[] {
    return [{ urls: ['stun:stun.l.google.com:19302'] }, ...parseTurnServers()];
  },
};
