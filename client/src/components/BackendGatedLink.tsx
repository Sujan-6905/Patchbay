import type { ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { pulseBackendStatusAttention, useBackendStatusStore } from '../store/backendStatusStore';

interface BackendGatedLinkProps extends LinkProps {
  children: ReactNode;
}

/** Drop-in replacement for react-router's `Link`, for destinations that need a live signaling
 * connection (starting or joining a call). Until the backend reports ready, a click is
 * swallowed and the status banner is pulsed into attention instead of navigating. */
export function BackendGatedLink({ children, className, ...linkProps }: BackendGatedLinkProps) {
  const ready = useBackendStatusStore((state) => state.status === 'ready');

  return (
    <Link
      {...linkProps}
      aria-disabled={!ready}
      className={ready ? className : `${className ?? ''} cursor-not-allowed opacity-60`}
      onClick={(event) => {
        if (ready) return;
        event.preventDefault();
        pulseBackendStatusAttention();
      }}
    >
      {children}
    </Link>
  );
}
