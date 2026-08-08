import { FilesetResolver, ImageSegmenter, type ImageSegmenterResult } from '@mediapipe/tasks-vision';

// Pinned to the installed package version so the WASM binaries always match the JS API surface.
const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

const BLUR_PX = 12;
const OUTPUT_FPS = 24;
/** Below this measured fps, a sample window counts as "bad"; blur only auto-disables
 * after several bad windows IN A ROW (see MIN_CONSECUTIVE_BAD_WINDOWS). The original watchdog
 * (8 fps, one 20-frame window) fired after just a few seconds on any laptop where segmentation
 * was slow-but-working, silently killing a blur the user could see working fine. 4 fps is the
 * point where the effect is genuinely unusable rather than merely laggy. */
const MIN_ACCEPTABLE_FPS = 4;
const FPS_SAMPLE_WINDOW = 20;
/** A single slow window can be a GC pause, a tab switch, or the model warming up; only a
 * sustained run of them means the device truly can't keep up. */
const MIN_CONSECUTIVE_BAD_WINDOWS = 3;
/** A single failed/timed-out segmentation call is retried with a freshly-rebuilt segmenter
 * (see `invalidateSegmenter`) rather than immediately giving up; this is what actually turns a
 * WebGL context loss into a brief hiccup instead of blur staying dead until a page refresh. But
 * an unbounded retry loop would spin forever against genuinely broken hardware, so give up and
 * degrade after this many consecutive failures. */
const MAX_CONSECUTIVE_FAILURES = 3;

let sharedSegmenterPromise: Promise<ImageSegmenter> | null = null;
let currentSegmenterInstance: ImageSegmenter | null = null;
let currentSegmenterCanvas: HTMLCanvasElement | null = null;

/** Tears down the cached segmenter so the next `getSegmenter()` call builds a fresh one
 * against a fresh WebGL context, instead of reusing one whose context has died. Also removes
 * the old canvas from the document; each rebuild creates a new one (see `createSegmenterCanvas`
 * for why it needs to stay attached while live), and leaving stale ones behind on every
 * rebuild would leak DOM nodes on hardware unstable enough to need repeated rebuilds. */
function invalidateSegmenter(reason: string): void {
  console.error(`background blur: ${reason}, rebuilding segmenter`);
  const stale = currentSegmenterInstance;
  const staleCanvas = currentSegmenterCanvas;
  currentSegmenterInstance = null;
  currentSegmenterCanvas = null;
  sharedSegmenterPromise = null;
  try {
    stale?.close();
  } catch {
    // The context that owned this instance is already gone; nothing left to release.
  }
  staleCanvas?.remove();
}

/** `ImageSegmenter`'s mask post-processing runs through its own WebGL calculator regardless of
 * the `delegate` option (confirmed via the `segmentation_postprocessor_gl.cc` log line, which
 * fires even with `delegate: 'CPU'`; that option only affects where the neural-net inference
 * itself runs), and on some hardware that context can be lost outright. Intel integrated
 * graphics on Windows is a documented case (google-ai-edge/mediapipe#6296, GPU lacking
 * float/half-float render-target support), and MediaPipe's own answer for a lost WebGL context
 * is that there's no in-place recovery; the graph state doesn't survive it
 * (google-ai-edge/mediapipe#4720). Rather than accept "the user must refresh the page and lose
 * the room" as the only outcome, treat context loss as fatal to *this* segmenter instance only
 * and let `getSegmenter()` build a fresh one on the next tick; see `BackgroundBlurProcessor`'s
 * bounded retry loop, which is what actually drives that rebuild. */
function createSegmenterCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // Kept attached to the document, off-screen, rather than fully detached: browsers can
  // deprioritize (and more readily reclaim) GPU resources for a canvas the compositor doesn't
  // consider part of the visible render tree, and a detached canvas is the extreme case of
  // that. This is the standard workaround for WebGL contexts that must stay alive but have
  // nothing to visually show.
  canvas.style.position = 'fixed';
  canvas.style.left = '-99999px';
  canvas.style.top = '-99999px';
  canvas.style.width = '1px';
  canvas.style.height = '1px';
  document.body.appendChild(canvas);
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault();
      invalidateSegmenter('WebGL context lost');
    },
    { once: true },
  );
  return canvas;
}

