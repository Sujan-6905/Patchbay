export interface PeerStatsSnapshot {
  timestamp: number;
  bytesSent: number;
  bytesReceived: number;
  packetsLost: number;
  packetsReceived: number;
  /** Seconds, from the video inbound-rtp stream (audio has its own, less interesting for a
   * connection-quality dashboard; a call is usually video-bound). */
  jitter: number | null;
  /** Seconds, from the nominated candidate-pair. */
  roundTripTime: number | null;
  /** 'host' | 'srflx' | 'relay' | 'prflx': TypeScript's DOM lib doesn't model
   * local-candidate/remote-candidate stats yet, so this is read off an untyped field. */
  candidateType: string | null;
  /** e.g. 'video/VP8': the video sender's (falling back to receiver's) negotiated codec. */
  codec: string | null;
}

/**
 * Extracts one connection-level snapshot from a raw `RTCPeerConnection.getStats()` report:
 * the nominated candidate-pair for transport bytes/RTT/candidate-pair type (the "is this call
 * going through TURN?" question), and the video RTP streams for jitter/codec. Bitrate is a
 * derivative of the cumulative byte counters here; computed by the caller across two polls,
 * not by this function (it only sees one point in time).
 */
export function parseStatsReport(report: RTCStatsReport): PeerStatsSnapshot {
  // The spec defines RTCStatsReport as Map-like (and every engine implements it as an actual
  // Map), but TypeScript's bundled dom lib only declares `.forEach` on it; cast once so a
  // plain for-of loop can be used below. (A `.forEach` callback works too, but TS's
  // control-flow narrowing for `let` variables reassigned only inside a nested closure widens
  // them to `never` at every later read, a real, documented TS limitation, not a typo here.)
  const stats = report as unknown as Map<string, RTCStats>;

  let candidatePair: RTCIceCandidatePairStats | null = null;
  let videoInbound: RTCInboundRtpStreamStats | null = null;
  let videoOutbound: RTCOutboundRtpStreamStats | null = null;
  let totalPacketsLost = 0;
  let totalPacketsReceived = 0;
  const codecMimeTypeById = new Map<string, string>();

  for (const stat of stats.values()) {
    if (stat.type === 'codec') {
      const mimeType = (stat as RTCStats & { mimeType?: string }).mimeType;
      if (mimeType) codecMimeTypeById.set(stat.id, mimeType);
    } else if (stat.type === 'inbound-rtp') {
      const inbound = stat as RTCInboundRtpStreamStats;
      totalPacketsLost += inbound.packetsLost ?? 0;
      totalPacketsReceived += inbound.packetsReceived ?? 0;
      if (inbound.kind === 'video') videoInbound = inbound;
    } else if (stat.type === 'outbound-rtp') {
      const outbound = stat as RTCOutboundRtpStreamStats;
      if (outbound.kind === 'video') videoOutbound = outbound;
    } else if (stat.type === 'candidate-pair') {
      const pair = stat as RTCIceCandidatePairStats;
      if (pair.nominated && pair.state === 'succeeded') candidatePair = pair;
    }
  }

  let candidateType: string | null = null;
  if (candidatePair) {
    const localCandidateId = candidatePair.localCandidateId;
    for (const stat of stats.values()) {
      if (stat.type === 'local-candidate' && stat.id === localCandidateId) {
        candidateType = (stat as RTCStats & { candidateType?: string }).candidateType ?? null;
        break;
      }
    }
  }

  const codecId = videoOutbound?.codecId ?? videoInbound?.codecId;
  const codec = codecId ? (codecMimeTypeById.get(codecId) ?? null) : null;

  return {
    timestamp: Date.now(),
    bytesSent: candidatePair?.bytesSent ?? 0,
    bytesReceived: candidatePair?.bytesReceived ?? 0,
    packetsLost: totalPacketsLost,
    packetsReceived: totalPacketsReceived,
    jitter: videoInbound?.jitter ?? null,
    roundTripTime: candidatePair?.currentRoundTripTime ?? null,
    candidateType,
    codec,
  };
}
