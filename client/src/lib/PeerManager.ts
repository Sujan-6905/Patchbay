import type {
  ChatChannelMessage,
  DataChannelMessage,
  IceCandidateInit,
  SessionDescriptionInit,
  SignalPayload,
} from '@patchbay/shared';
import {
  BUFFERED_AMOUNT_LOW_THRESHOLD,
  DATA_CHANNEL_ID,
  DATA_CHANNEL_LABEL,
  FILE_CHUNK_SIZE,
  dataChannelMessageSchema,
} from '@patchbay/shared';
import type { PeerStatsSnapshot } from './parseStatsReport';
import { parseStatsReport } from './parseStatsReport';

export interface PeerManagerOptions {
  iceServers: RTCIceServer[];
  /** Shared across every connection this manager opens; generating a fresh DTLS certificate
   * per RTCPeerConnection is otherwise the bottleneck when several connections are created
   * close together (e.g. a third participant joining an existing pair), which can leave one
   * connection's offer creation pending for tens of seconds. */
  certificate: RTCCertificate;
  localStream: MediaStream;
  sendSignal: (payload: SignalPayload) => void;
  onRemoteTrack: (peerId: string, stream: MediaStream, kind: 'camera' | 'screen') => void;
  onConnectionStateChange: (peerId: string, state: RTCPeerConnectionState) => void;
  onChannelMessage: (peerId: string, message: DataChannelMessage) => void;
  onFileChunk: (peerId: string, chunk: ArrayBuffer) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  pendingCandidates: IceCandidateInit[];
  /** Control messages queued because the data channel wasn't `open` yet; flushed on `onopen`, same idea as `pendingCandidates`. */
  pendingMessages: DataChannelMessage[];
  screenSender: RTCRtpSender | null;
  /** The MediaStream id of the first stream seen from this peer (camera+mic); any later stream id is the screen share. */
  remoteCameraStreamId: string | null;
}

/**
 * Owns every RTCPeerConnection for the current call and implements the "perfect
 * negotiation" pattern (see MDN) so offer/answer glare between simultaneously-negotiating
 * peers resolves deterministically instead of racing. React components never touch
 * RTCPeerConnection directly; they go through this class.
 */
export class PeerManager {
  private peers = new Map<string, PeerEntry>();
  private videoMaxBitrate: number | undefined;
  private audioMaxBitrate: number | undefined;
  /** Current outgoing camera/mic tracks when they differ from `options.localStream`'s own
   * (e.g. the background-blur canvas track, or a hot-swapped device). Kept here instead of
   * splicing replacements into `options.localStream` itself: that stream object is shared with
   * the rest of the app as "the raw camera/mic", and mutating it once fed the blur processor
   * its own canvas output: a feedback loop that froze the video on the last composited frame. */
  private outgoingVideoTrack: MediaStreamTrack | null = null;
  private outgoingAudioTrack: MediaStreamTrack | null = null;
  /** Holds the outgoing screen-share track (if any), kept as its own MediaStream so remote
   * peers receive it as a distinct stream id from the camera; that's how `ontrack` on the
   * receiving side tells camera and screen apart. */
  private screenStream = new MediaStream();

  constructor(private readonly options: PeerManagerOptions) {}

