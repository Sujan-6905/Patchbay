import type { RoomError } from './errors.js';
import type { IceCandidateInit, SessionDescriptionInit } from './rtc-types.js';

export interface RoomMember {
  peerId: string;
  displayName: string;
}

export interface MemberState {
  micEnabled: boolean;
  camEnabled: boolean;
  sharingScreen: boolean;
}

/**
 * Messages multiplexed over each peer connection's data channel: chat, reactions, and the
 * file-transfer control messages (the chunks themselves are sent as raw binary, not JSON).
 * Peer-to-peer only: the signaling server never sees any of these.
 */
export interface ChatChannelMessage {
  type: 'chat';
  id: string;
  text: string;
  timestamp: number;
}

export interface ReactionChannelMessage {
  type: 'reaction';
  emoji: string;
  timestamp: number;
}

export interface FileMetaChannelMessage {
  type: 'file-meta';
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
}

export interface FileDoneChannelMessage {
  type: 'file-done';
  fileId: string;
}

/** Broadcast on every partial/final Web Speech API result; the receiver already knows the
 * sender from the channel itself (like reactions), so no speaker id is carried in the payload. */
export interface CaptionChannelMessage {
  type: 'caption';
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export type DataChannelMessage =
  | ChatChannelMessage
  | ReactionChannelMessage
  | FileMetaChannelMessage
  | FileDoneChannelMessage
  | CaptionChannelMessage;

export interface SignalPayload {
  to: string;
  description?: SessionDescriptionInit;
  candidate?: IceCandidateInit;
}

export interface IncomingSignalPayload extends SignalPayload {
  from: string;
}

export type RoomCreateAck = { ok: true; roomId: string } | { ok: false; error: RoomError };

export type RoomJoinPayload = { roomId: string; displayName: string };

export type RoomJoinAck = { ok: true; members: RoomMember[] } | { ok: false; error: RoomError };

export interface ClientToServerEvents {
  'room:create': (ack: (res: RoomCreateAck) => void) => void;
  'room:join': (payload: RoomJoinPayload, ack: (res: RoomJoinAck) => void) => void;
  'room:leave': () => void;
  'member:state': (payload: MemberState) => void;
  signal: (payload: SignalPayload) => void;
}

export interface ServerToClientEvents {
  'room:peer-joined': (payload: RoomMember) => void;
  'room:peer-left': (payload: RoomMember) => void;
  'room:member-state': (payload: MemberState & { peerId: string }) => void;
  signal: (payload: IncomingSignalPayload) => void;
}

export type InterServerEvents = Record<string, never>;

export interface SocketData {
  roomId: string | null;
}
