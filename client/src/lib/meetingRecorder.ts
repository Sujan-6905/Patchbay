import fixWebmDuration from 'fix-webm-duration';

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const FRAME_RATE = 30;

/** MP4 with H.264 + AAC is first for playback compatibility: it's the one combination
 * Windows' built-in Media Player (and every stock phone/TV player) decodes natively;
 * MediaRecorder's webm output is a streamed, variable-frame-rate Matroska with no seek index,
 * which Windows' Media Foundation pipeline chokes on (players like VLC carry their own
 * tolerant demuxers and don't care). H.264 encoding also typically lands on the platform's
 * hardware encoder, making it cheaper than software VP8. Where MP4 recording isn't supported
 * (it needs a platform AAC encoder; Chromium builds without proprietary codecs lack it),
 * VP8-webm is the fallback: VP8 deliberately outranks VP9, whose software encode at 720p30
 * saturates a laptop CPU that's simultaneously compositing tiles and possibly running blur
 * segmentation; that contention starved the encoder into dropping long runs of frames. */
const RECORDER_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  // Baseline-profile fallback for hardware encoders that reject High profile. Both MP4
  // entries pin AAC audio explicitly; a generic 'video/mp4' could pair H.264 with Opus,
  // which Windows' player can't decode in an MP4 either, defeating the point.
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];

/** Explicit caps, chosen for 720p30 screen-recording quality at a bitrate any modern laptop
 * encodes in realtime; leaving these unset lets the browser pick, and Chrome's default can
 * spike the encoder load well past what a busy call has to spare. */
const VIDEO_BITS_PER_SECOND = 2_500_000;
const AUDIO_BITS_PER_SECOND = 128_000;

export function pickSupportedMimeType(): string {
  return RECORDER_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

/** A steady tick at `fps` driven from a Web Worker, not requestAnimationFrame. rAF stops
 * entirely while the tab is hidden/minimized and stutters whenever the main thread is busy;
 * both froze the composite mid-recording, leaving long frame gaps that many players choke on
 * outright. Worker message delivery is exempt from the background-tab timer throttling that
 * clamps main-thread setInterval to ~1Hz, so the compositor keeps painting at full rate for
 * the recording's entire life no matter what the tab is doing. Returns a disposer. */
function startFrameClock(fps: number, onTick: () => void): () => void {
  const source = `setInterval(() => postMessage(0), ${Math.round(1000 / fps)});`;
  const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
  const worker = new Worker(url);
  worker.onmessage = onTick;
  return () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}

/** Decodes `blob`'s metadata in a throwaway video element to prove the finished file actually
 * opens with a finite, non-zero duration; the "recording crashes/won't play" class of bug is
 * exactly what this catches before the file ever reaches the user's disk. Resolves false on
 * decode error or a 10s hang rather than rejecting; the caller falls back to the least-mangled
 * blob it has. */
function probeRecording(blob: Blob): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  return new Promise<boolean>((resolve) => {
    const video = document.createElement('video');
    const finish = (ok: boolean) => {
      clearTimeout(timeoutId);
      video.removeAttribute('src');
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timeoutId = setTimeout(() => finish(false), 10_000);
    video.preload = 'metadata';
    video.muted = true;
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) && video.duration > 0);
    video.onerror = () => finish(false);
    video.src = url;
  });
}

/** One tile to composite into the recording: `stream`'s video track is drawn into a grid
 * cell; if `stream` also carries an audio track (screen-share sources typically don't), it's
 * mixed into the recording's single audio track too. `kind` picks how it's fit into its cell:
 * `'camera'` crops to fill (a cropped face is fine), `'screen'` letterboxes instead (cropped
 * text/UI on a shared screen is actual lost content, not just an aesthetic trim). */
export interface RecordingSource {
  key: string;
  label: string;
  stream: MediaStream;
  kind: 'camera' | 'screen';
  /** Where this tile's audio comes from when it isn't `stream` itself. The local tile needs
   * this: with blur on, its display stream is the blur canvas's captureStream, which carries
   * no audio at all; binding the mic to the raw camera/mic stream instead keeps recorded
   * audio continuous across blur toggles (previously the mic dropped out for exactly the span
   * blur was enabled). */
  audioStream?: MediaStream;
}

/** Scale + offset to fit a `contentWidth`x`contentHeight` rect into a `w`x`h` cell: `'cover'`
 * is the canvas equivalent of CSS `object-fit: cover` (fills the cell, crops overflow),
 * `'contain'` is `object-fit: contain` (fits entirely inside, letterboxed). Pure math, kept
 * separate from the actual `drawImage` call so it's unit-testable without a canvas. */
