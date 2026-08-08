import { useEffect, useState } from 'react';
import { getPreferredCameraId, getPreferredMicId } from '../lib/devicePreferences';

export interface LocalMediaError {
  code: 'permission-denied' | 'not-found' | 'unavailable';
  message: string;
}

function describeMediaError(err: unknown): LocalMediaError {
  const name = err instanceof DOMException ? err.name : undefined;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return { code: 'permission-denied', message: 'Camera/microphone access was denied.' };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { code: 'not-found', message: 'No camera or microphone was found on this device.' };
    default:
      return { code: 'unavailable', message: 'Could not access your camera or microphone.' };
  }
}

/** A camera track can end unexpectedly mid-call for reasons outside this app's control (a
 * driver reset, OS-level resource contention with something else claiming the device);
 * without recovery this leaves the local tile permanently frozen with no way back but a full
 * page refresh, which also drops the user out of the room entirely. Re-acquiring just the
 * video device and splicing the fresh track into a new `MediaStream` (keeping the existing mic
 * track alive rather than restarting audio too) turns that into a brief reconnect instead.
 * Bounded so a genuinely disconnected/broken camera surfaces the normal error state rather
 * than retrying forever. */
const MAX_RECOVERY_ATTEMPTS = 3;

/** Acquires the local camera/mic stream and surfaces permission or device failures instead of swallowing them. */
export function useLocalMedia(): { stream: MediaStream | null; error: LocalMediaError | null } {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<LocalMediaError | null>(null);

  useEffect(() => {
    let cancelled = false;
    let liveTracks: MediaStreamTrack[] = [];
    /** The stream most recently handed to callers. Its *current* contents are stopped on
     * cleanup too, not just `liveTracks`; callers (device switching in Room) may have spliced
     * newer tracks into this same stream object, and those would otherwise keep the camera
     * light on after unmount. */
    let currentStream: MediaStream | null = null;
    let recoveryAttempts = 0;

    const preferredCameraId = getPreferredCameraId();
    const preferredMicId = getPreferredMicId();

    function armRecovery(videoTrack: MediaStreamTrack, micTrack: MediaStreamTrack | undefined) {
      videoTrack.addEventListener(
        'ended',
        () => {
          if (cancelled) return;
          recoveryAttempts += 1;
          if (recoveryAttempts > MAX_RECOVERY_ATTEMPTS) {
            setError({
              code: 'unavailable',
              message: 'The camera stopped and could not be recovered. Try refreshing the page.',
            });
            return;
          }
          console.error('camera track ended unexpectedly, attempting to re-acquire it');
          navigator.mediaDevices
            .getUserMedia({
              video: preferredCameraId ? { deviceId: { ideal: preferredCameraId } } : true,
            })
            .then((fresh) => {
              if (cancelled) {
                fresh.getTracks().forEach((track) => track.stop());
                return;
              }
              const freshVideoTrack = fresh.getVideoTracks()[0];
              if (!freshVideoTrack) return;
              const tracks = micTrack ? [freshVideoTrack, micTrack] : [freshVideoTrack];
              liveTracks = tracks;
              armRecovery(freshVideoTrack, micTrack);
              currentStream = new MediaStream(tracks);
              setStream(currentStream);
            })
            .catch((err: unknown) => {
              if (!cancelled) setError(describeMediaError(err));
            });
        },
        { once: true },
      );
    }

    navigator.mediaDevices
      .getUserMedia({
        video: preferredCameraId ? { deviceId: { ideal: preferredCameraId } } : true,
        audio: preferredMicId ? { deviceId: { ideal: preferredMicId } } : true,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        liveTracks = s.getTracks();
        const videoTrack = s.getVideoTracks()[0];
        if (videoTrack) armRecovery(videoTrack, s.getAudioTracks()[0]);
        currentStream = s;
        setStream(s);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeMediaError(err));
      });

    return () => {
      cancelled = true;
      liveTracks.forEach((track) => track.stop());
      currentStream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { stream, error };
}
