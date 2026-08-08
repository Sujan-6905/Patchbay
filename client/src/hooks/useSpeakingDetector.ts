import { useEffect, useState } from 'react';

const SPEAKING_THRESHOLD = 0.08;
const FFT_SIZE = 512;

/** Reports whether `stream`'s audio track currently has meaningful volume, for a speaking-highlight indicator. Tears its AudioContext down on every stream change/unmount. */
export function useSpeakingDetector(stream: MediaStream | null): boolean {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      // No analyser to run; state resets to false via the previous run's cleanup below.
      return;
    }

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    let rafId: number;

    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (const sample of data) {
        const normalized = (sample - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      setSpeaking(rms > SPEAKING_THRESHOLD);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      source.disconnect();
      void audioContext.close();
      setSpeaking(false);
    };
  }, [stream]);

  return speaking;
}
