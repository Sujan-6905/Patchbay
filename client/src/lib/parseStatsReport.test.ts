import { describe, expect, it } from 'vitest';
import { parseStatsReport } from './parseStatsReport';

/** `RTCStatsReport.forEach` has the same signature as `Map.prototype.forEach`, so a plain
 * Map is a faithful stand-in for a real report in tests. */
function fakeReport(entries: Record<string, Record<string, unknown>>): RTCStatsReport {
  const map = new Map(
    Object.entries(entries).map(([id, stat]) => [id, { id, timestamp: 0, ...stat }]),
  );
  return map as unknown as RTCStatsReport;
}

describe('parseStatsReport', () => {
  it('returns nulls/zeros for an empty report', () => {
    const snapshot = parseStatsReport(fakeReport({}));
    expect(snapshot.bytesSent).toBe(0);
    expect(snapshot.bytesReceived).toBe(0);
    expect(snapshot.packetsLost).toBe(0);
    expect(snapshot.packetsReceived).toBe(0);
    expect(snapshot.jitter).toBeNull();
    expect(snapshot.roundTripTime).toBeNull();
    expect(snapshot.candidateType).toBeNull();
    expect(snapshot.codec).toBeNull();
  });

  it('reads bytes and RTT from the nominated succeeded candidate-pair, ignoring others', () => {
    const report = fakeReport({
      'pair-not-nominated': {
        type: 'candidate-pair',
        nominated: false,
        state: 'succeeded',
        bytesSent: 999,
        bytesReceived: 999,
        currentRoundTripTime: 9,
        localCandidateId: 'local-a',
      },
      'pair-nominated': {
        type: 'candidate-pair',
        nominated: true,
        state: 'succeeded',
        bytesSent: 1000,
        bytesReceived: 2000,
        currentRoundTripTime: 0.05,
        localCandidateId: 'local-b',
      },
    });
    const snapshot = parseStatsReport(report);
    expect(snapshot.bytesSent).toBe(1000);
    expect(snapshot.bytesReceived).toBe(2000);
    expect(snapshot.roundTripTime).toBe(0.05);
  });

  it('resolves candidate type from the local-candidate matching the nominated pair', () => {
    const report = fakeReport({
      pair: {
        type: 'candidate-pair',
        nominated: true,
        state: 'succeeded',
        localCandidateId: 'local-1',
      },
      'local-1': { type: 'local-candidate', candidateType: 'relay' },
      'local-2': { type: 'local-candidate', candidateType: 'host' },
    });
    expect(parseStatsReport(report).candidateType).toBe('relay');
  });

  it('sums packetsLost/packetsReceived across audio and video inbound-rtp, but only reports video jitter', () => {
    const report = fakeReport({
      audioIn: { type: 'inbound-rtp', kind: 'audio', packetsLost: 1, packetsReceived: 100, jitter: 0.9 },
      videoIn: { type: 'inbound-rtp', kind: 'video', packetsLost: 2, packetsReceived: 200, jitter: 0.02 },
    });
    const snapshot = parseStatsReport(report);
    expect(snapshot.packetsLost).toBe(3);
    expect(snapshot.packetsReceived).toBe(300);
    expect(snapshot.jitter).toBe(0.02);
  });

  it('resolves the video outbound codec mime type via codecId, preferring outbound over inbound', () => {
    const report = fakeReport({
      videoOut: { type: 'outbound-rtp', kind: 'video', codecId: 'codec-out' },
      videoIn: { type: 'inbound-rtp', kind: 'video', codecId: 'codec-in' },
      'codec-out': { type: 'codec', mimeType: 'video/VP8' },
      'codec-in': { type: 'codec', mimeType: 'video/H264' },
    });
    expect(parseStatsReport(report).codec).toBe('video/VP8');
  });

  it('falls back to the inbound codec when there is no outbound video stream', () => {
    const report = fakeReport({
      videoIn: { type: 'inbound-rtp', kind: 'video', codecId: 'codec-in' },
      'codec-in': { type: 'codec', mimeType: 'video/H264' },
    });
    expect(parseStatsReport(report).codec).toBe('video/H264');
  });
});
