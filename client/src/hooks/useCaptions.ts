import { useEffect, useRef, useState } from 'react';

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Wraps the Web Speech API for live captions. `isSupported` reflects whether this browser
 * exposes SpeechRecognition at all (only Chrome/Edge/Safari do; feature-detected once, not
 * per render). Chrome auto-stops recognition after a period of silence, so this restarts it
 * in `onend` for as long as `enabled` stays true; the mic is already held by the call, so
 * restarting never re-prompts for permission. */
export function useCaptions(
  enabled: boolean,
  onResult: (text: string, isFinal: boolean) => void,
): { isSupported: boolean } {
  const [Ctor] = useState<SpeechRecognitionCtor | null>(getSpeechRecognitionCtor);

  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    if (!enabled || !Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    let stopped = false;
    // Guards against an engine that errors instantly on every start (headless browsers, or a
    // speech service that's unreachable): without backoff, the onend restart becomes a tight
    // start→error→end loop that pegs a CPU core for the whole call.
    let consecutiveHardErrors = 0;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;
    const MAX_CONSECUTIVE_HARD_ERRORS = 8;

    recognition.onresult = (event) => {
      consecutiveHardErrors = 0;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript.trim();
        if (text) onResultRef.current(text, result.isFinal);
      }
    };

    recognition.onerror = (event) => {
      // Permission was revoked or the platform blocked speech recognition entirely; don't
      // keep retrying (onend would otherwise restart it forever).
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        stopped = true;
        return;
      }
      // 'no-speech' and 'aborted' are the normal silence/lifecycle churn Chrome emits between
      // utterances; they don't count against the engine. Anything else (e.g. 'network') does.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        consecutiveHardErrors += 1;
        if (consecutiveHardErrors >= MAX_CONSECUTIVE_HARD_ERRORS) stopped = true;
      }
    };

    recognition.onend = () => {
      if (stopped) return;
      // Healthy silence cycles restart immediately; after a hard error, back off
      // exponentially so a flaky speech service is retried gently instead of hammered.
      const delayMs =
        consecutiveHardErrors === 0
          ? 0
          : Math.min(30_000, 1000 * 2 ** (consecutiveHardErrors - 1));
      restartTimer = setTimeout(() => {
        if (!stopped) recognition.start();
      }, delayMs);
    };

    recognition.start();

    return () => {
      stopped = true;
      clearTimeout(restartTimer);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    };
  }, [enabled, Ctor]);

  return { isSupported: Ctor !== null };
}
