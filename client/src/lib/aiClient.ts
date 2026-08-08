import { apiUrl } from './apiBase';

interface SummarizeErrorBody {
  error: string;
}

/** Streams a meeting summary from POST /api/ai/summarize. The AI feature is provided by the
 * server (its own Groq key, free for users); the only thing that ever leaves this browser is
 * the transcript itself, and only at the moment the user clicks "Summarize meeting". */
export async function summarizeTranscript(
  transcript: string,
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await fetch(apiUrl('/api/ai/summarize'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as SummarizeErrorBody | null;
    throw new Error(body?.error ?? 'Could not generate a summary.');
  }
  if (!res.body) throw new Error('Empty response from the summarize endpoint.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}
