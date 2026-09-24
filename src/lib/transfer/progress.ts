export interface ProgressSnapshot {
  bytes: number;
  total: number;
  /** 0..1 */
  fraction: number;
  bytesPerSecond: number;
  /** Seconds remaining, or null while the rate is still unknown. */
  etaSeconds: number | null;
}

/**
 * Tracks confirmed bytes over time and derives speed from a sliding window,
 * so the rate reacts to changes without jumping on every sample.
 */
export class ProgressTracker {
  private samples: Array<{ at: number; bytes: number }> = [];
  private bytes = 0;

  constructor(
    readonly total: number,
    private readonly windowMs = 3000,
  ) {}

  /** Record the new cumulative byte count. Values never go backwards or past the total. */
  update(bytes: number, now = performance.now()): ProgressSnapshot {
    this.bytes = Math.min(this.total, Math.max(this.bytes, bytes));
    this.samples.push({ at: now, bytes: this.bytes });
    while (this.samples.length > 2 && now - this.samples[1].at > this.windowMs) this.samples.shift();
    return this.snapshot(now);
  }

  snapshot(now = performance.now()): ProgressSnapshot {
    const first = this.samples[0];
    const elapsed = first ? (now - first.at) / 1000 : 0;
    const bytesPerSecond = first && elapsed >= 0.25 ? (this.bytes - first.bytes) / elapsed : 0;
    const remaining = this.total - this.bytes;
    return {
      bytes: this.bytes,
      total: this.total,
      fraction: this.total === 0 ? 1 : this.bytes / this.total,
      bytesPerSecond,
      etaSeconds: remaining === 0 ? 0 : bytesPerSecond > 0 ? remaining / bytesPerSecond : null,
    };
  }
}