/** The WASM fileset + model (a few MB) are loaded once and reused across every call to
 * `start`; re-creating an ImageSegmenter on every toggle would re-fetch and re-init the
 * model each time the user flips background blur on. `delegate: 'CPU'` keeps the neural-net
 * inference itself off the GPU (a small, real-time-on-CPU model), though see the WebGL context
 * loss handling above for why that alone doesn't remove all GPU dependence. */
function getSegmenter(): Promise<ImageSegmenter> {
  sharedSegmenterPromise ??= (async () => {
    const canvas = createSegmenterCanvas();
    currentSegmenterCanvas = canvas;
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
    const segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_ASSET_URL, delegate: 'CPU' },
      canvas,
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
    currentSegmenterInstance = segmenter;
    return segmenter;
  })().catch((err: unknown) => {
    // Don't cache a failed init forever; let the next toggle retry from scratch.
    sharedSegmenterPromise = null;
    currentSegmenterInstance = null;
    currentSegmenterCanvas?.remove();
    currentSegmenterCanvas = null;
    throw err;
  });
  return sharedSegmenterPromise;
}

/** A hung segmentation call (a stalled/lost GPU context, a callback the WASM layer never fires)
 * must never wedge the render loop, so every frame races the real callback against this
 * timeout. Whichever lands first unblocks the loop, which then just moves on to the next frame.
 * Kept short: this is a safety net for a genuinely stuck frame, not a throttle. */
const SEGMENTATION_TIMEOUT_MS = 2000;

/** VIDEO running mode requires strictly-increasing timestamps, and the segmenter is a shared
 * singleton (see `getSegmenter`), so the timestamp source must be global; two processor
 * instances briefly overlapping during a blur toggle would otherwise hand the shared segmenter
 * a non-monotonic timestamp and make it throw. Always at least `performance.now()`, nudged up
 * by 1ms if that hasn't advanced, so it can never repeat or go backwards. */
let lastTimestampMs = 0;
function nextTimestampMs(): number {
  const now = performance.now();
  lastTimestampMs = now > lastTimestampMs ? now : lastTimestampMs + 1;
  return lastTimestampMs;
}

/** Global "a segmentation is currently running on the shared segmenter" guard. VIDEO mode is
 * stateful and `segmentForVideo` must not be called again before the previous call's callback
 * has fired; a single processor's loop already awaits each frame, but two processors can
 * briefly coexist during a toggle, so the guard has to be global. The invariant that makes this
 * safe (and that the previous queue-based design got wrong) is that it is ALWAYS cleared (see
 * `finish` in `segmentFrame`), on the callback, the timeout, AND any thrown error. It can never
 * get stuck true, so it can never silently starve the render loops into a frozen canvas. */
let segmentInFlight = false;

export interface BackgroundBlurCallbacks {
  onFpsUpdate?: (fps: number) => void;
  /** Fires once if measured fps stays below a usable threshold; caller should turn blur off. */
  onDegraded?: () => void;
}

/**
 * Composites a blurred background behind the segmented foreground of a stream's video track
 * onto a canvas, exposed as a new MediaStream via `canvas.captureStream()`. Runs the
 * segmentation + compositing loop via `requestAnimationFrame`; the loop's lifetime is
 * independent of the input stream, so `stop()` must be called explicitly or it keeps burning
 * CPU/GPU after the caller is done with it.
 */
