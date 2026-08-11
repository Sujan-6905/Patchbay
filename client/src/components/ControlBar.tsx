import type { LucideIcon } from 'lucide-react';
import {
  Captions,
  Circle,
  Copy,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  Settings,
  SmilePlus,
  Sparkles,
  Square,
  SquareActivity,
  Video,
  VideoOff,
} from 'lucide-react';
import { useState } from 'react';

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface ControlBarProps {
  micEnabled: boolean;
  camEnabled: boolean;
  sharingScreen: boolean;
  /** True when another participant is already presenting; only one screen share is allowed at a time. */
  shareDisabled?: boolean;
  shareSupported: boolean;
  chatOpen: boolean;
  unreadCount: number;
  reactionPickerOpen: boolean;
  captionsEnabled: boolean;
  captionsSupported: boolean;
  blurEnabled: boolean;
  blurSupported: boolean;
  statsOpen: boolean;
  recording: boolean;
  recordingSeconds: number;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleShareScreen: () => void;
  onToggleSettings: () => void;
  onToggleChat: () => void;
  onToggleReactionPicker: () => void;
  onToggleCaptions: () => void;
  onToggleBlur: () => void;
  onToggleStats: () => void;
  onToggleRecord: () => void;
  onLeave: () => void;
  onCopyLink: () => void;
}

interface ControlButtonProps {
  icon: LucideIcon;
  label: string;
  /** Stable accessible name, used when the visible `label` changes dynamically (e.g. a
   * recording timer) and would otherwise make the button's a11y name unstable. Defaults to
   * `label`. */
  ariaLabel?: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}

function ControlButton({
  icon: Icon,
  label,
  ariaLabel,
  active = false,
  danger = false,
  disabled = false,
  title,
  onClick,
}: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? ariaLabel ?? label}
      aria-label={ariaLabel ?? label}
      aria-pressed={active}
      className={`flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-white transition-colors ${
        danger
          ? 'bg-red-600 hover:bg-red-500'
          : active
            ? 'bg-blue-500 hover:bg-blue-400'
            : 'bg-neutral-700 hover:bg-neutral-600'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      <Icon size={20} />
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </button>
  );
}

export function ControlBar({
  micEnabled,
  camEnabled,
  sharingScreen,
  shareDisabled = false,
  shareSupported,
  chatOpen,
  unreadCount,
  reactionPickerOpen,
  captionsEnabled,
  captionsSupported,
  blurEnabled,
  blurSupported,
  statsOpen,
  recording,
  recordingSeconds,
  onToggleMic,
  onToggleCam,
  onToggleShareScreen,
  onToggleSettings,
  onToggleChat,
  onToggleReactionPicker,
  onToggleCaptions,
  onToggleBlur,
  onToggleStats,
  onToggleRecord,
  onLeave,
  onCopyLink,
}: ControlBarProps) {
  const [justCopied, setJustCopied] = useState(false);

  function handleCopyLink() {
    onCopyLink();
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 2000);
  }

  return (
    <div className="relative flex flex-wrap items-center justify-center gap-2 rounded-lg bg-neutral-800 p-3">
      <ControlButton
        icon={micEnabled ? Mic : MicOff}
        label={micEnabled ? 'Mute' : 'Unmute'}
        danger={!micEnabled}
        onClick={onToggleMic}
      />
      <ControlButton
        icon={camEnabled ? Video : VideoOff}
        label={camEnabled ? 'Camera off' : 'Camera on'}
        danger={!camEnabled}
        onClick={onToggleCam}
      />
      <ControlButton
        icon={sharingScreen ? MonitorX : MonitorUp}
        label={sharingScreen ? 'Stop sharing' : 'Share screen'}
        active={sharingScreen}
        disabled={!shareSupported || shareDisabled}
        title={
          !shareSupported
            ? 'Screen sharing is not supported in this browser'
            : shareDisabled
              ? 'Someone else is already sharing their screen'
              : undefined
        }
        onClick={onToggleShareScreen}
      />
      <ControlButton
        icon={Sparkles}
        label={blurEnabled ? 'Blur: on' : 'Blur: off'}
        active={blurEnabled}
        disabled={!blurSupported}
        title={blurSupported ? 'Background blur' : 'Background blur is not supported in this browser'}
        onClick={onToggleBlur}
      />
      <ControlButton
        icon={Captions}
        label="CC"
        active={captionsEnabled}
        disabled={!captionsSupported}
        title={captionsSupported ? 'Live captions' : 'Captions are not supported in this browser'}
        onClick={onToggleCaptions}
      />
      <ControlButton
        icon={SquareActivity}
        label="Stats"
        active={statsOpen}
        title="Connection-quality stats"
        onClick={onToggleStats}
      />
      <ControlButton
        icon={recording ? Square : Circle}
        label={recording ? formatDuration(recordingSeconds) : 'Record'}
        ariaLabel={recording ? 'Stop recording' : 'Record'}
        danger={recording}
        title={
          recording
            ? 'Stop recording and download'
            : 'Record a composite of everyone in the meeting (saved to your device)'
        }
        onClick={onToggleRecord}
      />
      <ControlButton icon={Settings} label="Settings" onClick={onToggleSettings} />
      <ControlButton
        icon={SmilePlus}
        label="React"
        active={reactionPickerOpen}
        onClick={onToggleReactionPicker}
      />
      <div className="relative">
        <ControlButton
          icon={MessageSquare}
          label="Chat"
          active={chatOpen}
          onClick={onToggleChat}
        />
        {unreadCount > 0 && (
          <span className="pointer-events-none absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </div>
      <ControlButton
        icon={Copy}
        label={justCopied ? 'Copied!' : 'Copy link'}
        active={justCopied}
        onClick={handleCopyLink}
      />
      <ControlButton icon={LogOut} label="Leave" danger onClick={onLeave} />
    </div>
  );
}
