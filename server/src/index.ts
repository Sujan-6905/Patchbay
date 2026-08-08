import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@patchbay/shared';
import { config } from './config.js';
import { createAiRouter } from './api/ai.js';
import { createHealthRouter } from './api/health.js';
import { createRoomsRouter } from './api/rooms.js';
import { createTurnConfigRouter } from './api/turnConfig.js';
import { SlidingWindowRateLimiter } from './rateLimiter.js';
import { RoomStore } from './rooms/RoomStore.js';
import { registerSignalingHandlers } from './signaling/index.js';
import { generateRoomId } from '@patchbay/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Behind a reverse proxy (Render, Cloudflare Tunnel) so req.ip reflects the real client
// rather than the proxy; required for express-rate-limit's per-IP keying to be meaningful.
app.set('trust proxy', 1);
app.use(
  helmet({
    // Disabled rather than misconfigured: background blur's MediaPipe model/WASM load from
    // cdn.jsdelivr.net/storage.googleapis.com, and a default same-origin CSP would silently
    // break that feature. Every other helmet protection (frameguard, HSTS, noSniff, etc.)
    // still applies.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json());

const roomStore = new RoomStore(generateRoomId);
const roomCreateLimiter = new SlidingWindowRateLimiter(
  config.roomCreateRateLimitWindowMs,
  config.roomCreateRateLimitMax,
);

app.use('/api', createHealthRouter(roomStore));
app.use('/api', createTurnConfigRouter());
app.use('/api', createRoomsRouter(roomStore));
app.use('/api', createAiRouter());

// In production the client is built into client/dist and served from here so the whole
// app runs as a single free-tier instance (ADR-1/ADR-2).
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (_req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  {
    cors: { origin: config.corsOrigin },
    maxHttpBufferSize: config.socketMaxPayloadBytes,
  },
);

registerSignalingHandlers(io, roomStore, roomCreateLimiter);

const SWEEP_INTERVAL_MS = 60_000;
setInterval(() => {
  roomStore.sweepExpired(config.roomTtlMinutes * 60_000);
  roomCreateLimiter.sweep();
}, SWEEP_INTERVAL_MS).unref();

httpServer.listen(config.port, () => {
  console.log(`server listening on http://localhost:${config.port} (${config.nodeEnv})`);
});
