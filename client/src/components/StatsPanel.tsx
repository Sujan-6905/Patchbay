import { X } from 'lucide-react';
import type { StatsSample } from '../hooks/useConnectionStats';
import { Sparkline } from './Sparkline';

interface StatsPanelProps {
  peers: { peerId: string; displayName: string }[];
  stats: Record<string, StatsSample[]>;
  onClose: () => void;
}

const CANDIDATE_TYPE_LABELS: Record<string, string> = {
  host: 'Host',
  srflx: 'STUN',
  relay: 'TURN',
  prflx: 'Peer rflx',
};

function formatKbps(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mbps`;
  return `${kbps.toFixed(0)} kbps`;
}

function formatMs(ms: number | null): string {
  return ms === null ? '-' : `${ms.toFixed(0)} ms`;
}

function formatPercent(percent: number | null): string {
  return percent === null ? '-' : `${percent.toFixed(1)}%`;
}

/** Candidate-pair type badge: `relay` gets its own color since "is this call going through
 * TURN?" is the single most interesting fact this panel can show. */
function CandidateBadge({ candidateType }: { candidateType: string | null }) {
  if (!candidateType) return <span className="text-neutral-500">-</span>;
  const label = CANDIDATE_TYPE_LABELS[candidateType] ?? candidateType;
  const colorClass =
    candidateType === 'relay'
      ? 'bg-amber-600/30 text-amber-300'
      : candidateType === 'srflx'
        ? 'bg-blue-600/30 text-blue-300'
        : 'bg-neutral-600/40 text-neutral-300';
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>{label}</span>;
}

export function StatsPanel({ peers, stats, onClose }: StatsPanelProps) {
  return (
    <div className="flex h-full w-full flex-col rounded-lg border border-neutral-700 bg-neutral-800 text-white sm:w-96">
      <div className="flex items-center justify-between border-b border-neutral-700 p-3">
        <h2 className="text-sm font-semibold">Connection stats</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close stats panel"
          className="text-neutral-400 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {peers.length === 0 && (
          <p className="text-sm text-neutral-400">No other participants yet.</p>
        )}
        {peers.map((peer) => {
          const history = stats[peer.peerId] ?? [];
          const latest: StatsSample | undefined = history[history.length - 1];
          return (
            <div key={peer.peerId} className="rounded border border-neutral-700 p-2.5 text-xs">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{peer.displayName}</span>
                <CandidateBadge candidateType={latest?.candidateType ?? null} />
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-neutral-300">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-neutral-500">↑ {formatKbps(latest?.outboundKbps ?? 0)}</span>
                  <Sparkline
                    values={history.map((s) => s.outboundKbps)}
                    className="text-blue-400"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-neutral-500">↓ {formatKbps(latest?.inboundKbps ?? 0)}</span>
                  <Sparkline
                    values={history.map((s) => s.inboundKbps)}
                    className="text-green-400"
                  />
                </div>
                <div>
                  RTT: <span className="text-neutral-100">{formatMs(latest?.rttMs ?? null)}</span>
                </div>
                <div>
                  Jitter:{' '}
                  <span className="text-neutral-100">{formatMs(latest?.jitterMs ?? null)}</span>
                </div>
                <div>
                  Loss:{' '}
                  <span className="text-neutral-100">
                    {formatPercent(latest?.packetLossPercent ?? null)}
                  </span>
                </div>
                <div className="truncate">
                  Codec:{' '}
                  <span className="text-neutral-100">{latest?.codec?.split('/')[1] ?? '-'}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
