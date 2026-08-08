import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { BackendStatus } from '../store/backendStatusStore';
import {
  describeBackendStatus,
  retryBackendWake,
  useBackendStatusStore,
} from '../store/backendStatusStore';

const READY_DISPLAY_MS = 2_800;

const DOT_COLOR: Record<BackendStatus, string> = {
  checking: 'bg-blue-500 animate-pulse',
  waking: 'bg-blue-500 animate-pulse',
  unreachable: 'bg-red-500',
  ready: 'bg-emerald-500',
};

/** Fixed, scene-independent pill reporting backend connectivity. Stays visible over every
 * section of the home page (not just the hero) since a visitor may well be scrolled past it
 * by the time a free-tier backend finishes waking up, and briefly confirms a successful
 * connection instead of vanishing the instant it happens, since that's also the moment the
 * CTAs it was gating quietly become clickable. */
export function BackendStatusBanner({ reduced }: { reduced: boolean }) {
  const status = useBackendStatusStore((state) => state.status);
  const attentionPing = useBackendStatusStore((state) => state.attentionPing);

  // Resets the moment `status` itself changes (not on every re-render, e.g. a heartbeat that
  // reaffirms "ready" without a real transition): the recommended way to adjust state in
  // response to a changing value without routing it through an effect.
  const [prevStatus, setPrevStatus] = useState(status);
  const [readyDismissed, setReadyDismissed] = useState(false);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (status === 'ready') setReadyDismissed(false);
  }

  // The dismiss timer itself is a genuine external-system effect (setTimeout), unlike the
  // reset above.
  useEffect(() => {
    if (status !== 'ready') return;
    const timer = setTimeout(() => setReadyDismissed(true), READY_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const visible = status !== 'ready' || !readyDismissed;

  return (
    // pointer-events-none on this full-width strip, restored only on the pill itself below.
    // Otherwise the fixed band sits above the header across the entire viewport width and
    // swallows clicks meant for anything sharing its vertical space (the GitHub link, in
    // particular), whether or not the pill is currently rendered there.
    <div
      aria-hidden={!visible}
      className="pointer-events-none fixed inset-x-0 top-4 z-[75] flex justify-center px-4"
    >
      <AnimatePresence>
        {visible && (
          <motion.div
            key={`${status}-${attentionPing}`}
            role="status"
            initial={reduced ? false : { opacity: 0, y: -12 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: [1, 1.04, 1] }}
            exit={reduced ? undefined : { opacity: 0, y: -12 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-full bg-black/75 py-2 pl-4 pr-3 shadow-lg backdrop-blur"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 shrink-0 rounded-full ${DOT_COLOR[status]}`}
            />
            <span className="font-head text-xs leading-snug text-white/85">
              {describeBackendStatus(status)}
            </span>
            {status === 'unreachable' && (
              <button
                type="button"
                onClick={() => retryBackendWake()}
                className="shrink-0 rounded-full bg-white/10 px-3 py-1 font-head text-xs font-semibold text-white hover:bg-white/20"
              >
                Retry
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
