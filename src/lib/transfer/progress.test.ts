import { describe, expect, it } from 'vitest';
import { ProgressTracker } from './progress';

describe('ProgressTracker', () => {
  it('reports fraction and a steady rate with ETA', () => {
    const p = new ProgressTracker(10_000_000);
    p.update(0, 0);
    p.update(1_000_000, 1000);
    const s = p.update(2_000_000, 2000);
    expect(s.fraction).toBeCloseTo(0.2);
    expect(s.bytesPerSecond).toBeCloseTo(1_000_000);
    expect(s.etaSeconds).toBeCloseTo(8);
  });

  it('never goes backwards or past the total', () => {
    const p = new ProgressTracker(100);
    p.update(60, 0);
    expect(p.update(40, 100).bytes).toBe(60);
    expect(p.update(500, 200).bytes).toBe(100);
    expect(p.snapshot(200).etaSeconds).toBe(0);
  });

  it('has no ETA until the rate is known', () => {
    const p = new ProgressTracker(100);
    expect(p.update(0, 0).etaSeconds).toBeNull();
  });

  it('uses only the recent window for speed', () => {
    const p = new ProgressTracker(100_000_000, 3000);
    p.update(0, 0);
    p.update(50_000_000, 1000); // fast burst
    for (let t = 2000; t <= 10_000; t += 1000) p.update(50_000_000 + (t - 1000) * 100, t); // then 100 KB/s
    expect(p.snapshot(10_000).bytesPerSecond).toBeCloseTo(100_000, -3);
  });

  it('treats an empty transfer as complete', () => {
    expect(new ProgressTracker(0).snapshot().fraction).toBe(1);
  });
});
