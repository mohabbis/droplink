/**
 * Fixed-window counter keyed by an arbitrary string (IP address, connection id).
 * In-memory and per-process, which matches the signaling server's scope.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Record one hit for `key`. Returns false if the key is over its budget. */
  hit(key: string, now = Date.now()): boolean {
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      this.sweep(now);
      return true;
    }
    w.count += 1;
    return w.count <= this.limit;
  }

  /** Drop expired windows so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (this.windows.size < 1024) return;
    for (const [key, w] of this.windows) {
      if (now - w.start >= this.windowMs) this.windows.delete(key);
    }
  }
}
