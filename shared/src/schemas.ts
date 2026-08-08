import { z } from 'zod';
import { MAX_CAPTION_LENGTH, MAX_DISPLAY_NAME_LENGTH } from './constants.js';
import { ROOM_ID_PATTERN } from './ids.js';

export const roomIdSchema = z.string().regex(ROOM_ID_PATTERN, 'invalid room id');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'display name is required')
  .max(
    MAX_DISPLAY_NAME_LENGTH,
    `display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`,
  );

export const sessionDescriptionSchema = z.object({
  type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
  sdp: z.string().optional(),
});

export const iceCandidateSchema = z.object({
  candidate: z.string().optional(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().nullable().optional(),
});

export const roomJoinSchema = z.object({
  roomId: roomIdSchema,
  displayName: displayNameSchema,
});

export const memberStateSchema = z.object({
  micEnabled: z.boolean(),
  camEnabled: z.boolean(),
  sharingScreen: z.boolean(),
});

/** Validates data-channel messages received from a peer: untrusted input, same as anything from the network, even though the server never sees these. */
export const dataChannelMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chat'),
    id: z.string().min(1),
    text: z.string().min(1).max(2000),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('reaction'),
    emoji: z.string().min(1).max(8),
    timestamp: z.number(),
  }),
  z.object({
    type: z.literal('file-meta'),
    fileId: z.string().min(1),
    // Display only; never used to interpret the received bytes (see Room.tsx's file-done
    // handler), so this only needs to reject garbage, not double as a content-type allowlist.
    name: z.string().min(1).max(255),
    size: z.number().positive(),
    mimeType: z
      .string()
      .max(255)
      .regex(/^[\w.+-]+\/[\w.+-]+$/, 'invalid MIME type'),
  }),
  z.object({
    type: z.literal('file-done'),
    fileId: z.string().min(1),
  }),
  z.object({
    type: z.literal('caption'),
    text: z.string().max(MAX_CAPTION_LENGTH),
    isFinal: z.boolean(),
    timestamp: z.number(),
  }),
]);

export const signalSchema = z
  .object({
    to: z.string().min(1),
    description: sessionDescriptionSchema.optional(),
    candidate: iceCandidateSchema.optional(),
  })
  .refine((data) => Boolean(data.description) !== Boolean(data.candidate), {
    message: 'signal payload must contain exactly one of description or candidate',
  });

export type RoomJoinInput = z.infer<typeof roomJoinSchema>;
export type SignalInput = z.infer<typeof signalSchema>;
export type MemberStateInput = z.infer<typeof memberStateSchema>;
export type DataChannelMessageInput = z.infer<typeof dataChannelMessageSchema>;
