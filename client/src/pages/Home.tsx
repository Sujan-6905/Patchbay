import Lenis from 'lenis';
import type { MotionValue } from 'motion/react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackendGatedLink } from '../components/BackendGatedLink';
import { BackendStatusBanner } from '../components/BackendStatusBanner';
import { useBackgroundBlur } from '../hooks/useBackgroundBlur';

const GITHUB_URL = 'https://github.com/Sujan-6905/Patchbay';

const EASE_REVEAL = [0.76, 0, 0.24, 1] as const;
const EASE_SOFT = [0.22, 1, 0.36, 1] as const;

/** One backdrop color per scene; a fixed layer cross-fades between them as sections take the
 * viewport, so the page moves through color worlds instead of sitting on one dark theme. */
const SCENE_COLORS: Record<string, string> = {
  night: '#0a0c10',
  deep: '#0c1422',
  paper: '#e9e7e0',
};

function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

/* ---------------------------------- preloader ---------------------------------- */

function Preloader({ onDone }: { onDone: () => void }) {
  const [count, setCount] = useState(0);
  const [exiting, setExiting] = useState(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const DURATION_MS = 1050;
    let rafId: number;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / DURATION_MS);
      // Ease-out so the counter sprints early and settles into 100, like a connection coming up.
      setCount(Math.round((1 - Math.pow(1 - t, 3)) * 100));
      if (t < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setExiting(true);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex flex-col justify-between bg-[#0a0c10] px-6 py-6 sm:px-10"
      animate={exiting ? { y: '-100%' } : { y: 0 }}
      transition={{ duration: 0.75, ease: EASE_REVEAL }}
      onAnimationComplete={() => {
        if (exiting) onDoneRef.current();
      }}
    >
      <div className="font-head text-sm font-medium text-[#e9e7e0]/60">patchbay</div>
      <div className="flex items-end justify-between">
        <p className="font-accent text-lg italic text-[#e9e7e0]/50">the direct way to talk</p>
        <span className="font-head text-7xl font-light tabular-nums leading-none text-[#e9e7e0] sm:text-8xl">
          {count}
        </span>
      </div>
    </motion.div>
  );
}

/* ------------------------------ cursor + magnetics ------------------------------ */

/** A lagging ring that chases the native cursor (which stays visible; this is an accent, not
 * a replacement) and swells over anything marked data-cursor. Mounted only for fine pointers. */
function CursorRing() {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const springX = useSpring(x, { stiffness: 400, damping: 40, mass: 0.6 });
  const springY = useSpring(y, { stiffness: 400, damping: 40, mass: 0.6 });
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      setHovering(!!(e.target as Element | null)?.closest?.('[data-cursor]'));
    };
    window.addEventListener('mousemove', move, { passive: true });
    return () => window.removeEventListener('mousemove', move);
  }, [x, y]);

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[80] hidden lg:block"
      style={{ x: springX, y: springY }}
    >
      <motion.div
        className="-ml-3 -mt-3 h-6 w-6 rounded-full border border-current text-blue-500 mix-blend-difference"
        animate={{ scale: hovering ? 2.2 : 1, opacity: hovering ? 0.9 : 0.5 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      />
    </motion.div>
  );
}

