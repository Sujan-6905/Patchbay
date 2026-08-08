import { MicOff, Minimize2, MonitorUp, Maximize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSpeakingDetector } from '../hooks/useSpeakingDetector';

interface VideoTileProps {
  stream: MediaStream | null;
  muted?: boolean;
  label: string;
  mirrored?: boolean;
  micEnabled?: boolean;
  presenting?: boolean;
  /** Runs local AudioContext-based speaking detection and rings the tile while active. */
  detectSpeaking?: boolean;
  /** Stream to analyze for speaking detection, if different from the displayed `stream`, e.g.
   * the local tile shows the (possibly video-only, blurred) display stream but must analyze the
   * original mic-bearing stream. Defaults to `stream`. */
  speakingDetectionStream?: MediaStream | null;
  /** Currently-bursting reaction emoji, or null/undefined for none. */
  reaction?: string | null;
  /** Drives the "reconnecting" overlay; only meaningful for remote peer tiles. */
  connectionState?: RTCPeerConnectionState;
  /** Most recent live caption text for this tile's speaker, or null/undefined for none. */
  caption?: string | null;
}

export function VideoTile({
  stream,
  muted = false,
  label,
  mirrored = false,
  micEnabled = true,
  presenting = false,
  detectSpeaking = false,
  speakingDetectionStream,
  reaction = null,
  connectionState,
  caption = null,
}: VideoTileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenSupported =
    typeof document !== 'undefined' && document.fullscreenEnabled !== false;
  const speaking = useSpeakingDetector(
    detectSpeaking ? (speakingDetectionStream ?? stream) : null,
  );
  const reconnecting = connectionState === 'disconnected' || connectionState === 'failed';

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  async function handleToggleFullscreen() {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      console.error('failed to toggle fullscreen', err);
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden bg-neutral-900 transition-shadow ${
        isFullscreen ? 'flex h-screen w-screen items-center justify-center' : 'aspect-video w-full rounded-lg'
      } ${
        speaking
          ? 'animate-speaking-pulse ring-4 ring-green-400'
          : presenting
            ? 'ring-2 ring-blue-500'
            : ''
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={`h-full w-full object-cover ${mirrored ? 'scale-x-[-1]' : ''}`}
      />
      {presenting && (
        <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-blue-500 px-2 py-0.5 text-xs font-medium text-white">
          <MonitorUp size={12} />
          Presenting
        </div>
      )}
      {reconnecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-medium text-white">
          {connectionState === 'failed' ? 'Connection lost, retrying…' : 'Reconnecting…'}
        </div>
      )}
      {reaction && (
        <div
          key={reaction}
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-6xl animate-reaction-pop"
        >
          {reaction}
        </div>
      )}
      {caption && (
        <div className="pointer-events-none absolute inset-x-2 bottom-9 flex justify-center">
          <span className="max-w-[90%] rounded bg-black/70 px-2 py-1 text-center text-xs text-white">
            {caption}
          </span>
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {!micEnabled && <MicOff size={12} aria-label="muted" />}
        <span>{label}</span>
      </div>
      {fullscreenSupported && (
        <button
          type="button"
          onClick={() => void handleToggleFullscreen()}
          aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
          title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          className="absolute right-2 top-2 rounded bg-black/60 p-1.5 text-white hover:bg-black/80"
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      )}
    </div>
  );
}
