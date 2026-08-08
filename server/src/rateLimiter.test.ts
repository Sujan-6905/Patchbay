import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from './rateLimiter.js';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to max attempts within the window', () => {
    const limiter = new SlidingWindowRateLimiter(1000, 3);
    expect(limiter.isAllowed('a', 0)).toBe(true);
    expect(limiter.isAllowed('a', 10)).toBe(true);
    expect(limiter.isAllowed('a', 20)).toBe(true);
    expect(limiter.isAllowed('a', 30)).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = new SlidingWindowRateLimiter(1000, 1);
    expect(limiter.isAllowed('a', 0)).toBe(true);
    expect(limiter.isAllowed('b', 0)).toBe(true);
    expect(limiter.isAllowed('a', 10)).toBe(false);
    expect(limiter.isAllowed('b', 10)).toBe(false);
  });

  it('allows attempts again once the earlier hit falls outside the window', () => {
    const limiter = new SlidingWindowRateLimiter(1000, 1);
    expect(limiter.isAllowed('a', 0)).toBe(true);
    expect(limiter.isAllowed('a', 1_001)).toBe(true);
  });

  it('denied attempts still count as hits, so hammering past the limit keeps it denied', () => {
    const limiter = new SlidingWindowRateLimiter(1000, 1);
    expect(limiter.isAllowed('a', 0)).toBe(true);
    expect(limiter.isAllowed('a', 500)).toBe(false);
    // The t=0 hit has expired by t=1001, but the denied t=500 attempt was itself recorded
    // and is still within the window, so this stays denied rather than resetting early.
    expect(limiter.isAllowed('a', 1_001)).toBe(false);
  });

  it('sweep frees stale keys without affecting rate-limit correctness', () => {
    const limiter = new SlidingWindowRateLimiter(1000, 1);
    expect(limiter.isAllowed('a', 0)).toBe(true);
    limiter.sweep(500);
    // Still inside the 1s window from t=0, sweep at t=500 must not have dropped it early.
    expect(limiter.isAllowed('a', 500)).toBe(false);
    limiter.sweep(2000);
    // The t=0 hit is outside the window by t=2000 regardless of sweeping; a fresh attempt
    // is allowed either way; sweep only affects memory usage, never this outcome.
    expect(limiter.isAllowed('a', 2000)).toBe(true);
  });
});
