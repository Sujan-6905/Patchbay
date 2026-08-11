import type { DataChannelMessage, IncomingSignalPayload } from '@patchbay/shared';
import { MAX_FILE_SIZE } from '@patchbay/shared';
import { AnimatePresence, motion } from 'motion/react';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SummaryState } from '../components/ChatPanel';
import { ChatPanel } from '../components/ChatPanel';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ControlBar } from '../components/ControlBar';
import { ReactionPicker } from '../components/ReactionPicker';
import type { AudioQualityPreset, QualityPreset } from '../components/SettingsPanel';
import { SettingsPanel } from '../components/SettingsPanel';
import { StatsPanel } from '../components/StatsPanel';
import { VideoTile } from '../components/VideoTile';
import {
  getPreferredCameraId,
  getPreferredMicId,
  setPreferredCameraId,
  setPreferredMicId,
} from '../lib/devicePreferences';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchWithTimeout } from '../lib/apiBase';
import { getStoredDisplayName, setStoredDisplayName } from '../lib/displayName';
import { useBackgroundBlur } from '../hooks/useBackgroundBlur';
import { useCaptions } from '../hooks/useCaptions';
import { useConnectionStats } from '../hooks/useConnectionStats';
import { useLocalMedia } from '../hooks/useLocalMedia';
import { useMediaDevices } from '../hooks/useMediaDevices';
import { summarizeTranscript } from '../lib/aiClient';
import { downloadRecording, MeetingRecorder } from '../lib/meetingRecorder';
import type { RecordingSource } from '../lib/meetingRecorder';
import { PeerManager } from '../lib/PeerManager';
import { getSocket } from '../lib/signalingClient';
import { reportBackendDown, SERVER_UNREACHABLE_MESSAGE } from '../store/backendStatusStore';
import { useCaptionStore } from '../store/captionStore';
import { useChatStore } from '../store/chatStore';
import { useRoomStore } from '../store/roomStore';

interface IncomingFileBuffer {
  fileId: string;
  mimeType: string;
  chunks: ArrayBuffer[];
  received: number;
}

const QUALITY_PRESETS: Record<
  QualityPreset,
  { width?: number; height?: number; bitrate?: number }
> = {
  auto: {},
  '720p': { width: 1280, height: 720, bitrate: 2_500_000 },
  '360p': { width: 640, height: 360, bitrate: 500_000 },
};

/** Opus is comfortable well below "High" already; these are ceilings, not targets, so
 * "Auto" (no cap) usually looks the same as "High" on a good connection. "Data saver" trades
 * fidelity for headroom on constrained links. */
const AUDIO_QUALITY_BITRATES: Record<AudioQualityPreset, number | undefined> = {
  auto: undefined,
  high: 64_000,
  low: 16_000,
};

interface TurnConfigResponse {
  iceServers: RTCIceServer[];
}

/** Resends our full mic/cam/screen-share state, merging in any overrides; used both on toggle and to bring a newcomer up to date (they only learn our state via `member:state`, not the join ack). */
function emitMemberState(
  overrides: Partial<{ micEnabled: boolean; camEnabled: boolean; sharingScreen: boolean }> = {},
): void {
  const state = useRoomStore.getState();
  getSocket().emit('member:state', {
    micEnabled: state.micEnabled,
    camEnabled: state.camEnabled,
    sharingScreen: state.sharingScreen,
    ...overrides,
  });
}

