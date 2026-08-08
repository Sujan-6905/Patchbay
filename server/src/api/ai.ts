import { MAX_SUMMARIZE_TRANSCRIPT_CHARS } from '@patchbay/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';

const SYSTEM_PROMPT = `You are summarizing a video call transcript for the participants. Produce a
concise Markdown summary with exactly these sections:
## Overview
## Decisions
## Action Items
List action items as "- [Owner] task" when a speaker can be identified, otherwise "- task".
Only use information present in the transcript; do not invent details.`;

const summarizeBodySchema = z.object({
  transcript: z.string().min(1),
});

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

/** Ceiling on the whole provider round-trip (connect + stream). Summaries are short; anything
 * past this is a hung upstream, and without it a stalled Groq connection would hold the
 * client's request open forever. */
const PROVIDER_TIMEOUT_MS = 60_000;

function extractSseDelta(payload: unknown): string | null {
  const choice = (payload as { choices?: { delta?: { content?: string } }[] }).choices?.[0];
  return choice?.delta?.content ?? null;
}

/** Parses an SSE byte stream into a sequence of text deltas, tolerant of chunk boundaries splitting a line. */
async function* iterateSseTextDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice('data:'.length).trim();
        if (payload === '[DONE]') return;
        let json: unknown;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const text = extractSseDelta(json);
        if (text) yield text;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function friendlyProviderError(status: number): string {
  if (status === 401 || status === 403) {
    return 'The AI service is misconfigured on this server. Please let the site owner know.';
  }
  if (status === 429) {
    return 'The AI service is busy right now. Wait a moment and try again.';
  }
  return 'The AI service could not complete the summary right now.';
}

export function createAiRouter(): Router {
  const router = Router();

  const summarizeLimiter = rateLimit({
    windowMs: config.aiRateLimitWindowMs,
    max: config.aiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many summarize requests. Wait a moment and try again.' },
  });

  router.post('/ai/summarize', summarizeLimiter, (req, res) => {
    const parsed = summarizeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid request body' });
      return;
    }

    // The summarizing key is ours (GROQ_API_KEY in the server's environment), so summaries
    // are free for users: no BYOK, nothing to paste. The key never appears in any response
    // or log line.
    const apiKey = config.groqApiKey;
    if (!apiKey) {
      res.status(503).json({ error: 'AI summaries are not configured on this server.' });
      return;
    }

    const transcript =
      parsed.data.transcript.length > MAX_SUMMARIZE_TRANSCRIPT_CHARS
        ? parsed.data.transcript.slice(-MAX_SUMMARIZE_TRANSCRIPT_CHARS)
        : parsed.data.transcript;

    fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: transcript },
        ],
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
      .then(async (providerRes) => {
        if (!providerRes.ok) {
          console.error(`ai summarize: provider responded ${providerRes.status}`);
          res.status(providerRes.status).json({ error: friendlyProviderError(providerRes.status) });
          return;
        }
        if (!providerRes.body) {
          res.status(502).json({ error: 'The AI service returned an empty response.' });
          return;
        }

        res.status(200);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        for await (const chunk of iterateSseTextDeltas(providerRes.body)) {
          res.write(chunk);
        }
        res.end();
      })
      .catch((err: unknown) => {
        console.error('ai summarize: provider request failed', err);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Could not reach the AI service.' });
        } else {
          res.end();
        }
      });
  });

  return router;
}
