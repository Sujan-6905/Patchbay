import { X } from 'lucide-react';
import { motion } from 'motion/react';
import type { DeviceOption } from '../hooks/useMediaDevices';

interface DevicePickerPopoverProps {
  cameras: DeviceOption[];
  microphones: DeviceOption[];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  onSelectCamera: (deviceId: string) => void;
  onSelectMic: (deviceId: string) => void;
  onClose: () => void;
}

/** Pre-call device picker: a lighter version of the in-call SettingsPanel, without the
 * quality/AI sections that only make sense once a call is in progress. */
export function DevicePickerPopover({
  cameras,
  microphones,
  selectedCameraId,
  selectedMicId,
  onSelectCamera,
  onSelectMic,
  onClose,
}: DevicePickerPopoverProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.97 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      style={{ originY: 1 }}
      className="absolute bottom-full right-0 mb-2 w-72 rounded-lg border border-neutral-700 bg-neutral-800 p-4 text-white shadow-lg"
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
        className="w-full rounded bg-neutral-700 px-2 py-1.5 text-sm outline-none"
      >
        {microphones.map((mic) => (
          <option key={mic.deviceId} value={mic.deviceId}>
            {mic.label}
          </option>
        ))}
      </select>
      <p className="mt-3 text-[11px] leading-snug text-neutral-500">
        More options (video/audio quality, AI summaries) are available from Settings once
        you're in the call.
      </p>
    </motion.div>
  );
}
