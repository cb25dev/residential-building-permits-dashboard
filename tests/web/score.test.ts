// Synthetic county rows (test fixtures only).
import { describe, expect, it } from 'vitest';
import { computeScores, DEFAULT_WEIGHTS, parseWeights, percentiles, weightsString } from '../../src/lib/score';
import type { County, ViewRow } from '../../src/lib/types';

const rk = [0, 0, 0, 0] as [number, number, number, number];
function county(geoid: string, o: { cur: number | null; pri: number | null; pop?: number; pop3?: number | null; g3?: number | null; base?: number | null; cls?: ViewRow['cls'] }): County {
  const yoy = o.cur != null && o.pri ? (o.cur / o.pri - 1) * 100 : null;
  const per = o.cur != null ? (o.cur / (o.pop ?? 10_000)) * 1000 : null;
  const v: ViewRow = {
    cls: o.cls ?? 'complete',
    cur: { total: o.cur, u1: o.cur, u2: 0, u34: 0, u5: 0, mf: 0 },
    pri: { total: o.pri, u1: o.pri, mf: 0 },
    yoy: { all: yoy, sf: yoy }, per: { all: per, sf: per }, imputed: null, flags: [], pop: o.pop ?? 10_000,
    rank: { abs_all: rk, abs_sf: rk, per_all: rk, per_sf: rk, yoy_all: rk, yoy_sf: rk },
  };
  return {
    idx: 0, geoid, name: geoid, short: geoid, st: 'XX', state: 'X', statefp: geoid.slice(0, 2), bbox: [0, 0, 1, 1],
    ttm: v, annual: v, recon: { decYtd: null, annual: null },
    growth: { pop3: o.pop3 === undefined ? 1 : o.pop3, p3All: o.g3 === undefined ? 0 : o.g3, p3Sf: o.g3 === undefined ? 0 : o.g3, p3BaseAll: o.base ?? 500, p3BaseSf: o.base ?? 500 },
  };
}

describe('percentiles', () => {
  it('maps min to 0, max to 100 and averages ties', () => {
    expect(percentiles([10, 20, 30])).toEqual([0, 50, 100]);
    expect(percentiles([5, 5, 9])).toEqual([25, 25, 100]);
  });
});

describe('computeScores', () => {
  const big = county('01001', { cur: 3000, pri: 2000, pop3: 9, g3: 40 });   // high volume, high growth
  const mid = county('01003', { cur: 800, pri: 800, pop3: 3, g3: 5 });
  const small = county('02001', { cur: 200, pri: 300, pop3: -1, g3: -20 });
  const tiny = county('02003', { cur: 400, pri: 20 });                       // below minimum prior volume
  const none = county('02005', { cur: null, pri: null, cls: 'not_in_bps' });
  const ct = county('09110', { cur: 600, pri: 500, pop3: 2, g3: null });       // missing 3-year growth
  const all = [big, mid, small, tiny, none, ct];
  const s = computeScores(all, 'ttm', 'sf', 50, DEFAULT_WEIGHTS);

  it('scores eligible counties 0-100 and ranks the strongest first', () => {
    expect(s.get('01001')!.score).toBeGreaterThan(s.get('01003')!.score!);
    expect(s.get('01003')!.score).toBeGreaterThan(s.get('02001')!.score!);
    expect(s.get('01001')!.rank.slice(0, 2)).toEqual([1, 4]);
    for (const r of s.values()) if (r.score != null) { expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100); }
  });
  it('excludes low-baseline and no-data counties instead of scoring them', () => {
    expect(s.get('02003')).toMatchObject({ score: null, status: 'low' });
    expect(s.get('02005')).toMatchObject({ score: null, status: 'nodata' });
  });
  it('redistributes the weight of a missing optional input and flags it', () => {
    const r = s.get('09110')!;
    expect(r.partial).toBe(true);
    expect(r.parts.find((p) => p.key === 'sustained')!.pct).toBeNull();
    expect(r.score).not.toBeNull();
  });
  it('a single input at 100% weight reproduces that input percentile', () => {
    const vol = computeScores(all, 'ttm', 'sf', 50, { volume: 100, momentum: 0, sustained: 0, popgrowth: 0, intensity: 0 });
    expect(vol.get('01001')!.score).toBe(100);
    expect(vol.get('02001')!.score).toBe(0);
  });
  it('within-state ranks', () => {
    expect(s.get('01001')!.rank.slice(2)).toEqual([1, 2]);
    expect(s.get('01003')!.rank.slice(2)).toEqual([2, 2]);
  });
});

describe('weights in the URL', () => {
  it('round-trips and rejects malformed input', () => {
    expect(parseWeights(weightsString(DEFAULT_WEIGHTS))).toEqual(DEFAULT_WEIGHTS);
    expect(parseWeights('1,2,3')).toBeNull();
    expect(parseWeights('10,20,30,40,500')).toBeNull();
  });
});