export class BackgroundBlurProcessor {
  private videoEl: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private fgCanvas: HTMLCanvasElement | null = null;
  private fgCtx: CanvasRenderingContext2D | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private maskCtx: CanvasRenderingContext2D | null = null;
  /** Reused across frames: allocating a fresh `ImageData` every frame (the mask is typically
   * a fixed size for the lifetime of one `start()` call) was pure GC churn on hardware this
   * feature is already stressing (integrated graphics). Only reallocated if the mask's own
   * dimensions change. */
  private maskImage: ImageData | null = null;
  private rafId: number | null = null;
  private stopped = false;
  private frameDurations: number[] = [];
  private degradedFired = false;
  private consecutiveFailures = 0;
  private consecutiveBadWindows = 0;

  constructor(private readonly callbacks: BackgroundBlurCallbacks = {}) {}

  async start(stream: MediaStream): Promise<MediaStream> {
    // Fail fast here: if the very first load is broken, the caller should hear about it
    // immediately rather than have `start()` resolve into a loop that just degrades itself.
    await getSegmenter();
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('stream has no video track to blur');
    const { width = 640, height = 480 } = videoTrack.getSettings();

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    this.videoEl = video;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');

    this.fgCanvas = document.createElement('canvas');
    this.fgCanvas.width = width;
    this.fgCanvas.height = height;
    this.fgCtx = this.fgCanvas.getContext('2d');

    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d');

    this.loop();

    return this.canvas.captureStream(OUTPUT_FPS);
  }

  stop(): void {
    this.stopped = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.videoEl?.pause();
    if (this.videoEl) this.videoEl.srcObject = null;
    this.videoEl = null;
    this.canvas = null;
    this.ctx = null;
    this.fgCanvas = null;
    this.fgCtx = null;
    this.maskCanvas = null;
    this.maskCtx = null;
    this.maskImage = null;
  }

