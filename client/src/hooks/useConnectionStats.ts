import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { PeerStatsSnapshot } from '../lib/parseStatsReport';
import type { PeerManager } from '../lib/PeerManager';

export interface StatsSample {
  timestamp: number;
  outboundKbps: number;
  inboundKbps: number;
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
  candidateType: string | null;
  codec: string | null;
}

const POLL_INTERVAL_MS = 2000;
const HISTORY_LENGTH = 30;

function toSample(current: PeerStatsSnapshot, previous: PeerStatsSnapshot | undefined): StatsSample {
  const elapsedSeconds = previous ? (current.timestamp - previous.timestamp) / 1000 : 0;
  const outboundKbps =
    previous && elapsedSeconds > 0
      ? Math.max(0, ((current.bytesSent - previous.bytesSent) * 8) / elapsedSeconds / 1000)
      : 0;
  const inboundKbps =
    previous && elapsedSeconds > 0
      ? Math.max(0, ((current.bytesReceived - previous.bytesReceived) * 8) / elapsedSeconds / 1000)
      : 0;

  const packetsDelta = previous
    ? current.packetsReceived - previous.packetsReceived
    : current.packetsReceived;
  const lostDelta = previous ? current.packetsLost - previous.packetsLost : current.packetsLost;
  const totalDelta = packetsDelta + lostDelta;
  const packetLossPercent = totalDelta > 0 ? Math.max(0, (lostDelta / totalDelta) * 100) : null;

  return {
    timestamp: current.timestamp,
    outboundKbps,
    inboundKbps,
    rttMs: current.roundTripTime !== null ? current.roundTripTime * 1000 : null,
    jitterMs: current.jitter !== null ? current.jitter * 1000 : null,
    packetLossPercent,
    candidateType: current.candidateType,
    codec: current.codec,
  };
}

/** Polls `PeerManager.getStats()` every 2s while `enabled`, turning the cumulative counters
 * it returns into per-interval bitrate/loss-rate samples and keeping a bounded rolling
 * history per peer (for sparklines); nothing is retained once `enabled` goes false. */
export function useConnectionStats(
  peerManagerRef: RefObject<PeerManager | null>,
  peerIds: string[],
  enabled: boolean,
): Record<string, StatsSample[]> {
  const [history, setHistory] = useState<Record<string, StatsSample[]>>({});
  const peerIdsRef = useRef(peerIds);
  useEffect(() => {
    peerIdsRef.current = peerIds;
  }, [peerIds]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let previousSnapshots: Record<string, PeerStatsSnapshot> = {};

    const tick = async () => {
      const manager = peerManagerRef.current;
      if (!manager) return;
      const snapshots = await manager.getStats();
      if (cancelled) return;

      setHistory((prevHistory) => {
        const next = { ...prevHistory };
        for (const peerId of peerIdsRef.current) {
          const snapshot = snapshots[peerId];
          if (!snapshot) continue;
          const sample = toSample(snapshot, previousSnapshots[peerId]);
          const existing = next[peerId] ?? [];
          next[peerId] = [...existing, sample].slice(-HISTORY_LENGTH);
        }
        return next;
      });
      previousSnapshots = snapshots;
    };

    void tick();
    const interval = setInterval(() => void tick(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      setHistory({});
    };
  }, [enabled, peerManagerRef]);

  return history;
}
