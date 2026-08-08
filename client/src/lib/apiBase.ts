/** Backend origin the client talks to. Empty in local dev and in a same-origin production
 * build (Vite's dev proxy / the server's own static hosting handle /api and /socket.io as
 * relative paths there). Set only when the client is deployed separately from the signaling
 * server, e.g. a Vercel-hosted frontend pointed at a Render backend. */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

/** How long a REST call to the backend waits before giving up. A free-tier instance that has
 * gone back to sleep mid-session otherwise leaves a plain `fetch` hanging well past anything a
 * user would wait out. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

export async function fetchWithTimeout(
  path: string,
  init?: RequestInit,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(apiUrl(path), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
