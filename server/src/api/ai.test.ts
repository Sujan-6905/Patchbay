import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiRouter } from './ai.js';

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api', createAiRouter());
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

/** A minimal POST helper using node:http directly; deliberately not `fetch`, since the
 * provider call inside the route handler under test is mocked via a `fetch` spy, and using
 * `fetch` here too would route this request through that same mock. */
function post(
  baseUrl: string,
  path: string,
  body: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = httpRequest(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf-8');
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text: data }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

describe('POST /api/ai/summarize', () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl: string;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    ({ server, baseUrl } = await startTestServer());
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('GROQ_API_KEY', 'gsk-test-key');
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects an empty transcript', async () => {
    const res = await post(baseUrl, '/api/ai/summarize', JSON.stringify({ transcript: '' }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('responds 503 when no server key is configured, without calling the provider', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    const res = await post(baseUrl, '/api/ai/summarize', JSON.stringify({ transcript: 'hello' }));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('streams back the extracted text from the Groq SSE response using the server key', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"world"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    fetchSpy.mockResolvedValue(new Response(sse, { status: 200 }));

    const res = await post(baseUrl, '/api/ai/summarize', JSON.stringify({ transcript: 'hello' }));

    expect(res.status).toBe(200);
    expect(res.text).toBe('Hello world');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('api.groq.com');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk-test-key');
  });

  it('maps a provider 401 to a friendly error without leaking the raw provider body', async () => {
    fetchSpy.mockResolvedValue(new Response('unauthorized', { status: 401 }));

    const res = await post(baseUrl, '/api/ai/summarize', JSON.stringify({ transcript: 'hello' }));

    expect(res.status).toBe(401);
    const body = JSON.parse(res.text) as { error: string };
    expect(body.error).not.toContain('unauthorized');
  });

  it('never logs or echoes the server key', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockResolvedValue(new Response('', { status: 500 }));

    const res = await post(baseUrl, '/api/ai/summarize', JSON.stringify({ transcript: 'hello' }));

    expect(res.text).not.toContain('gsk-test-key');
    for (const call of consoleSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('gsk-test-key');
    }
    consoleSpy.mockRestore();
  });
});