export function Room() {
  const { roomId = '' } = useParams<{ roomId: string }>();
  const { stream: localStream, error: mediaError } = useLocalMedia();
  const navigate = useNavigate();
  const peerManagerRef = useRef<PeerManager | null>(null);
  // Always the latest `localStream` without being a reactive dependency itself; the room-join
  // effect below only needs the stream to *exist* once, to construct `PeerManager` a single
  // time. A later-recovered camera track reaches peers through the track-replacement effect
  // (which calls PeerManager.replaceLocalTrack), not through this effect. Depending on
  // `localStream` there directly would re-run that whole effect (and its cleanup, which does
  // `socket.emit('room:leave')`) every time `useLocalMedia` swaps in a recovered stream,
  // forcing an unnecessary leave-and-rejoin of the room mid-call.
  const localStreamRef = useRef<MediaStream | null>(null);
  localStreamRef.current = localStream;
  const [displayName, setDisplayName] = useState(getStoredDisplayName);
  // Only the explicitly-submitted name drives the join effect; the live input value
  // must not, or every keystroke would re-trigger a join attempt mid-typing.
  const [confirmedName, setConfirmedName] = useState(() => getStoredDisplayName().trim());

  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);

  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [reactions, setReactions] = useState<Record<string, string | null>>({});
  const reactionTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const incomingFileBuffersRef = useRef<Record<string, IncomingFileBuffer>>({});
  const captionTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [finalizingRecording, setFinalizingRecording] = useState(false);
  const recorderRef = useRef<MeetingRecorder | null>(null);
  const [quality, setQuality] = useState<QualityPreset>('auto');
  const [audioQuality, setAudioQuality] = useState<AudioQualityPreset>('auto');
  const [selectedCameraId, setSelectedCameraId] = useState(getPreferredCameraId);
  const [selectedMicId, setSelectedMicId] = useState(getPreferredMicId);
  const [summaryState, setSummaryState] = useState<SummaryState>({ status: 'idle' });
  // Set when the server can't be reached while joining (as opposed to `joinError`, which is a
  // real error the server sent back). Distinct so a mid-join outage gets its own clear message
  // instead of leaving the call screen waiting on a response that will never arrive.
  const [connectionError, setConnectionError] = useState<string | null>(null);
  // One in-room toast slot, shared by blur-degrade and recording messages.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { cameras, microphones } = useMediaDevices();
  // Falls back to whichever device is actually active until the user picks an explicit
  // preference; computed at render time rather than mirrored into state via an effect.
  const effectiveCameraId =
    selectedCameraId ?? localStream?.getVideoTracks()[0]?.getSettings().deviceId ?? null;
  const effectiveMicId =
    selectedMicId ?? localStream?.getAudioTracks()[0]?.getSettings().deviceId ?? null;

  const {
    peers,
    remoteStreams,
    remoteScreenStreams,
    connectionStates,
    micEnabled,
    camEnabled,
    sharingScreen,
    joinError,
    setJoined,
    addPeer,
    removePeer,
    setRemoteStream,
    setRemoteScreenStream,
    setConnectionState,
    setPeerState,
    setMicEnabled,
    setCamEnabled,
    setSharingScreen,
    setJoinError,
    reset,
  } = useRoomStore();

  const {
    messages,
    unreadCount,
    chatOpen,
    fileTransfers,
    addMessage,
    receiveMessage,
    bumpUnreadIfClosed,
    setChatOpen,
    upsertFileTransfer,
    setFileTransferProgress,
    completeFileTransfer,
    failFileTransfer,
    reset: resetChat,
  } = useChatStore();

  const {
    captionsEnabled,
    liveCaptions,
    transcript,
    setCaptionsEnabled,
    upsertLiveCaption,
    clearLiveCaption,
    appendTranscriptEntry,
    reset: resetCaptions,
  } = useCaptionStore();

  const peerList = Object.values(peers);
  const someoneElseSharing = peerList.some((peer) => peer.sharingScreen);
  const peerIds = peerList.map((peer) => peer.peerId);
  // Chrome and Firefox on Android (and most other mobile browsers) never implemented the
  // Screen Capture API, so getDisplayMedia is simply absent there rather than throwing.
  const screenShareSupported = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const connectionStats = useConnectionStats(peerManagerRef, peerIds, statsOpen);

  function triggerReaction(key: string, emoji: string) {
    setReactions((prev) => ({ ...prev, [key]: emoji }));
    const existingTimer = reactionTimersRef.current[key];
    if (existingTimer) clearTimeout(existingTimer);
    // Matches the reaction-pop animation's duration (tailwind.config.js) plus a small buffer,
    // so the burst's fade-out finishes before the DOM node is removed instead of cutting off.
    reactionTimersRef.current[key] = setTimeout(() => {
      setReactions((prev) => ({ ...prev, [key]: null }));
    }, 3800);
  }

  const showCaption = useCallback(
    (key: string, text: string) => {
      const CAPTION_DISPLAY_MS = 4000;
      upsertLiveCaption(key, text);
      const existingTimer = captionTimersRef.current[key];
      if (existingTimer) clearTimeout(existingTimer);
      captionTimersRef.current[key] = setTimeout(() => {
        clearLiveCaption(key);
      }, CAPTION_DISPLAY_MS);
    },
    [upsertLiveCaption, clearLiveCaption],
  );

  function handleCaptionResult(text: string, isFinal: boolean) {
    peerManagerRef.current?.sendCaption(text, isFinal);
    // Speech is transcribed for the whole call (so "Summarize meeting" always has a full
    // transcript to work from); the captions toggle only controls the on-screen overlay.
    if (captionsEnabled) showCaption('self', text);
    if (isFinal) {
      appendTranscriptEntry({
        key: crypto.randomUUID(),
        peerId: 'self',
        displayName: 'You',
        text,
        timestamp: Date.now(),
      });
    }
  }

  // Transcription runs whenever we're in the call with a live, unmuted mic, not only while
  // the caption overlay is shown. Gating on micEnabled matters beyond consistency: the Web
  // Speech API opens its own capture, so it would keep hearing a "muted" user (mute only
  // disables the outgoing WebRTC track) if left running.
  const { isSupported: captionsSupported } = useCaptions(
    localStream !== null && micEnabled,
    handleCaptionResult,
  );

  const [blurEnabled, setBlurEnabled] = useState(false);
  // A collapsed frame rate means this device can't keep up with segmentation; fall back to
  // the plain camera feed rather than let it drag the whole call down, but never silently:
  // the user is told why their blur just went away.
  const { outputStream: blurredStream, isSupported: blurSupported } = useBackgroundBlur(
    localStream,
    blurEnabled,
    () => {
      setBlurEnabled(false);
      showNotice(
        "Background blur was turned off because this device couldn't keep up with it. You can try turning it back on.",
      );
    },
  );
  const displayStream = blurEnabled && blurredStream ? blurredStream : localStream;

  useEffect(() => {
    const track = blurEnabled
      ? blurredStream?.getVideoTracks()[0]
      : localStream?.getVideoTracks()[0];
    if (track) {
      peerManagerRef.current
        ?.replaceLocalTrack('video', track)
        .catch((err: unknown) => console.error('failed to replace outgoing video track', err));
    }
  }, [blurEnabled, blurredStream, localStream]);

  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [recording]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 12_000);
  }, []);

  const buildRecordingSources = useCallback((): RecordingSource[] => {
    const sources: RecordingSource[] = [];
    if (displayStream) {
      // Video follows whatever is displayed (raw camera or blur canvas); audio is pinned to
      // the raw stream, since the blur canvas stream carries no audio and swapping the mic
      // binding on every blur toggle would punch silent holes in the recording.
      sources.push({
        key: 'self',
        label: 'You',
        stream: displayStream,
        kind: 'camera',
        audioStream: localStream ?? undefined,
      });
    }
    if (sharingScreen && screenStream) {
      sources.push({
        key: 'self-screen',
        label: 'Your screen',
        stream: screenStream,
        kind: 'screen',
      });
    }
    for (const peer of peerList) {
      const stream = remoteStreams[peer.peerId];
      if (stream) {
        sources.push({ key: peer.peerId, label: peer.displayName, stream, kind: 'camera' });
      }
      const peerScreen = remoteScreenStreams[peer.peerId];
      if (peer.sharingScreen && peerScreen) {
        sources.push({
          key: `${peer.peerId}-screen`,
          label: `${peer.displayName}'s screen`,
          stream: peerScreen,
          kind: 'screen',
        });
      }
    }
    return sources;
  }, [
    displayStream,
    localStream,
    sharingScreen,
    screenStream,
    peerList,
    remoteStreams,
    remoteScreenStreams,
  ]);

  // Keeps an in-progress recording's tile set in sync with what's actually on screen; the
  // recorder's own source list otherwise stays frozen at whatever was visible when Record was
  // clicked, so a screen share (or a peer joining/leaving) started mid-recording would never
  // appear in it. A no-op while not recording.
  useEffect(() => {
    if (!recording) return;
    recorderRef.current?.updateSources(buildRecordingSources());
  }, [recording, buildRecordingSources]);

  const hasLocalStream = localStream !== null;

  useEffect(() => {
    if (!localStreamRef.current || !roomId || !confirmedName) return;

    const socket = getSocket();
    let cancelled = false;

    const onPeerJoined = (member: { peerId: string; displayName: string }) => {
      peerManagerRef.current?.addPeer(member.peerId, false);
      addPeer(member);
      emitMemberState();
    };

    const onPeerLeft = ({ peerId }: { peerId: string }) => {
      peerManagerRef.current?.removePeer(peerId);
      removePeer(peerId);
    };

    const onSignal = ({ from, description, candidate }: IncomingSignalPayload) => {
      void peerManagerRef.current?.handleSignal(from, { description, candidate });
    };

    const onMemberState = (payload: {
      peerId: string;
      micEnabled: boolean;
      camEnabled: boolean;
      sharingScreen: boolean;
    }) => {
      setPeerState(payload.peerId, payload);
    };

    const onChannelMessage = (peerId: string, message: DataChannelMessage) => {
      const senderName = useRoomStore.getState().peers[peerId]?.displayName ?? 'Unknown';
      if (message.type === 'chat') {
        receiveMessage({
          key: message.id,
          peerId,
          displayName: senderName,
          text: message.text,
          timestamp: message.timestamp,
        });
      } else if (message.type === 'reaction') {
        triggerReaction(peerId, message.emoji);
      } else if (message.type === 'file-meta') {
        incomingFileBuffersRef.current[peerId] = {
          fileId: message.fileId,
          mimeType: message.mimeType,
          chunks: [],
          received: 0,
        };
        upsertFileTransfer({
          key: `${peerId}:${message.fileId}`,
          fileId: message.fileId,
          peerId,
          displayName: senderName,
          name: message.name,
          size: message.size,
          mimeType: message.mimeType,
          direction: 'incoming',
          transferredBytes: 0,
          status: 'in-progress',
        });
        bumpUnreadIfClosed();
      } else if (message.type === 'file-done') {
        const buffer = incomingFileBuffersRef.current[peerId];
        if (buffer && buffer.fileId === message.fileId) {
          // Never trust a peer-supplied MIME type for the local Blob: a same-origin blob: URL
          // typed e.g. text/html would render (and execute any embedded script) instead of
          // downloading if opened directly. Force a generic binary type unconditionally; the
          // claimed mimeType is only ever used for display, never for how the bytes are handled.
          const blob = new Blob(buffer.chunks, { type: 'application/octet-stream' });
          completeFileTransfer(`${peerId}:${buffer.fileId}`, URL.createObjectURL(blob));
          delete incomingFileBuffersRef.current[peerId];
        }
      } else if (message.type === 'caption') {
        // Peers transcribe continuously too; whether their words appear as an overlay here
        // is this user's choice, so read the toggle live (this closure outlives renders).
        if (useCaptionStore.getState().captionsEnabled) showCaption(peerId, message.text);
        if (message.isFinal) {
          appendTranscriptEntry({
            key: crypto.randomUUID(),
            peerId,
            displayName: senderName,
            text: message.text,
            timestamp: message.timestamp,
          });
        }
      }
    };

    const onFileChunk = (peerId: string, chunk: ArrayBuffer) => {
      const buffer = incomingFileBuffersRef.current[peerId];
      if (!buffer) return;
      buffer.chunks.push(chunk);
      buffer.received += chunk.byteLength;
      setFileTransferProgress(`${peerId}:${buffer.fileId}`, buffer.received);
    };

    async function join() {
      const certificatePromise = RTCPeerConnection.generateCertificate({
        name: 'ECDSA',
        namedCurve: 'P-256',
      } as EcKeyGenParams);

      let iceServers: RTCIceServer[];
      try {
        const res = await fetchWithTimeout('/api/turn-config');
        if (!res.ok) throw new Error(`turn-config responded ${res.status}`);
        ({ iceServers } = (await res.json()) as TurnConfigResponse);
      } catch {
        if (!cancelled) {
          reportBackendDown();
          setConnectionError(SERVER_UNREACHABLE_MESSAGE);
        }
        return;
      }

      const certificate = await certificatePromise;
      const joinStream = localStreamRef.current;
      if (cancelled || !joinStream) return;

      const manager = new PeerManager({
        iceServers,
        certificate,
        localStream: joinStream,
        sendSignal: (payload) => socket.emit('signal', payload),
        onRemoteTrack: (peerId, remoteStream, kind) =>
          kind === 'screen'
            ? setRemoteScreenStream(peerId, remoteStream)
            : setRemoteStream(peerId, remoteStream),
        onConnectionStateChange: (peerId, state) => setConnectionState(peerId, state),
        onChannelMessage,
        onFileChunk,
      });
      peerManagerRef.current = manager;

      socket.on('room:peer-joined', onPeerJoined);
      socket.on('room:peer-left', onPeerLeft);
      socket.on('room:member-state', onMemberState);
      socket.on('signal', onSignal);

      try {
        const ack = await socket
          .timeout(DEFAULT_REQUEST_TIMEOUT_MS)
          .emitWithAck('room:join', { roomId, displayName: confirmedName });
        if (cancelled) return;
        if (!ack.ok) {
          setJoinError(ack.error);
          return;
        }
        setJoined(roomId, socket.id ?? '', ack.members);
        for (const member of ack.members) manager.addPeer(member.peerId, true);
      } catch {
        if (!cancelled) {
          reportBackendDown();
          setConnectionError(SERVER_UNREACHABLE_MESSAGE);
        }
      }
    }

    void join();

    return () => {
      cancelled = true;
      socket.off('room:peer-joined', onPeerJoined);
      socket.off('room:peer-left', onPeerLeft);
      socket.off('room:member-state', onMemberState);
      socket.off('signal', onSignal);
      socket.emit('room:leave');
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      peerManagerRef.current?.destroy();
      peerManagerRef.current = null;
      if (recorderRef.current?.isRecording) {
        void recorderRef.current.stop().then((blob) => {
          if (blob) downloadRecording(blob);
        });
      }
      for (const timer of Object.values(reactionTimersRef.current)) clearTimeout(timer);
      reactionTimersRef.current = {};
      for (const timer of Object.values(captionTimersRef.current)) clearTimeout(timer);
      captionTimersRef.current = {};
      incomingFileBuffersRef.current = {};
      reset();
      resetChat();
      resetCaptions();
    };
  }, [
    hasLocalStream,
    roomId,
    confirmedName,
    addPeer,
    removePeer,
    setRemoteStream,
    setRemoteScreenStream,
    setConnectionState,
    setPeerState,
    setJoined,
    setJoinError,
    reset,
    receiveMessage,
    bumpUnreadIfClosed,
    upsertFileTransfer,
    setFileTransferProgress,
    completeFileTransfer,
    resetChat,
    appendTranscriptEntry,
    resetCaptions,
    showCaption,
  ]);

  function handleToggleMic() {
    const next = !micEnabled;
    localStream?.getAudioTracks().forEach((track) => (track.enabled = next));
    setMicEnabled(next);
    emitMemberState({ micEnabled: next });
  }

  function handleToggleCam() {
    const next = !camEnabled;
    localStream?.getVideoTracks().forEach((track) => (track.enabled = next));
    setCamEnabled(next);
    emitMemberState({ camEnabled: next });
  }

  async function handleShareScreen() {
    if (someoneElseSharing) return;
    try {
      const captured = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = captured.getVideoTracks()[0];
      if (!track) return;
      screenTrackRef.current = track;
      // Sent as a second track alongside the camera (not a replacement), so remote peers get
      // both as separate tiles instead of the screen replacing the camera feed.
      peerManagerRef.current?.addScreenTrack(track);
      setScreenStream(captured);
      track.onended = () => handleStopShare();
      setSharingScreen(true);
      emitMemberState({ sharingScreen: true });
    } catch (err) {
      console.error('screen share failed or was cancelled', err);
    }
  }

  function handleStopShare() {
    screenTrackRef.current?.stop();
    screenTrackRef.current = null;
    peerManagerRef.current?.removeScreenTrack();
    setScreenStream(null);
    setSharingScreen(false);
    emitMemberState({ sharingScreen: false });
  }

  function handleSendChatMessage(text: string) {
    const message = peerManagerRef.current?.sendChatMessage(text);
    if (!message) return;
    addMessage({
      key: message.id,
      peerId: 'self',
      displayName: 'You',
      text: message.text,
      timestamp: message.timestamp,
    });
  }

  function handleToggleCaptions() {
    const next = !captionsEnabled;
    setCaptionsEnabled(next);
    // Hiding captions should hide them now, not after each entry's own display timer runs out.
    if (!next) {
      for (const key of Object.keys(useCaptionStore.getState().liveCaptions)) {
        clearLiveCaption(key);
      }
    }
  }

  function handleToggleBlur() {
    setBlurEnabled((prev) => !prev);
  }

  function handleToggleStats() {
    setStatsOpen((prev) => !prev);
  }

  function handleSendReaction(emoji: string) {
    peerManagerRef.current?.sendReaction(emoji);
    triggerReaction('self', emoji);
  }

  async function handleSendFile(file: File) {
    if (file.size > MAX_FILE_SIZE) {
      addMessage({
        key: crypto.randomUUID(),
        peerId: 'self',
        displayName: 'You',
        text: `"${file.name}" is too large to send (max ${Math.round(MAX_FILE_SIZE / (1024 * 1024))} MB).`,
        timestamp: Date.now(),
      });
      return;
    }

    const fileId = crypto.randomUUID();
    const key = `self:${fileId}`;
    upsertFileTransfer({
      key,
      fileId,
      peerId: 'self',
      displayName: 'You',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      direction: 'outgoing',
      transferredBytes: 0,
      status: 'in-progress',
    });

    try {
      await peerManagerRef.current?.sendFile(fileId, file, (sentBytes) =>
        setFileTransferProgress(key, sentBytes),
      );
      completeFileTransfer(key);
    } catch (err) {
      console.error('file send failed', err);
      failFileTransfer(key);
    }
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
      newTrack.enabled = camEnabled;
      // Splice the new device track into the shared local stream so everything reading it
      // (local tile, blur processor source, quality presets) follows the switch live.
      const oldTrack = localStream?.getVideoTracks()[0] ?? null;
      if (localStream) {
        if (oldTrack) localStream.removeTrack(oldTrack);
        localStream.addTrack(newTrack);
      }
      // With blur on, peers receive the blur canvas track; the new camera only changes the
      // blur processor's *input* (picked up automatically via the shared stream), so the
      // outgoing sender track must stay put or the raw feed would leak past the blur.
      if (!blurEnabled) {
        await peerManagerRef.current?.replaceLocalTrack('video', newTrack);
      }
      oldTrack?.stop();
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
      newTrack.enabled = micEnabled;
      const oldTrack = localStream?.getAudioTracks()[0] ?? null;
      if (localStream) {
        if (oldTrack) localStream.removeTrack(oldTrack);
        localStream.addTrack(newTrack);
      }
      await peerManagerRef.current?.replaceLocalTrack('audio', newTrack);
      oldTrack?.stop();
    } catch (err) {
      console.error('failed to switch microphone', err);
    }
  }

  async function handleSelectQuality(next: QualityPreset) {
    setQuality(next);
    const preset = QUALITY_PRESETS[next];
    const activeVideoTrack = localStream?.getVideoTracks()[0];
    if (activeVideoTrack && (preset.width || preset.height)) {
      try {
        await activeVideoTrack.applyConstraints({ width: preset.width, height: preset.height });
      } catch (err) {
        console.error('failed to apply resolution constraint', err);
      }
    }
    await peerManagerRef.current?.setVideoMaxBitrate(preset.bitrate);
  }

  async function handleSelectAudioQuality(next: AudioQualityPreset) {
    setAudioQuality(next);
    await peerManagerRef.current?.setAudioMaxBitrate(AUDIO_QUALITY_BITRATES[next]);
  }

  async function handleSummarize() {
    setSummaryState({ status: 'loading' });
    const transcriptText = transcript
      .map(
        (entry) =>
          `[${new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}] ${entry.displayName}: ${entry.text}`,
      )
      .join('\n');

    let accumulated = '';
    try {
      await summarizeTranscript(transcriptText, (chunk) => {
        accumulated += chunk;
        setSummaryState({ status: 'done', text: accumulated });
      });
    } catch (err) {
      setSummaryState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Summary failed.',
      });
    }
  }

  function handleToggleRecord() {
    if (recording) {
      void stopRecording();
      return;
    }
    // The previous recording is still flushing/validating; starting a new one against the
    // same recorder instance mid-teardown would corrupt both.
    if (finalizingRecording) return;
    if (!recorderRef.current) recorderRef.current = new MeetingRecorder();
    recorderRef.current.start(buildRecordingSources());
    // start() can no-op (no drawable sources, no canvas context); showing a live "Recording"
    // timer over a recorder that isn't running is how 0-byte downloads are born.
    if (!recorderRef.current.isRecording) {
      showNotice('Recording could not start: no video sources are available yet.');
      return;
    }
    if (!recorderRef.current.mimeType.includes('mp4')) {
      // The webm fallback is in use (no platform MP4/AAC encoder). Windows' built-in Media
      // Player handles MediaRecorder webm badly; warn now, not after a broken playback.
      showNotice(
        'Recording started. Heads-up: this browser saves recordings as .webm, which the ' +
          "built-in Windows Media Player often can't play properly. Open the file in VLC " +
          '(free) for reliable playback.',
      );
    }
    setRecording(true);
    setRecordingSeconds(0);
  }

  async function stopRecording(): Promise<void> {
    // Finalizing takes a moment on purpose: the recorder flushes its last chunks, stamps the
    // duration/seek metadata, and verifies the file actually decodes before handing it over.
    setRecording(false);
    setFinalizingRecording(true);
    try {
      const wasRecording = recorderRef.current?.isRecording ?? false;
      const blob = await recorderRef.current?.stop();
      if (blob) {
        downloadRecording(blob);
      } else if (wasRecording) {
        showNotice(
          'Recording failed: no video data was captured, so nothing was downloaded. Please try again.',
        );
      }
    } finally {
      setFinalizingRecording(false);
    }
  }

  function handleLeave() {
    setLeaveConfirmOpen(true);
  }

  function handleConfirmLeave() {
    if (recording) void stopRecording();
    navigate('/');
  }

  function handleCopyLink() {
    void navigator.clipboard.writeText(window.location.href);
  }

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) return;
    setStoredDisplayName(trimmed);
    setConfirmedName(trimmed);
  }

  if (mediaError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center text-white">
        <p className="text-lg">{mediaError.message}</p>
        <Link to="/" className="text-blue-400 underline">
          Back home
        </Link>
      </div>
    );
  }

  if (joinError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center text-white">
        <p className="text-lg">{joinError.message}</p>
        <Link to="/" className="text-blue-400 underline">
          Back home
        </Link>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center text-white">
        <p className="text-lg">{connectionError}</p>
        <Link to="/" className="text-blue-400 underline">
          Back home
        </Link>
      </div>
    );
  }

  if (!confirmedName) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-white">
        <p className="text-lg">What should we call you?</p>
        <form onSubmit={handleNameSubmit} className="flex w-full max-w-sm gap-2">
          <input
            autoFocus
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            className="flex-1 rounded-lg bg-neutral-800 px-4 py-3 outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-500 px-4 py-3 font-medium hover:bg-blue-400"
          >
            Join
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh flex-col gap-4 overflow-hidden p-4 text-white">
      {recording && (
        <div className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          Recording {Math.floor(recordingSeconds / 60)}:
          {(recordingSeconds % 60).toString().padStart(2, '0')}
        </div>
      )}
      {finalizingRecording && (
        <div className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white">
          <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-400" />
          Preparing your recording…
        </div>
      )}
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="absolute left-1/2 top-10 z-10 flex max-w-md -translate-x-1/2 items-start gap-2 rounded-lg bg-neutral-800 px-4 py-3 text-sm text-white shadow-lg ring-1 ring-neutral-700"
            role="status"
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notification"
              className="mt-0.5 shrink-0 text-neutral-400 hover:text-white"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="relative flex flex-1 gap-4 overflow-hidden">
        {/* gridAutoRows: min-content is load-bearing: without it, a height-constrained
            container makes the grid compress its auto rows below the tiles' aspect-video
            height, and the fixed-aspect tiles then overflow their rows and visually overlap
            the row below. Sizing rows to the tiles' intrinsic height means a too-short
            viewport scrolls instead of overlapping. `safe` centering keeps the first row
            reachable when that scroll kicks in (plain center clips the top). */}
        <div
          className="grid flex-1 justify-center gap-4 overflow-y-auto [align-content:safe_center]"
          style={{
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 480px))',
            gridAutoRows: 'min-content',
          }}
        >
          <VideoTile
            stream={displayStream}
            muted
            label="You"
            mirrored
            micEnabled={micEnabled}
            reaction={reactions.self}
            caption={liveCaptions.self}
            detectSpeaking={micEnabled}
            speakingDetectionStream={localStream}
          />
          {sharingScreen && screenStream && (
            <VideoTile stream={screenStream} muted label="Your screen" presenting />
          )}
          {peerList.map((peer) => (
            <VideoTile
              key={peer.peerId}
              stream={remoteStreams[peer.peerId] ?? null}
              label={peer.displayName}
              micEnabled={peer.micEnabled}
              detectSpeaking
              reaction={reactions[peer.peerId]}
              connectionState={connectionStates[peer.peerId]}
              caption={liveCaptions[peer.peerId]}
            />
          ))}
          {peerList
            .filter((peer) => peer.sharingScreen && remoteScreenStreams[peer.peerId])
            .map((peer) => (
              <VideoTile
                key={`${peer.peerId}-screen`}
                stream={remoteScreenStreams[peer.peerId] ?? null}
                label={`${peer.displayName}'s screen`}
                presenting
              />
            ))}
        </div>
        <AnimatePresence>
          {chatOpen && (
            <motion.div
              key="chat"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="absolute inset-0 z-20 sm:static sm:inset-auto sm:z-auto sm:h-full"
            >
              <ChatPanel
                messages={messages}
                fileTransfers={Object.values(fileTransfers)}
                onSendMessage={handleSendChatMessage}
                onSendFile={(file) => void handleSendFile(file)}
                onClose={() => setChatOpen(false)}
                transcriptAvailable={transcript.length > 0}
                summaryState={summaryState}
                onSummarize={() => void handleSummarize()}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {statsOpen && (
            <motion.div
              key="stats"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="absolute inset-0 z-20 sm:static sm:inset-auto sm:z-auto sm:h-full"
            >
              <StatsPanel
                peers={peerList.map((peer) => ({
                  peerId: peer.peerId,
                  displayName: peer.displayName,
                }))}
                stats={connectionStats}
                onClose={() => setStatsOpen(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="relative">
        <AnimatePresence>
          {settingsOpen && (
            <SettingsPanel
              cameras={cameras}
              microphones={microphones}
              selectedCameraId={effectiveCameraId}
              selectedMicId={effectiveMicId}
              quality={quality}
              audioQuality={audioQuality}
              onSelectCamera={(id) => void handleSelectCamera(id)}
              onSelectMic={(id) => void handleSelectMic(id)}
              onSelectQuality={(q) => void handleSelectQuality(q)}
              onSelectAudioQuality={(q) => void handleSelectAudioQuality(q)}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {reactionPickerOpen && (
            <ReactionPicker
              onSelect={handleSendReaction}
              onClose={() => setReactionPickerOpen(false)}
            />
          )}
        </AnimatePresence>
        <ControlBar
          micEnabled={micEnabled}
          camEnabled={camEnabled}
          sharingScreen={sharingScreen}
          shareDisabled={someoneElseSharing}
          shareSupported={screenShareSupported}
          chatOpen={chatOpen}
          unreadCount={unreadCount}
          reactionPickerOpen={reactionPickerOpen}
          captionsEnabled={captionsEnabled}
          captionsSupported={captionsSupported}
          blurEnabled={blurEnabled}
          blurSupported={blurSupported}
          statsOpen={statsOpen}
          recording={recording}
          recordingSeconds={recordingSeconds}
          onToggleMic={handleToggleMic}
          onToggleCam={handleToggleCam}
          onToggleShareScreen={sharingScreen ? handleStopShare : handleShareScreen}
          onToggleSettings={() => {
            setReactionPickerOpen(false);
            setSettingsOpen((open) => !open);
          }}
          onToggleChat={() => setChatOpen(!chatOpen)}
          onToggleReactionPicker={() => {
            setSettingsOpen(false);
            setReactionPickerOpen((open) => !open);
          }}
          onToggleCaptions={handleToggleCaptions}
          onToggleBlur={handleToggleBlur}
          onToggleStats={handleToggleStats}
          onToggleRecord={handleToggleRecord}
          onLeave={handleLeave}
          onCopyLink={handleCopyLink}
        />
        <AnimatePresence>
          {leaveConfirmOpen && (
            <ConfirmDialog
              title="Leave meeting?"
              message="You'll be disconnected from the call. This doesn't end the meeting for everyone else."
              confirmLabel="Leave"
              destructive
              onConfirm={handleConfirmLeave}
              onCancel={() => setLeaveConfirmOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