  /** Creates a connection to `peerId`. `polite` must be true iff `peerId` was already in the room before we joined; the newcomer is always the polite peer on a given connection. */
  addPeer(peerId: string, polite: boolean): void {
    if (this.peers.has(peerId)) return;

    const pc = new RTCPeerConnection({
      iceServers: this.options.iceServers,
      certificates: [this.options.certificate],
    });
    // Negotiated + fixed id: both sides declare this channel upfront instead of one side
    // calling createDataChannel and the other listening for `ondatachannel`, so opening it
    // never triggers its own renegotiation round.
    const dataChannel = pc.createDataChannel(DATA_CHANNEL_LABEL, {
      negotiated: true,
      id: DATA_CHANNEL_ID,
    });
    dataChannel.binaryType = 'arraybuffer';
    dataChannel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;

    const entry: PeerEntry = {
      pc,
      dataChannel,
      polite,
      makingOffer: false,
      ignoreOffer: false,
      pendingCandidates: [],
      pendingMessages: [],
      screenSender: null,
      remoteCameraStreamId: null,
    };
    this.peers.set(peerId, entry);

    // `options.localStream` is only the *grouping* stream here (it gives both tracks one
    // stream id so the remote side can tell camera+mic apart from the screen share); the
    // tracks actually sent are the current outgoing ones, which may have been replaced since
    // the call started (blur canvas track, hot-swapped device).
    const audioTrack = this.outgoingAudioTrack ?? this.options.localStream.getAudioTracks()[0];
    const videoTrack = this.outgoingVideoTrack ?? this.options.localStream.getVideoTracks()[0];
    if (audioTrack) pc.addTrack(audioTrack, this.options.localStream);
    if (videoTrack) pc.addTrack(videoTrack, this.options.localStream);

    const [screenTrack] = this.screenStream.getVideoTracks();
    if (screenTrack) entry.screenSender = pc.addTrack(screenTrack, this.screenStream);

    dataChannel.onopen = () => {
      const queued = entry.pendingMessages;
      entry.pendingMessages = [];
      for (const message of queued) dataChannel.send(JSON.stringify(message));
    };

    dataChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        this.handleTextMessage(peerId, event.data);
      } else {
        this.options.onFileChunk(peerId, event.data as ArrayBuffer);
      }
    };

    pc.onnegotiationneeded = () => {
      void this.handleNegotiationNeeded(peerId, entry);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.options.sendSignal({ to: peerId, candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      if (entry.remoteCameraStreamId === null) entry.remoteCameraStreamId = stream.id;
      const kind = stream.id === entry.remoteCameraStreamId ? 'camera' : 'screen';
      this.options.onRemoteTrack(peerId, stream, kind);
    };

    pc.onconnectionstatechange = () => {
      this.options.onConnectionStateChange(peerId, pc.connectionState);
      // Only safe to set RTP sender parameters once a session has actually been
      // negotiated and the transport is up; applying earlier throws InvalidStateError.
      if (pc.connectionState === 'connected') {
        void this.applyVideoBitrate(entry);
        void this.applyAudioBitrate(entry);
      }
      // restartIce() just flags the next negotiation to include ICE-restart parameters;
      // the existing onnegotiationneeded/perfect-negotiation path does the rest.
      if (pc.connectionState === 'failed') pc.restartIce();
    };
  }

  removePeer(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    entry.pc.onnegotiationneeded = null;
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.dataChannel.onopen = null;
    entry.dataChannel.onmessage = null;
    entry.dataChannel.close();
    entry.pc.close();
    this.peers.delete(peerId);
  }

  private handleTextMessage(peerId: string, raw: string): void {
    try {
      const parsed = dataChannelMessageSchema.safeParse(JSON.parse(raw));
      if (parsed.success) this.options.onChannelMessage(peerId, parsed.data);
      else console.warn(`dropped malformed channel message from ${peerId}`);
    } catch {
      console.warn(`dropped unparseable channel message from ${peerId}`);
    }
  }

  /**
   * Adds `track` as a second, independent video track on every current connection (and any
   * peer added afterwards, via `addPeer`), triggers renegotiation through the existing
   * `onnegotiationneeded`/perfect-negotiation path, unlike `replaceLocalTrack`. Kept separate
   * from the camera track so remote peers can show both as distinct tiles.
   */
  addScreenTrack(track: MediaStreamTrack): void {
    for (const existing of this.screenStream.getVideoTracks())
      this.screenStream.removeTrack(existing);
    this.screenStream.addTrack(track);
    for (const entry of this.peers.values()) {
      entry.screenSender = entry.pc.addTrack(track, this.screenStream);
    }
  }

  /** Removes the screen track from every connection (renegotiates) and clears it for peers added afterwards. */
  removeScreenTrack(): void {
    for (const entry of this.peers.values()) {
      if (entry.screenSender) {
        entry.pc.removeTrack(entry.screenSender);
        entry.screenSender = null;
      }
    }
    for (const existing of this.screenStream.getVideoTracks())
      this.screenStream.removeTrack(existing);
  }

  async handleSignal(
    from: string,
    payload: { description?: SessionDescriptionInit; candidate?: IceCandidateInit },
  ): Promise<void> {
    const entry = this.peers.get(from);
    if (!entry) return;

    if (payload.description) {
      await this.handleRemoteDescription(from, entry, payload.description);
    } else if (payload.candidate) {
      await this.handleRemoteCandidate(entry, payload.candidate);
    }
  }

  destroy(): void {
    for (const peerId of Array.from(this.peers.keys())) this.removePeer(peerId);
  }

  /** Fans out to every peer's data channel (mesh has no server relay for these). Returns the message so the caller can append it to their own local chat history. */
  sendChatMessage(text: string): ChatChannelMessage {
    const message: ChatChannelMessage = {
      type: 'chat',
      id: crypto.randomUUID(),
      text,
      timestamp: Date.now(),
    };
    this.broadcastMessage(message);
    return message;
  }

  sendReaction(emoji: string): void {
    this.broadcastMessage({ type: 'reaction', emoji, timestamp: Date.now() });
  }

  /** Broadcasts one partial or final Web Speech API result to every peer. */
  sendCaption(text: string, isFinal: boolean): void {
    this.broadcastMessage({ type: 'caption', text, isFinal, timestamp: Date.now() });
  }

  /**
   * Sends `file` to every peer as `file-meta`, then chunks over the data channel with
   * backpressure (`bufferedAmountLowThreshold`), then `file-done`. `fileId` is generated by
   * the caller (not here) so it can create a local progress entry before this resolves.
   * `onProgress` reports cumulative bytes read/queued, not per-peer delivery; good enough
   * for a progress bar. Only one transfer should be in flight at a time; a second call
   * before the first finishes will interleave chunks on the wire and confuse receivers.
   */
  async sendFile(
    fileId: string,
    file: File,
    onProgress: (sentBytes: number) => void,
  ): Promise<void> {
    this.broadcastMessage({
      type: 'file-meta',
      fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
    });

    let offset = 0;
    while (offset < file.size) {
      const chunk = await file.slice(offset, offset + FILE_CHUNK_SIZE).arrayBuffer();
      await Promise.all(
        Array.from(this.peers.values()).map((entry) =>
          this.sendChunkWithBackpressure(entry.dataChannel, chunk),
        ),
      );
      offset += chunk.byteLength;
      onProgress(offset);
    }

    this.broadcastMessage({ type: 'file-done', fileId });
  }

  private broadcastMessage(message: DataChannelMessage): void {
    for (const entry of this.peers.values()) {
      if (entry.dataChannel.readyState === 'open') {
        entry.dataChannel.send(JSON.stringify(message));
      } else {
        // The channel is negotiated at connection-creation time but its SCTP association can
        // take a beat longer than media to come up, especially with several connections
        // opening at once in a mesh; queue rather than silently drop.
        entry.pendingMessages.push(message);
      }
    }
  }

  private async sendChunkWithBackpressure(
    channel: RTCDataChannel,
    chunk: ArrayBuffer,
  ): Promise<void> {
    if (channel.readyState !== 'open') return;
    if (channel.bufferedAmount > BUFFERED_AMOUNT_LOW_THRESHOLD) {
      await new Promise<void>((resolve) => {
        channel.onbufferedamountlow = () => resolve();
      });
    }
    channel.send(chunk);
  }

  /**
   * Swaps the outgoing camera/mic track on every current connection via `sender.replaceTrack`:
   * no renegotiation, since the sender and its m-line stay put (used for camera/mic device
   * switching and the background-blur canvas track). The replacement is remembered so peers
   * added afterwards also start with it. Deliberately does NOT touch `options.localStream`:
   * that object is the app-wide "raw camera/mic" stream (it feeds the local tile, the blur
   * processor's source video, and speaking detection), and splicing a processed track into it
   * is what previously froze blur: the processor ended up segmenting its own output. Excludes
   * the screen-share sender (added separately via `addScreenTrack`) so a device switch during
   * a screen share can't accidentally replace the wrong video track.
   */
  async replaceLocalTrack(kind: 'audio' | 'video', track: MediaStreamTrack): Promise<void> {
    if (kind === 'video') this.outgoingVideoTrack = track;
    else this.outgoingAudioTrack = track;

    await Promise.all(
      Array.from(this.peers.values()).map((entry) => {
        const sender = entry.pc
          .getSenders()
          .find((s) => s.track?.kind === kind && s !== entry.screenSender);
        return sender?.replaceTrack(track);
      }),
    );
  }

  /** One connection-level stats snapshot per current peer, for the connection-quality
   * dashboard. Cumulative counters (bytes/packets): the caller derives bitrate/loss-rate by
   * diffing two snapshots over time, since a single `getStats()` call is a point-in-time read. */
  async getStats(): Promise<Record<string, PeerStatsSnapshot>> {
    const result: Record<string, PeerStatsSnapshot> = {};
    await Promise.all(
      Array.from(this.peers.entries()).map(async ([peerId, entry]) => {
        const report = await entry.pc.getStats();
        result[peerId] = parseStatsReport(report);
      }),
    );
    return result;
  }

  /** `undefined` clears the cap ("Auto"). Applies to every current peer's camera sender (not the screen share) and is remembered for peers added afterwards. */
  async setVideoMaxBitrate(maxBitrate: number | undefined): Promise<void> {
    this.videoMaxBitrate = maxBitrate;
    await Promise.all(
      Array.from(this.peers.values()).map((entry) => this.applyVideoBitrate(entry)),
    );
  }

  private async applyVideoBitrate(entry: PeerEntry): Promise<void> {
    const sender = entry.pc
      .getSenders()
      .find((s) => s.track?.kind === 'video' && s !== entry.screenSender);
    if (!sender) return;
    const params = sender.getParameters();
    const [firstEncoding] = params.encodings;
    if (firstEncoding) {
      firstEncoding.maxBitrate = this.videoMaxBitrate;
    } else {
      params.encodings = [{ maxBitrate: this.videoMaxBitrate }];
    }
    try {
      await sender.setParameters(params);
    } catch (err) {
      console.error('failed to apply video bitrate', err);
    }
  }

  /** `undefined` clears the cap ("Auto"). Applies to every current peer's mic sender and is remembered for peers added afterwards. */
  async setAudioMaxBitrate(maxBitrate: number | undefined): Promise<void> {
    this.audioMaxBitrate = maxBitrate;
    await Promise.all(
      Array.from(this.peers.values()).map((entry) => this.applyAudioBitrate(entry)),
    );
  }

  private async applyAudioBitrate(entry: PeerEntry): Promise<void> {
    const sender = entry.pc.getSenders().find((s) => s.track?.kind === 'audio');
    if (!sender) return;
    const params = sender.getParameters();
    const [firstEncoding] = params.encodings;
    if (firstEncoding) {
      firstEncoding.maxBitrate = this.audioMaxBitrate;
    } else {
      params.encodings = [{ maxBitrate: this.audioMaxBitrate }];
    }
    try {
      await sender.setParameters(params);
    } catch (err) {
      console.error('failed to apply audio bitrate', err);
    }
  }

  private async handleNegotiationNeeded(peerId: string, entry: PeerEntry): Promise<void> {
    try {
      entry.makingOffer = true;
      await entry.pc.setLocalDescription();
      this.options.sendSignal({
        to: peerId,
        description: entry.pc.localDescription as unknown as SessionDescriptionInit,
      });
    } catch (err) {
      console.error(`negotiation failed for peer ${peerId}`, err);
    } finally {
      entry.makingOffer = false;
    }
  }

  private async handleRemoteDescription(
    from: string,
    entry: PeerEntry,
    description: SessionDescriptionInit,
  ): Promise<void> {
    const { pc } = entry;
    const offerCollision =
      description.type === 'offer' && (entry.makingOffer || pc.signalingState !== 'stable');

    entry.ignoreOffer = !entry.polite && offerCollision;
    if (entry.ignoreOffer) return;

    // setRemoteDescription() performs an implicit rollback on its own when called with an
    // offer while signalingState is "have-local-offer"; an explicit, separate
    // `setLocalDescription({type: 'rollback'})` issued concurrently (via Promise.all) races
    // with our own still-pending implicit-offer setLocalDescription() call from
    // handleNegotiationNeeded and can leave that promise permanently unresolved (reproduced
    // with 3+ peer connections negotiating close together in one tab).
    await pc.setRemoteDescription(description as RTCSessionDescriptionInit);

    const queued = entry.pendingCandidates;
    entry.pendingCandidates = [];
    for (const candidate of queued) {
      await pc.addIceCandidate(candidate as RTCIceCandidateInit);
    }

    if (description.type === 'offer') {
      await pc.setLocalDescription();
      this.options.sendSignal({
        to: from,
        description: pc.localDescription as unknown as SessionDescriptionInit,
      });
    }
  }

  private async handleRemoteCandidate(
    entry: PeerEntry,
    candidate: IceCandidateInit,
  ): Promise<void> {
    if (!entry.pc.remoteDescription) {
      entry.pendingCandidates.push(candidate);
      return;
    }
    try {
      await entry.pc.addIceCandidate(candidate as RTCIceCandidateInit);
    } catch (err) {
      if (!entry.ignoreOffer) console.error('failed to add ICE candidate', err);
    }
  }
}