export function computeFit(
  mode: 'cover' | 'contain',
  contentWidth: number,
  contentHeight: number,
  w: number,
  h: number,
): { width: number; height: number; offsetX: number; offsetY: number } {
  const scale =
    mode === 'cover'
      ? Math.max(w / contentWidth, h / contentHeight)
      : Math.min(w / contentWidth, h / contentHeight);
  const width = contentWidth * scale;
  const height = contentHeight * scale;
  return { width, height, offsetX: (w - width) / 2, offsetY: (h - height) / 2 };
}

/** Draws `video` into the `w`x`h` cell at `x`,`y`, cropping (camera) or letterboxing (screen
 * share) as appropriate for `kind`; see `RecordingSource.kind`. */
function drawTile(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: 'camera' | 'screen',
): void {
  const videoWidth = video.videoWidth || 16;
  const videoHeight = video.videoHeight || 9;
  const mode = kind === 'screen' ? 'contain' : 'cover';
  const { width, height, offsetX, offsetY } = computeFit(mode, videoWidth, videoHeight, w, h);

  // `contain` never draws outside its cell by construction (its scale is a `Math.min`), so the
  // clip path below is only needed for `cover`, which can; skipping it is one less path-clip
  // operation per screen-share tile per frame, real cost given this runs at 30fps.
  if (mode === 'contain') {
    ctx.drawImage(video, x + offsetX, y + offsetY, width, height);
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(video, x + offsetX, y + offsetY, width, height);
  ctx.restore();
}

/** Grid layout matching the room's own `repeat(auto-fit, ...)` visual intuition: as square a
 * grid as possible, filled row-major. */
export function gridCell(
  index: number,
  count: number,
): { x: number; y: number; w: number; h: number } {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const w = CANVAS_WIDTH / cols;
  const h = CANVAS_HEIGHT / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: col * w, y: row * h, w, h };
}

const LABEL_FONT = '16px sans-serif';
const LABEL_HEIGHT = 22;

/** Pre-renders a tile's label pill (background + text) onto its own small canvas once, instead
 * of re-measuring and re-drawing the text every single frame at 30fps for content that never
 * changes; this was pure wasted main-thread work on every frame, competing for the same thread
 * that also has to handle tile add/remove, React re-renders, and WebRTC renegotiation right at
 * the moments (screen-share start/stop, tab switches) those are most likely to overlap. */
function buildLabelCanvas(label: string): HTMLCanvasElement {
  const measureCtx = document.createElement('canvas').getContext('2d');
  if (measureCtx) measureCtx.font = LABEL_FONT;
  const textWidth = measureCtx?.measureText(label).width ?? label.length * 8;

  const canvas = document.createElement('canvas');
  canvas.width = textWidth + 12;
  canvas.height = LABEL_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 6, 16);
  return canvas;
}

interface RecordingEntry {
  video: HTMLVideoElement;
  kind: 'camera' | 'screen';
  audioSource: MediaStreamAudioSourceNode | null;
  /** Id of the stream `audioSource` is connected to, so `updateSources` can tell a real
   * audio change apart from a video-only rebind (blur toggle) and leave the mic alone. */
  audioStreamId: string | null;
  labelCanvas: HTMLCanvasElement;
}

/**
 * Records a composite of every visible tile (canvas-mixed video, AudioContext-mixed audio)
 * with MediaRecorder, entirely client-side, no server involvement.
 *
 * The tile set is NOT fixed at start; call `updateSources()` whenever the room's visible
 * tiles change (a peer joins/leaves, someone starts/stops screen sharing) so those tiles
 * appear in the still-running recording instead of being silently frozen out of it.
 */
export class MeetingRecorder {
  private canvas: HTMLCanvasElement | null = null;
  private entries = new Map<string, RecordingEntry>();
  /** Mirrors `entries.values()`; refreshed only when a tile is added or removed, instead of
   * allocating a fresh array from the Map on every single draw-loop frame. */
  private tiles: RecordingEntry[] = [];
  private audioContext: AudioContext | null = null;
  private audioDestination: MediaStreamAudioDestinationNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stopClock: (() => void) | null = null;
  private canvasStream: MediaStream | null = null;
  private captureTrack: CanvasCaptureMediaStreamTrack | null = null;
  private startedAtMs = 0;
  private activeMimeType = '';