  // One render loop per processor, and only ever one. Each `tick` fully awaits its own frame
  // (segmentation + compositing) before scheduling the next, so a processor never overlaps its
  // own inference calls. Crucially, the loop reschedules on EVERY outcome except an explicit
  // stop or a sustained-failure degrade: a frame that throws or times out is logged and skipped,
  // never fatal. Combined with `segmentFrame`'s always-resolves guarantee, there is no path that
  // leaves the canvas frozen while blur is still enabled; the exact failure prior versions hit.
  //
  // `getSegmenter()` is re-fetched each tick (cheap; cached unless `invalidateSegmenter` ran) so
  // a WebGL-context-loss rebuild is picked up on the next frame rather than the loop clinging to
  // a dead segmenter.
  private loop(): void {
    const tick = async () => {
      if (this.stopped || !this.videoEl) return;

      // Another processor (typically one still tearing down from a rapid blur toggle) has the
      // shared segmenter mid-call; skip this frame rather than overlap it. `segmentInFlight` is
      // always cleared, so this can only ever skip briefly, never permanently.
      if (segmentInFlight) {
        this.rafId = requestAnimationFrame(tick);
        return;
      }

      const start = performance.now();
      let ok = false;
      try {
        const segmenter = await getSegmenter();
        if (this.stopped || !this.videoEl) return;
        await this.segmentFrame(segmenter);
        ok = true;
      } catch (err) {
        console.error('background blur: frame failed, skipping it', err);
      }
      if (this.stopped) return;

      if (ok) {
        this.consecutiveFailures = 0;
        this.recordFrameDuration(performance.now() - start);
      } else {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures > MAX_CONSECUTIVE_FAILURES) {
          // Repeated failures (e.g. a genuinely broken GPU context that keeps timing out):
          // give up and let the caller drop back to the plain camera feed instead of spinning.
          if (!this.degradedFired) {
            this.degradedFired = true;
            this.callbacks.onDegraded?.();
          }
          return;
        }
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(() => void tick());
  }

  /** Segments the current video frame and composites it, resolving when done (or rejecting if
   * segmentation/compositing throws or the call times out). The idempotent `finish` guarantees
   * that on EVERY path (the real callback, a thrown error, or the timeout), the in-flight guard
   * is released and the timeout disarmed. That guarantee is the whole point: it is what makes it
   * impossible for a single bad frame to permanently wedge the render loop (the freeze bug). */
  private segmentFrame(segmenter: ImageSegmenter): Promise<void> {
    const video = this.videoEl;
    if (!video) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      segmentInFlight = true;
      let finished = false;
      let timeoutId: ReturnType<typeof setTimeout>;
      const finish = (err?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        segmentInFlight = false;
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      };
      timeoutId = setTimeout(
        () => finish(new Error('segmentation timed out')),
        SEGMENTATION_TIMEOUT_MS,
      );
      try {
        segmenter.segmentForVideo(video, nextTimestampMs(), (result) => {
          // Compositing runs synchronously in here. Wrapping it so a throw still hits `finish`
          // (via the catch) and `result.close()` always runs (via finally) is exactly what the
          // old code got wrong: there, a compositing throw skipped the settle and left the loop
          // hung forever. Here it just rejects this one frame; the loop logs it and moves on.
          try {
            this.composite(result);
            finish();
          } catch (err) {
            finish(err);
          } finally {
            result.close();
          }
        });
      } catch (err) {
        finish(err);
      }
    });
  }

  private composite(result: ImageSegmenterResult): void {
    const { videoEl, ctx, fgCtx, maskCtx, canvas, fgCanvas, maskCanvas } = this;
    if (!videoEl || !ctx || !fgCtx || !maskCtx || !canvas || !fgCanvas || !maskCanvas) return;
    const mask = result.categoryMask;
    if (!mask) return;

    // Sharp foreground frame, then clip it to the person via the mask below.
    fgCtx.drawImage(videoEl, 0, 0, fgCanvas.width, fgCanvas.height);

    if (maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
      maskCanvas.width = mask.width;
      maskCanvas.height = mask.height;
    }
    const maskData = mask.getAsUint8Array();
    if (!this.maskImage || this.maskImage.width !== mask.width || this.maskImage.height !== mask.height) {
      this.maskImage = maskCtx.createImageData(mask.width, mask.height);
    }
    const maskImage = this.maskImage;
    for (let i = 0; i < maskData.length; i += 1) {
      // `selfie_segmenter.tflite`'s category mask is 0 for the found person, 255 ("no label")
      // for background; confirmed directly against Google's own official Android sample for
      // this exact model file (OverlayView.kt in google-ai-edge/mediapipe-samples: "selfie
      // segmentation returns 0 or 255U ... with 0 being the found person, 255U for no label").
      // NOT the generic 0=background/1=person convention documented for category masks in
      // general; this model's output is the opposite of that, which is what made this
      // particular bug (person blurred, background sharp) so persistent: the compositing
      // operations below were always correct, only this single condition was inverted.
      const alpha = maskData[i] === 0 ? 255 : 0;
      maskImage.data[i * 4 + 3] = alpha;
    }
    maskCtx.putImageData(maskImage, 0, 0);

    fgCtx.globalCompositeOperation = 'destination-in';
    fgCtx.drawImage(maskCanvas, 0, 0, fgCanvas.width, fgCanvas.height);
    fgCtx.globalCompositeOperation = 'source-over';

    ctx.filter = `blur(${BLUR_PX}px)`;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    ctx.filter = 'none';
    ctx.drawImage(fgCanvas, 0, 0);
  }

  private recordFrameDuration(durationMs: number): void {
    this.frameDurations.push(durationMs);
    if (this.frameDurations.length < FPS_SAMPLE_WINDOW) return;
    const avgMs = this.frameDurations.reduce((a, b) => a + b, 0) / this.frameDurations.length;
    this.frameDurations = [];
    const fps = Math.round(1000 / avgMs);
    this.callbacks.onFpsUpdate?.(fps);
    if (fps < MIN_ACCEPTABLE_FPS) {
      this.consecutiveBadWindows += 1;
      if (this.consecutiveBadWindows >= MIN_CONSECUTIVE_BAD_WINDOWS && !this.degradedFired) {
        this.degradedFired = true;
        this.callbacks.onDegraded?.();
      }
    } else {
      this.consecutiveBadWindows = 0;
    }
  }
}
