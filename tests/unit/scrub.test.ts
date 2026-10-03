import { describe, expect, it } from 'vitest';
import {
  FAST,
  inNotch,
  NOTCH,
  NOTCH_W,
  notched,
  Scrub,
  scrubGain,
  SLOW,
  unnotched,
} from '../../src/ui/widgets/scrub';

describe('scrub gain', () => {
  it('is fine for slow drags, coarse for flicks, and rises smoothly in between', () => {
    expect(scrubGain(0, 1, 10)).toBe(1);
    expect(scrubGain(SLOW, 1, 10)).toBe(1);
    expect(scrubGain(FAST, 1, 10)).toBe(10);
    expect(scrubGain(50, 1, 10)).toBe(10);
    let last = 0;
    for (let v = 0; v <= FAST * 1.2; v += 0.01) {
      const g = scrubGain(v, 1, 10);
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
  });

  it('measures speed from the travel between moves, smoothed, even when moves arrive bunched up', () => {
    const s = new Scrub(0, 0, 0);
    const a = s.move(3, 4, 10); // 5 px in 10 ms: the first move counts in full
    expect([a.dx, a.dy]).toEqual([3, 4]);
    expect(a.speed).toBeCloseTo(0.5, 9);
    const b = s.move(3, 4, 20); // still
    expect(b.speed).toBeCloseTo(0.25, 9);
    const c = s.move(13, 4, 20); // same timestamp: counted over 4 ms, not zero
    expect(Number.isFinite(c.speed)).toBe(true);
    expect(c.speed).toBeCloseTo(0.25 / 2 + 10 / 4 / 2, 9);
  });
});

describe('power notches', () => {
  it('stick on every 5% for a little travel, and spread the rest so every value stays reachable', () => {
    expect(notched(0)).toBe(0);
    expect(notched(1)).toBe(1);
    for (let k = 0; k <= 20; k++) {
      const c = k * NOTCH;
      expect(notched(c)).toBeCloseTo(c, 12);
      expect(notched(Math.min(1, c + NOTCH_W / 2 - 1e-9))).toBeCloseTo(c, 9);
      expect(inNotch(c)).toBe(true);
    }
    // Monotonic and continuous.
    let last = -1;
    for (let r = 0; r <= 1; r += 0.0001) {
      const v = notched(r);
      expect(v).toBeGreaterThanOrEqual(last - 1e-12);
      if (last >= 0) expect(v - last).toBeLessThan(0.002);
      last = v;
    }
    // Every dial setting (thousandths) can be reached, and comes back from its raw position.
    for (let q = 0; q <= 1000; q++) {
      const v = q / 1000;
      expect(Math.round(notched(unnotched(v)) * 1000)).toBe(q);
    }
    expect(inNotch(unnotched(0.513))).toBe(false);
  });
});
