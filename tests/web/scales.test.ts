// Synthetic values only (test fixtures); production data never comes from these files.
import { describe, expect, it } from 'vitest';
import { divergingScale, niceLog, niceRound, PALETTES, quantile, sequentialScale } from '../../src/lib/scales';

describe('rounding helpers', () => {
  it('niceRound keeps two significant figures', () => {
    expect(niceRound(1234)).toBe(1200);
    expect(niceRound(87.6)).toBe(88);
    expect(niceRound(3.14159)).toBe(3.1);
    expect(niceRound(-47.2)).toBe(-47);
  });
  it('niceLog snaps to 1-2-2.5-5 steps', () => {
    expect(niceLog(23)).toBe(25);
    expect(niceLog(140)).toBe(100);
    expect(niceLog(4300)).toBe(5000);
  });
  it('quantile interpolates', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});

describe('sequentialScale', () => {
  const values = [0, 0, 0, ...Array.from({ length: 200 }, (_, i) => Math.round(Math.pow(1.05, i)))];
  for (const mode of ['log', 'quantile'] as const) {
    it(`${mode}: zero gets its own class and every value is classified`, () => {
      const s = sequentialScale(values, mode, PALETTES.blue, PALETTES.zeroBlue);
      expect(s.classes[0].label).toBe('0');
      expect(s.classes[0].count).toBe(3);
      expect(s.classes.reduce((a, c) => a + c.count, 0)).toBe(values.length);
      expect(s.classify(0)).toBe(0);
      expect(s.classify(1)).toBe(1);
      // breaks strictly increase
      const bounds = s.classes.slice(1).map((c) => c.hi).filter((x): x is number => x != null);
      bounds.forEach((b, i) => i && expect(b).toBeGreaterThan(bounds[i - 1]));
    });
  }
  it('quantile classes are roughly equal-count', () => {
    const v = Array.from({ length: 700 }, (_, i) => i + 1);
    const s = sequentialScale(v, 'quantile', PALETTES.blue, PALETTES.zeroBlue);
    for (const c of s.classes.slice(1)) expect(Math.abs(c.count - 100)).toBeLessThan(15);
  });
  it('uses the darkest color for the top class', () => {
    const s = sequentialScale([1, 5, 10, 50, 100, 500, 1000, 5000], 'log', PALETTES.blue, PALETTES.zeroBlue);
    expect(s.classes[s.classes.length - 1].color).toBe(PALETTES.blue[PALETTES.blue.length - 1]);
  });
});

describe('divergingScale', () => {
  const v = [-90, -60, -40, -30, -20, -12, -8, -4, -2, -1, 0, 0.5, 1, 2, 3, 5, 9, 15, 25, 40, 80, 300, 1200];
  const s = divergingScale(v, PALETTES.red, PALETTES.green, PALETTES.neutral);
  it('has a neutral class straddling zero', () => {
    const neutral = s.classes.find((c) => c.color === PALETTES.neutral)!;
    expect(neutral.lo!).toBeLessThan(0);
    expect(neutral.hi!).toBeGreaterThan(0);
    expect(s.classes[s.classify(0)].color).toBe(PALETTES.neutral);
  });
  it('declines are red and increases green, with open-ended outer classes for outliers', () => {
    expect(PALETTES.red as readonly string[]).toContain(s.classes[s.classify(-90)].color);
    expect(PALETTES.green as readonly string[]).toContain(s.classes[s.classify(1200)].color);
    expect(s.classes[0].lo).toBeNull();
    expect(s.classes[s.classes.length - 1].hi).toBeNull();
    expect(s.classify(1200)).toBe(s.classes.length - 1);
  });
  it('counts every value once', () => {
    expect(s.classes.reduce((a, c) => a + c.count, 0)).toBe(v.length);
  });
});
