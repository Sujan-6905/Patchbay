import { useEffect, useState } from 'react';

export interface DeviceOption {
  deviceId: string;
  label: string;
}

/** Lists camera/mic devices and re-lists on `devicechange` (device plugged/unplugged). Labels are only populated once mic/cam permission has been granted at least once. */
export function useMediaDevices(): { cameras: DeviceOption[]; microphones: DeviceOption[] } {
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [microphones, setMicrophones] = useState<DeviceOption[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      setCameras(
        devices
          .filter((d) => d.kind === 'videoinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })),
      );
      setMicrophones(
        devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
      );
    }

    void refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, []);

  return { cameras, microphones };
}
