/**
 * A minimal per-key sliding-window rate limiter for use outside Express (where
 * `express-rate-limit` doesn't apply): specifically Socket.IO events. Not distributed: fine
 * for a single-instance deployment (see the RoomStore doc comment on the same scaling seam).
 */
export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  /** Records one attempt for `key` and returns whether it's within the limit. */
  isAllowed(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const existing = this.hits.get(key) ?? [];
    const recent = existing.filter((ts) => ts > cutoff);
    recent.push(now);
    this.hits.set(key, recent);
    return recent.length <= this.max;
  }

  /** Drops keys with no hits left inside the current window; call periodically so a
   * long-running process doesn't accumulate one entry per distinct IP forever. */
  sweep(now = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.hits) {
      const recent = timestamps.filter((ts) => ts > cutoff);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}