  get isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording';
  }

  /** The container/codec string actually chosen for the current/last recording; lets the UI
   * warn about player compatibility only when the webm fallback is in use. */
  get mimeType(): string {
    return this.activeMimeType;
  }

  start(sources: RecordingSource[]): void {
    if (this.isRecording || sources.length === 0) return;

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.canvas = canvas;

    this.audioContext = new AudioContext();
    // Belt and braces: contexts occasionally come up suspended even after a user gesture
    // (aggressive power-saving, some platforms); a suspended context records pure silence.
    void this.audioContext.resume().catch(() => undefined);
    this.audioDestination = this.audioContext.createMediaStreamDestination();
    for (const source of sources) this.addEntry(source);

    // A screen-share video element is far more prone to a mid-frame drawImage exception than a
    // stable webcam feed (resolution changes when the shared window/display is resized, brief
    // not-quite-ready states right after getDisplayMedia resolves, etc). An uncaught throw
    // anywhere in here must never take the loop down; every drawing step is isolated so one
    // bad tile just skips a frame instead of killing the whole recording.
    //
    // The loop is driven by a Worker-based clock at exactly FRAME_RATE (see startFrameClock:
    // rAF pauses in hidden tabs and stutters under load, which is where the frozen/gappy
    // recordings came from), and each successful paint is pushed into the capture track
    // explicitly via requestFrame(); captureStream(0) emits a frame when and only when we say
    // the canvas is ready, so the recorded timeline advances in lockstep with the compositor
    // instead of relying on the browser to notice canvas damage.
    const frameInterval = 1000 / FRAME_RATE;
    let lastDrawMs = 0;
    const draw = () => {
      // Worker ticks queue while the main thread is blocked and then land in a burst; draw at
      // most one frame per half interval so a recovered stall doesn't dump near-duplicate
      // frames with identical timestamps into the file.
      const nowMs = performance.now();
      if (nowMs - lastDrawMs < frameInterval / 2) return;
      lastDrawMs = nowMs;
      try {
        ctx.fillStyle = '#171717';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        const tiles = this.tiles;
        tiles.forEach(({ video, kind, labelCanvas }, i) => {
          try {
            const { x, y, w, h } = gridCell(i, tiles.length);
            if (video.readyState >= video.HAVE_CURRENT_DATA) drawTile(ctx, video, x, y, w, h, kind);
            ctx.drawImage(labelCanvas, x + 8, y + h - 32);
          } catch (err) {
            console.error('recording: failed to draw a tile, skipping it this frame', err);
          }
        });
        this.captureTrack?.requestFrame();
      } catch (err) {
        console.error('recording: draw frame failed', err);
      }
    };

    this.canvasStream = canvas.captureStream(0);
    this.captureTrack =
      (this.canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined) ?? null;
    const recordingStream = new MediaStream([
      ...this.canvasStream.getVideoTracks(),
      ...this.audioDestination.stream.getAudioTracks(),
    ]);

    this.chunks = [];
    const mimeType = pickSupportedMimeType();
    this.activeMimeType = mimeType;
    this.mediaRecorder = new MediaRecorder(recordingStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.mediaRecorder.onerror = (event) => {
      console.error('recording: MediaRecorder error', event);
    };
    // Paint the first frame before the recorder starts so the file's video track begins at
    // t≈0 instead of opening on a stretch with no frames at all.
    draw();
    this.startedAtMs = performance.now();
    this.mediaRecorder.start(1000);
    this.stopClock = startFrameClock(FRAME_RATE, draw);
  }

  /** Adds/removes/rebinds tiles to match `sources` without interrupting the recording; the
   * grid reflows around whatever set of tiles is currently visible. A no-op while not
   * recording. */
  updateSources(sources: RecordingSource[]): void {
    if (!this.isRecording) return;

    const nextKeys = new Set(sources.map((s) => s.key));
    for (const key of Array.from(this.entries.keys())) {
      if (!nextKeys.has(key)) this.removeEntry(key);
    }
    for (const source of sources) {
      const existing = this.entries.get(source.key);
      if (!existing) {
        this.addEntry(source);
        continue;
      }
      // Same tile slot, different underlying stream (e.g. blur toggled the local camera
      // stream); rebind in place instead of tearing down and reshuffling the grid. Video
      // and audio rebind independently: a blur toggle swaps only the video stream, and
      // tearing the mic connection down with it is what used to leave the blurred span of a
      // recording silent.
      if (existing.video.srcObject !== source.stream) {
        existing.video.srcObject = source.stream;
        void existing.video.play().catch(() => undefined);
      }
      existing.kind = source.kind;
      const audioStream = source.audioStream ?? source.stream;
      if (existing.audioStreamId !== audioStream.id) {
        existing.audioSource?.disconnect();
        existing.audioSource = this.connectAudio(audioStream);
        existing.audioStreamId = audioStream.id;
      }
    }
  }

  private addEntry(source: RecordingSource): void {
    const video = document.createElement('video');
    video.srcObject = source.stream;
    video.muted = true;
    video.playsInline = true;
    void video.play().catch(() => undefined);
    const audioStream = source.audioStream ?? source.stream;
    this.entries.set(source.key, {
      video,
      kind: source.kind,
      audioSource: this.connectAudio(audioStream),
      audioStreamId: audioStream.id,
      labelCanvas: buildLabelCanvas(source.label),
    });
    this.tiles = Array.from(this.entries.values());
  }

  private removeEntry(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.video.pause();
    entry.video.srcObject = null;
    entry.audioSource?.disconnect();
    this.entries.delete(key);
    this.tiles = Array.from(this.entries.values());
  }

  private connectAudio(stream: MediaStream): MediaStreamAudioSourceNode | null {
    if (!this.audioContext || !this.audioDestination) return null;
    if (stream.getAudioTracks().length === 0) return null;
    const node = this.audioContext.createMediaStreamSource(stream);
    node.connect(this.audioDestination);
    return node;
  }

  /** Stops recording, finalizes the file (flush → duration patch → decode check), and tears
   * everything down, resolving with the finished recording. Deliberately not instant: the
   * blob handed back has been assembled from every flushed chunk and verified to actually
   * open, rather than whatever happened to be in memory the moment Stop was clicked. */
  async stop(): Promise<Blob | null> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === 'inactive') return null;

    const durationMs = performance.now() - this.startedAtMs;
    const rawBlob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType }));
      // stop() makes the recorder emit one final dataavailable with everything still
      // buffered before firing onstop, so the blob assembled above is complete by contract.
      recorder.stop();
    });

    // The compositor can keep painting while the tail of the file is flushed; stop it only
    // once the recorder has handed over its final chunk.
    this.stopClock?.();
    this.stopClock = null;

    let blob: Blob | null = null;
    if (rawBlob.size === 0) {
      // The encoder produced nothing at all (a MediaRecorder error mid-run, or a start that
      // never got a first frame). Handing the user a 0-byte "recording" is worse than
      // failing loudly; return null and let the caller surface it.
      console.error('recording: no data was captured, refusing to produce an empty file');
    } else if ((recorder.mimeType || this.activeMimeType).includes('webm')) {
      // MediaRecorder streams its webm without a Duration header or seek cues, so the raw
      // blob opens with unknown length and broken seeking in most players, which reads as
      // "the file is corrupt". Stamp the measured duration into the EBML header; if patching
      // fails for any reason, the raw (playable, just unseekable) blob is still the fallback.
      // (MP4 recordings skip this entirely: the patcher is EBML/webm-specific, and Chrome
      // finalizes MP4 metadata itself on stop.)
      const patchedBlob = await fixWebmDuration(rawBlob, durationMs, { logger: false }).catch(
        () => rawBlob,
      );

      // Prove the file we're about to hand over actually decodes. If the patched blob fails
      // the probe (a bad EBML rewrite would corrupt the whole file), fall back to the raw
      // one, which at worst plays without seeking.
      blob = patchedBlob;
      if (patchedBlob !== rawBlob && !(await probeRecording(patchedBlob))) {
        console.error('recording: patched file failed to decode, falling back to the raw blob');
        blob = rawBlob;
      }
    } else {
      blob = rawBlob;
      if (!(await probeRecording(rawBlob))) {
        // Nothing better to fall back to for MP4; still hand it over, but leave evidence.
        console.error('recording: finished file failed the decode probe');
      }
    }

    this.canvasStream?.getTracks().forEach((track) => track.stop());
    this.canvasStream = null;
    this.captureTrack = null;
    for (const key of Array.from(this.entries.keys())) this.removeEntry(key);
    await this.audioContext?.close();
    this.audioContext = null;
    this.audioDestination = null;
    this.canvas = null;
    this.mediaRecorder = null;
    this.chunks = [];

    return blob;
  }
}

export function downloadRecording(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const extension = blob.type.includes('mp4') ? 'mp4' : 'webm';
  a.href = url;
  a.download = `patchbay-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`;
  a.click();
  URL.revokeObjectURL(url);
}
