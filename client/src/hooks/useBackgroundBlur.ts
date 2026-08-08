import { useEffect, useRef, useState } from 'react';
import { BackgroundBlurProcessor } from '../lib/backgroundBlur';

/** Runs MediaPipe segmentation + canvas compositing on `stream` while `enabled` is true,
 * producing a blurred-background output stream via `canvas.captureStream()`. If the measured
 * fps collapses, `onDegraded` fires once; the caller should treat that as a cue to turn
 * blur back off, since it's a signal this device can't keep up. */
export function useBackgroundBlur(
  stream: MediaStream | null,
  enabled: boolean,
  onDegraded?: () => void,
): { outputStream: MediaStream | null; fps: number; degraded: boolean; isSupported: boolean } {
  const [isSupported] = useState(
    () =>
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function',
  );
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);
  const [fps, setFps] = useState(0);
  const [degraded, setDegraded] = useState(false);

  const onDegradedRef = useRef(onDegraded);
  useEffect(() => {
    onDegradedRef.current = onDegraded;
  }, [onDegraded]);

  useEffect(() => {
    if (!enabled || !stream || !isSupported) return;

    let cancelled = false;

    const processor = new BackgroundBlurProcessor({
      onFpsUpdate: setFps,
      onDegraded: () => {
        setDegraded(true);
        onDegradedRef.current?.();
      },
    });

    processor
      .start(stream)
      .then((blurredStream) => {
        if (cancelled) {
          processor.stop();
          return;
        }
        setDegraded(false);
        setFps(0);
        setOutputStream(blurredStream);
      })
      .catch((err: unknown) => {
        console.error('background blur failed to start', err);
      });

    return () => {
      cancelled = true;
      processor.stop();
      setOutputStream(null);
    };
  }, [enabled, stream, isSupported]);

  return { outputStream, fps, degraded, isSupported };
}
