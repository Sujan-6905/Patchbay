import { X } from 'lucide-react';
import { motion } from 'motion/react';
import type { DeviceOption } from '../hooks/useMediaDevices';

export type QualityPreset = 'auto' | '720p' | '360p';
export type AudioQualityPreset = 'auto' | 'high' | 'low';

interface SettingsPanelProps {
  cameras: DeviceOption[];
  microphones: DeviceOption[];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  quality: QualityPreset;
  audioQuality: AudioQualityPreset;
  onSelectCamera: (deviceId: string) => void;
  onSelectMic: (deviceId: string) => void;
  onSelectQuality: (quality: QualityPreset) => void;
  onSelectAudioQuality: (quality: AudioQualityPreset) => void;
  onClose: () => void;
}

const QUALITY_OPTIONS: { value: QualityPreset; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '720p', label: '720p' },
  { value: '360p', label: '360p' },
];

const AUDIO_QUALITY_OPTIONS: { value: AudioQualityPreset; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Data saver' },
];

export function SettingsPanel({
  cameras,
  microphones,
  selectedCameraId,
  selectedMicId,
  quality,
  audioQuality,
  onSelectCamera,
  onSelectMic,
  onSelectQuality,
  onSelectAudioQuality,
  onClose,
}: SettingsPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      style={{ originY: 1 }}
      className="absolute bottom-full mb-2 max-h-[80vh] w-72 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-800 p-4 text-white shadow-lg"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Settings</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="text-neutral-400 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      <label className="mb-1 block text-xs text-neutral-400">Camera</label>
      <select
        value={selectedCameraId ?? ''}
        onChange={(e) => onSelectCamera(e.target.value)}
        className="mb-3 w-full rounded bg-neutral-700 px-2 py-1.5 text-sm outline-none"
      >
        {cameras.map((cam) => (
          <option key={cam.deviceId} value={cam.deviceId}>
            {cam.label}
          </option>
        ))}
      </select>

      <label className="mb-1 block text-xs text-neutral-400">Microphone</label>
      <select
        value={selectedMicId ?? ''}
        onChange={(e) => onSelectMic(e.target.value)}
        className="mb-3 w-full rounded bg-neutral-700 px-2 py-1.5 text-sm outline-none"
      >
        {microphones.map((mic) => (
          <option key={mic.deviceId} value={mic.deviceId}>
            {mic.label}
          </option>
        ))}
      </select>

      <label className="mb-1 block text-xs text-neutral-400">Video quality</label>
      <div className="flex gap-2">
        {QUALITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelectQuality(opt.value)}
            className={`flex-1 rounded px-2 py-1.5 text-sm ${
              quality === opt.value ? 'bg-blue-500' : 'bg-neutral-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <label className="mb-1 mt-3 block text-xs text-neutral-400">Audio quality</label>
      <div className="mb-3 flex gap-2">
        {AUDIO_QUALITY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelectAudioQuality(opt.value)}
            className={`flex-1 rounded px-2 py-1.5 text-sm ${
              audioQuality === opt.value ? 'bg-blue-500' : 'bg-neutral-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

    </motion.div>
  );
}
