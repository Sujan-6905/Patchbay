import { MAX_DISPLAY_NAME_LENGTH, MAX_ROOM_MEMBERS } from '@patchbay/shared';
import { Settings, Video } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DevicePickerPopover } from '../components/DevicePickerPopover';
import { VideoTile } from '../components/VideoTile';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchWithTimeout } from '../lib/apiBase';
import {
  getPreferredCameraId,
  getPreferredMicId,
  setPreferredCameraId,
  setPreferredMicId,
} from '../lib/devicePreferences';
import { getStoredDisplayName, setStoredDisplayName } from '../lib/displayName';
import { useLocalMedia } from '../hooks/useLocalMedia';
import { useMediaDevices } from '../hooks/useMediaDevices';
import { getSocket } from '../lib/signalingClient';
import {
  describeBackendStatus,
  reportBackendDown,
  SERVER_UNREACHABLE_MESSAGE,
  useBackendStatusStore,
} from '../store/backendStatusStore';

interface RoomStatusResponse {
  exists: boolean;
  memberCount: number;
  full: boolean;
}

interface PreCallProps {
  /** "create" shows just a "Create room" button; "join" additionally asks for a room code. */
  mode: 'create' | 'join';
}

export function PreCall({ mode }: PreCallProps) {
  const { stream: initialStream, error } = useLocalMedia();
  const [swappedStream, setSwappedStream] = useState<MediaStream | null>(null);
  const stream = swappedStream ?? initialStream;
  // Device switches below build NEW MediaStream objects that useLocalMedia never sees, so its
  // own unmount cleanup can't stop them; without this, leaving this page after switching
  // devices kept the swapped-in camera/mic acquired (camera light stays on). Tracks shared
  // with the initial stream get stopped twice, which is harmless.
  const swappedStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    swappedStreamRef.current = swappedStream;
  }, [swappedStream]);
  useEffect(
    () => () => {
      swappedStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  const { cameras, microphones } = useMediaDevices();
  const [selectedCameraId, setSelectedCameraId] = useState(getPreferredCameraId);
  const [selectedMicId, setSelectedMicId] = useState(getPreferredMicId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [displayName, setDisplayName] = useState(getStoredDisplayName);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [joinCheckError, setJoinCheckError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const navigate = useNavigate();
  const backendStatus = useBackendStatusStore((state) => state.status);
  const backendReady = backendStatus === 'ready';

  const canProceed = displayName.trim().length > 0;

  function handleNameChange(value: string) {
    setDisplayName(value);
    setStoredDisplayName(value);
  }

  async function handleSelectCamera(deviceId: string) {
    setPreferredCameraId(deviceId);
    setSelectedCameraId(deviceId);
    try {
      const captured = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });
      const newTrack = captured.getVideoTracks()[0];
      if (!newTrack) return;
      const oldAudioTrack = stream?.getAudioTracks()[0];
      const previous = stream;
      setSwappedStream(new MediaStream(oldAudioTrack ? [newTrack, oldAudioTrack] : [newTrack]));
      previous?.getVideoTracks().forEach((track) => track.stop());
    } catch (err) {
      console.error('failed to switch camera', err);
    }
  }

  async function handleSelectMic(deviceId: string) {
    setPreferredMicId(deviceId);
    setSelectedMicId(deviceId);
    try {
      const captured = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      const newTrack = captured.getAudioTracks()[0];
      if (!newTrack) return;
      const oldVideoTrack = stream?.getVideoTracks()[0];
      const previous = stream;
      setSwappedStream(new MediaStream(oldVideoTrack ? [oldVideoTrack, newTrack] : [newTrack]));
      previous?.getAudioTracks().forEach((track) => track.stop());
    } catch (err) {
      console.error('failed to switch microphone', err);
    }
  }

  async function handleCreateRoom() {
    if (!canProceed || !backendReady) return;
    setCreateError(null);
    setBusy(true);
    try {
      const ack = await getSocket().timeout(DEFAULT_REQUEST_TIMEOUT_MS).emitWithAck('room:create');
      if (!ack.ok) {
        setCreateError(ack.error.message);
        setBusy(false);
        return;
      }
      navigate(`/room/${ack.roomId}`);
    } catch {
      reportBackendDown();
      setCreateError(SERVER_UNREACHABLE_MESSAGE);
      setBusy(false);
    }
  }

  async function handleJoinRoom(e: FormEvent) {
    e.preventDefault();
    if (!canProceed || !backendReady) return;
    const code = joinCode.trim().toLowerCase();
    if (!code) return;

    setJoinCheckError(null);
    setBusy(true);
    try {
      // Best-effort: room:join over the socket is still the authoritative capacity check
      // once we get to the Room page (the room could fill up in the meantime).
      const res = await fetchWithTimeout(`/api/rooms/${code}/status`);
      if (res.ok) {
        const status = (await res.json()) as RoomStatusResponse;
        if (status.full) {
          setJoinCheckError(`Room is full (${MAX_ROOM_MEMBERS}/${MAX_ROOM_MEMBERS})`);
          setBusy(false);
          return;
        }
      }
    } catch {
      // Status check is a nicety; fall through to navigating and let Room's join ack
      // surface any real error. Still flag the outage so the status indicator reacts
      // immediately rather than waiting for its next heartbeat.
      reportBackendDown();
    }
    navigate(`/room/${code}`);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-8 px-4 py-12 text-neutral-100">
      <Link to="/" className="flex items-center gap-2.5 self-start">
        <Video className="text-blue-500" size={22} strokeWidth={1.75} />
        <span className="text-lg font-bold tracking-tight text-neutral-50">Patchbay</span>
      </Link>

      <h1 className="text-center text-3xl font-extrabold tracking-tight text-neutral-50">
        {mode === 'create' ? 'Start a meeting' : 'Join a meeting'}
      </h1>

      <div className="relative w-full max-w-md">
        <VideoTile stream={stream} muted label="You" mirrored />
        {error && <p className="mt-2 text-sm text-red-400">{error.message}</p>}
        <div className="absolute bottom-2 right-2">
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Settings"
            title="Camera and microphone settings"
            className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          >
            <Settings size={18} />
          </button>
          <AnimatePresence>
            {settingsOpen && (
              <DevicePickerPopover
                cameras={cameras}
                microphones={microphones}
                selectedCameraId={selectedCameraId}
                selectedMicId={selectedMicId}
                onSelectCamera={(id) => void handleSelectCamera(id)}
                onSelectMic={(id) => void handleSelectMic(id)}
                onClose={() => setSettingsOpen(false)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex w-full max-w-md flex-col gap-4">
        <input
          value={displayName}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="Your name"
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          className="rounded-lg bg-neutral-800 px-4 py-3 outline-none"
        />

        {mode === 'create' ? (
          <>
            <button
              type="button"
              onClick={() => void handleCreateRoom()}
              disabled={busy || !canProceed || !backendReady}
              className="rounded-lg bg-blue-500 px-4 py-3 font-medium hover:bg-blue-400 disabled:opacity-50 disabled:hover:bg-blue-500"
            >
              Create room
            </button>
            {createError && <p className="text-sm text-red-400">{createError}</p>}
          </>
        ) : (
          <form onSubmit={handleJoinRoom} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Enter room code"
                className="flex-1 rounded-lg bg-neutral-800 px-4 py-3 outline-none"
              />
              <button
                type="submit"
                disabled={busy || !canProceed || !backendReady}
                className="rounded-lg bg-blue-500 px-4 py-3 font-medium hover:bg-blue-400 disabled:opacity-50 disabled:hover:bg-blue-500"
              >
                Join
              </button>
            </div>
            {joinCheckError && <p className="text-sm text-red-400">{joinCheckError}</p>}
          </form>
        )}
        {!backendReady && (
          <p className="text-sm text-amber-400">{describeBackendStatus(backendStatus)}</p>
        )}
      </div>
    </div>
  );
}
