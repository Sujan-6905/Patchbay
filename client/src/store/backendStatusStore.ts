import { create } from 'zustand';
import { apiUrl } from '../lib/apiBase';

export type BackendStatus = 'checking' | 'waking' | 'ready' | 'unreachable';

interface BackendStatusState {
  status: BackendStatus;
  /** Bumped on every blocked click so listeners (the status banner) can re-trigger an
   * attention animation even when the status itself hasn't changed. */
  attentionPing: number;
}

export const useBackendStatusStore = create<BackendStatusState>(() => ({
  status: 'checking',
  attentionPing: 0,
}));

/** Shown when a specific request to the backend fails outright, as opposed to the generic
 * status pill's wording, which describes the connection state rather than a failed action. */
export const SERVER_UNREACHABLE_MESSAGE =
  "Couldn't reach the server. It may have gone back to sleep, wait a moment and try again.";

export function describeBackendStatus(status: BackendStatus): string {
  switch (status) {
    case 'checking':
      return 'Connecting to the server…';
    case 'waking':
      return 'The server is waking up from a free-tier cold start (usually under a minute). Feel free to explore the page while you wait.';
    case 'unreachable':
      return "Couldn't reach the server. Check your connection and try again.";
    case 'ready':
      return "Connected. You're all set to start or join a call.";
  }
}

/** Draws attention to the status indicator, called when a backend-gated action is clicked
 * while the server still isn't ready, so the "why can't I click this" answer is visible. */
export function pulseBackendStatusAttention(): void {
  useBackendStatusStore.setState((state) => ({ attentionPing: state.attentionPing + 1 }));
}

const HEALTH_CHECK_TIMEOUT_MS = 4_000;
const RETRY_INTERVAL_MS = 5_000;
/** How often to re-check once the backend is reported ready. Catches a mid-session
 * cold-shutdown even when nothing happens to be mid-request at that moment. */
const READY_HEARTBEAT_INTERVAL_MS = 15_000;
const GIVE_UP_AFTER_MS = 3 * 60_000;

async function isBackendUp(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl('/api/health'), { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let monitoring = false;
let downSince: number | null = null;

/** Runs for as long as the tab is open: confirms the backend is reachable, keeps a light
 * heartbeat going once it is, and retries on a short interval while it isn't, until it's
 * been down continuously for GIVE_UP_AFTER_MS. At that point it stops and waits for a
 * manual retry instead of polling forever. A no-op if already running. */
async function monitor(): Promise<void> {
  if (monitoring) return;
  monitoring = true;
  try {
    for (;;) {
      const up = await isBackendUp();
      if (up) {
        downSince = null;
        useBackendStatusStore.setState({ status: 'ready' });
        await sleep(READY_HEARTBEAT_INTERVAL_MS);
        continue;
      }

      downSince ??= Date.now();
      if (Date.now() - downSince >= GIVE_UP_AFTER_MS) {
        useBackendStatusStore.setState({ status: 'unreachable' });
        return;
      }
      useBackendStatusStore.setState({ status: 'waking' });
      await sleep(RETRY_INTERVAL_MS);
    }
  } finally {
    monitoring = false;
  }
}

/** Starts the health-check/monitor loop, as early as possible so the server has the whole
 * time a visitor spends reading the home page to spin back up. Safe to call more than once. */
export function startBackendWake(): void {
  void monitor();
}

/** Called by any backend-dependent request the moment it fails or times out. Reacts
 * immediately instead of waiting for the next heartbeat, and re-arms the monitor loop if it
 * had already stopped (e.g. after a prior give-up). */
export function reportBackendDown(): void {
  if (useBackendStatusStore.getState().status !== 'unreachable') {
    useBackendStatusStore.setState({ status: 'waking' });
  }
  downSince ??= Date.now();
  void monitor();
}

/** Re-arms the sequence after the monitor gave up, for a manual retry. */
export function retryBackendWake(): void {
  downSince = null;
  useBackendStatusStore.setState({ status: 'checking' });
  void monitor();
}