/** Nudges its child toward the cursor while hovered: the classic magnetic button. */
function Magnetic({ children, strength = 0.35 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 220, damping: 18 });
  const springY = useSpring(y, { stiffness: 220, damping: 18 });

  return (
    <motion.div
      ref={ref}
      className="inline-block"
      style={{ x: springX, y: springY }}
      onMouseMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        x.set((e.clientX - rect.left - rect.width / 2) * strength);
        y.set((e.clientY - rect.top - rect.height / 2) * strength);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/** Link text that rolls to a duplicate line on hover. */
function RollText({ children }: { children: string }) {
  return (
    <span className="group/roll relative inline-block overflow-hidden align-bottom">
      <span className="block transition-transform duration-300 ease-[cubic-bezier(0.76,0,0.24,1)] group-hover/roll:-translate-y-full">
        {children}
      </span>
      <span
        aria-hidden="true"
        className="absolute left-0 top-full block transition-transform duration-300 ease-[cubic-bezier(0.76,0,0.24,1)] group-hover/roll:-translate-y-full"
      >
        {children}
      </span>
    </span>
  );
}

/* --------------------------------- camera demo --------------------------------- */

type DemoStatus = 'idle' | 'starting' | 'live' | 'blocked';

/** The page's show-don't-tell moment: your own camera, running through the app's actual
 * on-device blur pipeline, before you've created anything or told anyone your name. */
function CameraDemo({ reduced }: { reduced: boolean }) {
  const [status, setStatus] = useState<DemoStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [blurOn, setBlurOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { outputStream: blurredStream, isSupported: blurSupported } = useBackgroundBlur(
    stream,
    blurOn,
    () => setBlurOn(false),
  );
  const shownStream = blurOn && blurredStream ? blurredStream : stream;

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = shownStream;
  }, [shownStream]);

  // The demo asks for video only (no mic; nothing here plays audio), and releases the camera
  // the moment the page unmounts.
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [stream]);

  async function enableCamera() {
    setStatus('starting');
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(captured);
      setStatus('live');
    } catch {
      setStatus('blocked');
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
        data-cursor={status === 'idle' ? true : undefined}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full scale-x-[-1] object-cover transition-opacity duration-700 ${
            status === 'live' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {status !== 'live' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center">
            {status === 'blocked' ? (
              <>
                <p className="font-accent text-2xl italic text-[#e9e7e0]/80">
                  No camera, no problem.
                </p>
                <p className="max-w-sm text-sm leading-relaxed text-[#e9e7e0]/45">
                  Permission was declined or no camera was found. The call itself will ask again
                  when you start one.
                </p>
              </>
            ) : (
              <>
                <p className="font-accent text-2xl italic text-[#e9e7e0]/80 sm:text-3xl">
                  This rectangle is yours.
                </p>
                <button
                  type="button"
                  onClick={() => void enableCamera()}
                  disabled={status === 'starting'}
                  className="rounded-full border border-[#e9e7e0]/25 px-7 py-3 font-head text-sm font-medium text-[#e9e7e0] transition-colors duration-300 hover:border-blue-500 hover:bg-blue-500 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-60"
                >
                  {status === 'starting' ? 'Waking the camera…' : 'Turn on my camera'}
                </button>
              </>
            )}
          </div>
        )}

        {status === 'live' && (
          <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3">
            <span className="rounded-full bg-black/60 px-3 py-1 font-head text-xs font-medium text-white backdrop-blur">
              You · live · local · unrecorded
            </span>
            {blurSupported && (
              <button
                type="button"
                onClick={() => setBlurOn((prev) => !prev)}
                aria-pressed={blurOn}
                className={`rounded-full px-4 py-1.5 font-head text-xs font-semibold backdrop-blur transition-colors duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 ${
                  blurOn ? 'bg-blue-500 text-white' : 'bg-black/60 text-white hover:bg-black/80'
                }`}
              >
                {blurOn ? 'Blur: on' : 'Try the blur'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <p className="max-w-md text-sm leading-relaxed text-[#e9e7e0]/45">
          Rendered entirely in your browser, blur included. Nothing is uploaded, because there's
          nowhere to upload it to.
        </p>
        {status === 'live' && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE_SOFT }}
          >
            <BackendGatedLink
              to="/start"
              data-cursor
              className="font-head text-sm font-semibold text-[#e9e7e0] underline decoration-blue-500 decoration-2 underline-offset-4 hover:text-white"
            >
              <RollText>Looks good? Start a call</RollText>
            </BackendGatedLink>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- manifesto ---------------------------------- */

interface ManifestoWord {
  text: string;
  accent?: boolean;
}

const MANIFESTO: ManifestoWord[] = (
  'A patchbay is the studio panel where an engineer joins two lines with ' +
  '*one *cable, no switchboard in the middle. This app works the same way. Your video ' +
  'travels *directly *between browsers, encrypted by WebRTC itself. Zero media servers. ' +
  'Four seats. Six direct lines. Nothing stored, because there is *nowhere *to store it.'
)
  .split(' ')
  .map((raw) => (raw.startsWith('*') ? { text: raw.slice(1), accent: true } : { text: raw }));

function ScrubWord({
  word,
  index,
  total,
  progress,
  reduced,
}: {
  word: ManifestoWord;
  index: number;
  total: number;
  progress: MotionValue<number>;
  reduced: boolean;
}) {
  const start = index / total;
  const opacity = useTransform(progress, [start, start + 1 / total], [0.14, 1]);
  return (
    <motion.span
      style={reduced ? undefined : { opacity }}
      className={word.accent ? 'font-accent italic text-blue-600' : undefined}
    >
      {word.text}{' '}
    </motion.span>
  );
}

/** The story, revealed word by word as it scrolls through the viewport, reading pace set by
 * scroll pace, with a real patchbay photo alongside it as the literal reference for the
 * metaphor the text is making. */
function Manifesto({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.85', 'end 0.7'],
  });

  return (
    <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-16">
      <p
        ref={ref}
        className="font-head max-w-5xl text-[clamp(1.6rem,3.4vw,3.1rem)] font-medium leading-[1.25] tracking-tight text-[#16171c]"
      >
        {MANIFESTO.map((word, i) => (
          <ScrubWord
            key={i}
            word={word}
            index={i}
            total={MANIFESTO.length}
            progress={scrollYProgress}
            reduced={reduced}
          />
        ))}
      </p>
      <motion.div
        initial={reduced ? false : { opacity: 0, x: 28 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.7, ease: EASE_SOFT }}
        className="aspect-[3/2] overflow-hidden rounded-2xl border border-[#16171c]/10 shadow-[0_18px_50px_-12px_rgba(20,21,26,0.15)]"
      >
        <img
          src="/patchbay-jacks.jpg"
          alt="A real analog patchbay: cables patched directly from jack to jack, no switchboard in between"
          width={2048}
          height={1365}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </motion.div>
    </div>
  );
}

/* ------------------------------- features index -------------------------------- */

interface Feature {
  id: string;
  title: string;
  note: string;
}

const FEATURES: Feature[] = [
  {
    id: 'mesh',
    title: 'Mesh video',
    note: 'Up to four people, every pair on its own direct line.',
  },
  { id: 'screen', title: 'Screen share', note: 'Rides alongside your camera as a second tile.' },
  {
    id: 'chat',
    title: 'Chat & reactions',
    note: 'Over the data channel. The server never sees them.',
  },
  { id: 'files', title: 'File drops', note: 'Up to 50 MB, browser to browser, no upload step.' },
  { id: 'captions', title: 'Live captions', note: 'Generated on your device. Free, private.' },
  { id: 'blur', title: 'Background blur', note: 'On-device segmentation. Try it just below.' },
  { id: 'recap', title: 'AI recap', note: 'Summaries on us, free. Leave with the minutes.' },
  { id: 'stats', title: 'Wire stats', note: 'Bitrate, RTT, jitter, and whether TURN stepped in.' },
];

/** Tiny hand-built vignette per feature for the hover preview card; no icon set. */
function FeatureVignette({ id }: { id: string }) {
  switch (id) {
    case 'mesh':
      return (
        <div className="grid h-full w-full grid-cols-2 gap-1.5 p-3">
          {['bg-blue-500/90', 'bg-[#16171c]/80', 'bg-[#16171c]/60', 'bg-blue-500/50'].map(
            (c, i) => (
              <div key={i} className={`rounded-md ${c}`} />
            ),
          )}
        </div>
      );
    case 'screen':
      return (
        <div className="flex h-full w-full items-center justify-center p-3">
          <div className="h-full w-2/3 rounded-md border-2 border-[#16171c]/70 p-1.5">
            <div className="h-2 w-1/2 rounded-sm bg-[#16171c]/50" />
          </div>
          <div className="-ml-4 mt-8 h-1/2 w-1/4 rounded-md bg-blue-500/90" />
        </div>
      );
    case 'chat':
      return (
        <div className="flex h-full w-full flex-col justify-center gap-1.5 p-4">
          <div className="h-4 w-2/3 self-start rounded-full bg-[#16171c]/70" />
          <div className="h-4 w-1/2 self-end rounded-full bg-blue-500/90" />
          <div className="h-4 w-1/3 self-start rounded-full bg-[#16171c]/40" />
        </div>
      );
    case 'files':
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4">
          <div className="h-2.5 w-3/4 overflow-hidden rounded-full bg-[#16171c]/20">
            <div className="h-full w-2/3 rounded-full bg-blue-500" />
          </div>
          <span className="font-head text-[10px] font-semibold text-[#16171c]/60">
            34.1 / 50 MB
          </span>
        </div>
      );
    case 'captions':
      return (
        <div className="flex h-full w-full items-end justify-center p-4">
          <span className="rounded-md bg-[#16171c]/85 px-2.5 py-1 font-head text-[10px] text-white">
            “…straight from you to them”
          </span>
        </div>
      );
    case 'blur':
      return (
        <div className="relative h-full w-full overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-400/60 via-[#16171c]/30 to-blue-600/50 blur-md" />
          <div className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#16171c]" />
        </div>
      );
    case 'recap':
      return (
        <div className="flex h-full w-full flex-col justify-center gap-1.5 p-5">
          <div className="h-2 w-1/3 rounded-full bg-blue-500" />
          <div className="h-1.5 w-full rounded-full bg-[#16171c]/30" />
          <div className="h-1.5 w-5/6 rounded-full bg-[#16171c]/30" />
          <div className="h-1.5 w-2/3 rounded-full bg-[#16171c]/30" />
        </div>
      );
    case 'stats':
      return (
        <svg viewBox="0 0 100 50" className="h-full w-full p-3" aria-hidden="true">
          <polyline
            points="0,38 14,30 28,34 42,18 56,24 70,10 84,16 100,8"
            fill="none"
            stroke="#3b82f6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

/** An index, not a card grid: feature names set large; on desktop a preview card chases the
 * cursor over whichever row is live. Notes stay visible at every size, so nothing is
 * hover-gated for keyboard or touch. */
function FeaturesIndex({ reduced }: { reduced: boolean }) {
  const [active, setActive] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewX = useMotionValue(0);
  const previewY = useMotionValue(0);
  const springX = useSpring(previewX, { stiffness: 250, damping: 28 });
  const springY = useSpring(previewY, { stiffness: 250, damping: 28 });

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseMove={(e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        previewX.set(e.clientX - rect.left + 28);
        previewY.set(e.clientY - rect.top - 70);
      }}
      onMouseLeave={() => setActive(null)}
    >
      <div>
        {FEATURES.map((feature, i) => (
          <motion.div
            key={feature.id}
            initial={reduced ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.55, delay: (i % 4) * 0.05, ease: EASE_SOFT }}
            onMouseEnter={() => setActive(feature.id)}
            className="group border-t border-[#16171c]/15 py-5 transition-colors duration-300 last:border-b hover:bg-[#16171c]/[0.04] sm:py-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 px-1 sm:px-3">
              <h3 className="font-head text-[clamp(1.7rem,4.4vw,3.4rem)] font-semibold leading-none tracking-tight text-[#16171c] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-3">
                {feature.title}
              </h3>
              {/* Fixed-width column (not max-w) so every row's note starts at the same x;
                  content-hugging widths made each note begin wherever its text happened to
                  end, which read as ragged misalignment down the page. */}
              <p className="w-full max-w-xs text-sm leading-snug text-[#16171c]/55 sm:w-72 sm:shrink-0">
                {feature.note}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Desktop-only floating preview; pure garnish, every fact lives in the rows above. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 z-10 hidden h-36 w-52 overflow-hidden rounded-xl bg-[#f6f5f0] shadow-[0_18px_50px_-12px_rgba(20,21,26,0.35)] ring-1 ring-[#16171c]/10 lg:block"
        style={{ x: springX, y: springY }}
        animate={{ opacity: active ? 1 : 0, scale: active ? 1 : 0.9 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {active && <FeatureVignette id={active} />}
      </motion.div>
    </div>
  );
}

/* ------------------------------------ home ------------------------------------- */

const MARQUEE_ITEMS = [
  'free',
  'open source',
  'no accounts',
  'no tracking',
  'peer-to-peer',
  'typescript end to end',
];

export function Home() {
  const reduced = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll();
  const readingProgress = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 28,
    mass: 0.4,
  });
  const [introDone, setIntroDone] = useState(
    () => reduced || sessionStorage.getItem('patchbay.introSeen') === '1',
  );
  const [scene, setScene] = useState('night');
  const sceneRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (introDone) sessionStorage.setItem('patchbay.introSeen', '1');
  }, [introDone]);

  // Inertia scrolling for this page only; a large part of why heavily art-directed sites
  // feel physical. Skipped entirely for reduced motion.
  useEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({ lerp: 0.11 });
    let rafId: number;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, [reduced]);

  // Cross-fade the fixed backdrop to whichever scene owns the viewport.
  useEffect(() => {
    const root = sceneRootRef.current;
    if (!root) return;
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-scene]'));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setScene(entry.target.getAttribute('data-scene') ?? 'night');
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const [finePointer] = useState(() => window.matchMedia('(pointer: fine)').matches);

  const heroDelay = useMemo(() => (introDone ? 0 : 0.85), [introDone]);

  const enter = (delay: number) => ({
    initial: reduced ? false : ({ opacity: 0, y: 30 } as const),
    animate: introDone ? { opacity: 1, y: 0 } : undefined,
    transition: { duration: 0.85, delay: heroDelay + delay, ease: EASE_SOFT },
  });

  return (
    // `isolate` is load-bearing: the scene backdrop below sits at z -10, and without a local
    // stacking context it would paint behind the app shell's own background and never be seen.
    <div ref={sceneRootRef} className="home-grain relative isolate">
      {!introDone && <Preloader onDone={() => setIntroDone(true)} />}
      {finePointer && !reduced && <CursorRing />}
      <BackendStatusBanner reduced={reduced} />

      {/* Reading progress along the top edge, a quiet cue that there's more below the fold. */}
      <motion.div
        aria-hidden="true"
        style={{ scaleX: readingProgress }}
        className="fixed inset-x-0 top-0 z-[70] h-[3px] origin-left bg-blue-500"
      />

      {/* The color world: one fixed layer, cross-faded per scene. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 -z-10 transition-colors duration-[900ms] ease-in-out"
        style={{ backgroundColor: SCENE_COLORS[scene] }}
      />

      {/* ---------------------------------- hero ---------------------------------- */}
      <section data-scene="night" className="relative flex min-h-svh flex-col px-5 sm:px-10">
        <motion.header {...enter(0.05)} className="flex items-center justify-between py-5">
          <span className="font-head text-lg font-bold tracking-tight text-[#e9e7e0]">
            patchbay
            <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-blue-500 align-middle" />
          </span>
          <nav className="flex items-center gap-6">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              data-cursor
              className="flex items-center gap-2 font-head text-sm font-medium text-[#e9e7e0]/60 hover:text-[#e9e7e0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              <GitHubIcon size={16} />
              <RollText>source ↗</RollText>
            </a>
            <Magnetic>
              <BackendGatedLink
                to="/start"
                data-cursor
                className="hidden rounded-full bg-[#e9e7e0] px-5 py-2.5 font-head text-sm font-semibold text-[#0a0c10] transition-colors duration-300 hover:bg-blue-500 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 sm:inline-block"
              >
                Start a call
              </BackendGatedLink>
            </Magnetic>
          </nav>
        </motion.header>

        {/* Sized so the whole opening statement (headline, tagline, both CTAs, and the footer
            strip) fits inside one viewport at 100% zoom (the previous 9.5vw headline pushed
            everything below the fold; this is that layout at roughly its old 80%-zoom scale). */}
        <div className="flex flex-1 flex-col justify-center py-6">
          <h1 className="font-head text-[clamp(2.5rem,7.5vw,7rem)] font-semibold leading-[0.98] tracking-[-0.03em] text-[#e9e7e0]">
            {(
              [
                { text: 'Video calls with', accent: false },
                { text: 'nobody', accent: true },
                { text: 'in between.', accent: false },
              ] as const
            ).map((line, i) => (
              <span key={line.text} className="block overflow-hidden pb-[0.06em]">
                <motion.span
                  className={`block ${
                    line.accent
                      ? 'font-accent font-normal italic tracking-normal text-blue-500'
                      : ''
                  }`}
                  initial={reduced ? false : { y: '105%' }}
                  animate={introDone ? { y: 0 } : undefined}
                  transition={{
                    duration: 0.9,
                    delay: heroDelay + 0.1 + i * 0.09,
                    ease: EASE_REVEAL,
                  }}
                >
                  {line.text}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.div
            {...enter(0.45)}
            className="mt-8 flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between"
          >
            <p className="max-w-md text-[15px] leading-relaxed text-[#e9e7e0]/55">
              Free peer-to-peer meetings, browser to browser: screen share, live captions, file
              drops and AI recaps. No account, no install, no middleman.
            </p>
            <div className="flex items-center gap-6">
              <Magnetic>
                <BackendGatedLink
                  to="/start"
                  data-cursor
                  className="inline-block rounded-full bg-blue-500 px-7 py-3.5 font-head text-sm font-semibold text-white transition-colors duration-300 hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                >
                  Start a call
                </BackendGatedLink>
              </Magnetic>
              <Magnetic>
                <BackendGatedLink
                  to="/join"
                  data-cursor
                  className="inline-block rounded-full border border-[#e9e7e0]/30 px-7 py-3.5 font-head text-sm font-semibold text-[#e9e7e0] transition-colors duration-300 hover:border-blue-500 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
                >
                  Join with a code
                </BackendGatedLink>
              </Magnetic>
            </div>
          </motion.div>
        </div>

        <motion.div
          {...enter(0.6)}
          className="flex items-center justify-between pb-6 text-xs text-[#e9e7e0]/35"
        >
          <span>p2p mesh · up to 4 people · webrtc</span>
          <span className="flex items-center gap-2">
            scroll
            <span className="relative block h-8 w-px overflow-hidden bg-[#e9e7e0]/20">
              {!reduced && (
                <motion.span
                  className="absolute left-0 top-0 block h-3 w-px bg-blue-500"
                  animate={{ y: [-12, 32] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
            </span>
          </span>
        </motion.div>
      </section>

      {/* -------------------------------- manifesto --------------------------------
          Reading order is deliberate: first why this exists (manifesto), then what you get
          (features), then proof you can touch (camera demo), then the ask (outro). */}
      <section data-scene="paper" className="px-5 pb-10 pt-32 sm:px-10 sm:pt-44">
        <Manifesto reduced={reduced} />
      </section>

      {/* --------------------------------- features -------------------------------- */}
      <section data-scene="paper" className="px-5 pb-36 pt-24 sm:px-10">
        <motion.div
          initial={reduced ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6 }}
          className="mb-8 flex items-baseline justify-between"
        >
          <h2 className="font-accent text-2xl italic text-[#16171c]/70">What's in a call</h2>
          <span className="text-sm text-[#16171c]/40">{FEATURES.length} things, all included</span>
        </motion.div>
        <FeaturesIndex reduced={reduced} />
      </section>

      {/* ------------------------------- camera demo ------------------------------- */}
      <section data-scene="deep" className="px-5 py-28 sm:px-10 sm:py-36">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, ease: EASE_SOFT }}
          className="mx-auto mb-10 max-w-3xl"
        >
          <p className="font-accent text-xl italic text-blue-400/90">
            Don't take our word for any of that.
          </p>
          <h2 className="font-head mt-2 text-[clamp(2rem,5vw,3.8rem)] font-semibold leading-tight tracking-tight text-[#e9e7e0]">
            say hi to yourself.
          </h2>
        </motion.div>
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 26 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.7, delay: 0.1, ease: EASE_SOFT }}
        >
          <CameraDemo reduced={reduced} />
        </motion.div>
      </section>

      {/* ---------------------------------- outro ---------------------------------- */}
      <section data-scene="night" className="flex min-h-[90svh] flex-col justify-between pt-24">
        {/* Solid band, not transparent: it enters the viewport while the paper scene is still
            fading out, and carrying its own background makes it the visual hinge between the
            light and dark worlds instead of unreadable in-between text. */}
        <div aria-hidden="true" className="overflow-hidden bg-[#0a0c10] py-4">
          <div className="animate-home-marquee flex w-max whitespace-nowrap">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex">
                {MARQUEE_ITEMS.map((item) => (
                  <span
                    key={`${copy}-${item}`}
                    className="font-accent mx-6 text-lg italic text-[#e9e7e0]/45"
                  >
                    {item} <span className="ml-10 not-italic text-blue-500">✳</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-center gap-8 px-5 py-20 text-center sm:px-10">
          <p className="font-accent max-w-xl text-xl italic leading-relaxed text-[#e9e7e0]/55 sm:text-2xl">
            Two clicks from here, your camera is talking to their screen, and nothing else.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Magnetic strength={0.25}>
              <BackendGatedLink
                to="/start"
                data-cursor
                className="inline-block rounded-full bg-blue-500 px-10 py-5 font-head text-base font-semibold text-white transition-colors duration-300 hover:bg-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                Start a call
              </BackendGatedLink>
            </Magnetic>
            <Magnetic strength={0.25}>
              <BackendGatedLink
                to="/join"
                data-cursor
                className="inline-block rounded-full border border-[#e9e7e0]/30 px-10 py-5 font-head text-base font-semibold text-[#e9e7e0] transition-colors duration-300 hover:border-blue-500 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                Join with a code
              </BackendGatedLink>
            </Magnetic>
          </div>
        </div>

        <footer className="px-3 pb-4 sm:px-6">
          <div className="flex items-end justify-between pb-2 text-xs text-[#e9e7e0]/40">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              data-cursor
              className="flex items-center gap-1.5 hover:text-[#e9e7e0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              <GitHubIcon size={14} />
              <RollText>github ↗</RollText>
            </a>
            <span>free & open source · MIT license</span>
          </div>
          <div
            aria-hidden="true"
            className="font-head select-none pb-3 text-center text-[clamp(4rem,17.5vw,17rem)] font-bold leading-[0.82] tracking-[-0.04em] text-[#e9e7e0]"
          >
            {'patchbay'.split('').map((letter, i) => (
              <span
                key={i}
                className="inline-block transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-4 hover:text-blue-500"
              >
                {letter}
              </span>
            ))}
          </div>
        </footer>
      </section>
    </div>
  );
}
