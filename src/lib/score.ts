// Land Opportunity Score: a weighted average of national percentile ranks.
//
// Each component is converted to a percentile (0-100) among eligible counties, so
// heavy-tailed inputs (a +478% YoY, Maricopa-sized volumes) cannot dominate, and
// components measured in different units become comparable. The score is
// sum(weight_i * percentile_i) / sum(weight_i) over the components available for a
// county. Volume and momentum are required; the others are optional and, when
// missing, their weight is redistributed (the county is flagged "partial").

import type { County, Units, View } from './types';

export type ComponentKey = 'volume' | 'momentum' | 'sustained' | 'popgrowth' | 'intensity';
export type Weights = Record<ComponentKey, number>;

export const DEFAULT_WEIGHTS: Weights = { volume: 35, momentum: 30, sustained: 15, popgrowth: 10, intensity: 10 };
export const COMPONENT_KEYS: ComponentKey[] = ['volume', 'momentum', 'sustained', 'popgrowth', 'intensity'];
const REQUIRED: ComponentKey[] = ['volume', 'momentum'];

export interface ComponentDef {
  key: ComponentKey;
  label: string;
  short: string;
  describe: (units: Units, view: View, years: GrowthYears) => string;
}

export interface GrowthYears { pop_from: number; pop_to: number; permits_from: number; permits_to: number }

export const COMPONENTS: ComponentDef[] = [
  {
    key: 'volume', label: 'Permit volume', short: 'Volume',
    describe: (u, v) => `${u === 'sf' ? 'Single-family' : 'All residential'} units authorized, ${v === 'ttm' ? 'trailing 12 months' : 'calendar year'}`,
  },
  {
    key: 'momentum', label: 'Momentum (YoY)', short: 'Momentum',
    describe: (_u, v) => `Growth vs the prior ${v === 'ttm' ? '12 months' : 'year'}`,
  },
  {
    key: 'sustained', label: '3-year permit growth', short: '3-yr growth',
    describe: (_u, _v, y) => `Change in final annual permits, ${y.permits_from} → ${y.permits_to}`,
  },
  {
    key: 'popgrowth', label: 'Population growth', short: 'Pop. growth',
    describe: (_u, _v, y) => `Change in population estimate, ${y.pop_from} → ${y.pop_to}`,
  },
  {
    key: 'intensity', label: 'Permits per 1,000 residents', short: 'Intensity',
    describe: () => 'Development pressure relative to population',
  },
];

export interface ScorePart { key: ComponentKey; value: number | null; pct: number | null; weight: number }
export interface ScoreResult {
  score: number | null;
  parts: ScorePart[];
  partial: boolean;
  status: 'value' | 'low' | 'na' | 'nodata';
  rank: [number, number, number, number]; // national rank, n, state rank, n
}
export type ScoreMap = Map<string, ScoreResult>;

export function componentValue(c: County, key: ComponentKey, view: View, units: Units, minPrior: number): number | null {
  const r = view === 'ttm' ? c.ttm : c.annual;
  const sf = units === 'sf';
  switch (key) {
    case 'volume': return sf ? r.cur.u1 : r.cur.total;
    case 'momentum': return sf ? r.yoy.sf : r.yoy.all;
    case 'sustained': {
      const base = sf ? c.growth.p3BaseSf : c.growth.p3BaseAll;
      if (base == null || base < minPrior) return null; // low 3-year baseline: not meaningful
      return sf ? c.growth.p3Sf : c.growth.p3All;
    }
    case 'popgrowth': return c.growth.pop3;
    case 'intensity': return sf ? r.per.sf : r.per.all;
  }
}

/** Percentile rank (0-100) of each value among the values given; ties share their average rank. */
export function percentiles(values: number[]): number[] {
  const n = values.length;
  if (n === 1) return [50];
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1][0] === order[i][0]) j++;
    const pct = (((i + j) / 2) / (n - 1)) * 100;
    for (let k = i; k <= j; k++) out[order[k][1]] = pct;
    i = j + 1;
  }
  return out;
}

export function computeScores(counties: County[], view: View, units: Units, minPrior: number, weights: Weights): ScoreMap {
  const out: ScoreMap = new Map();
  const eligible: County[] = [];
  for (const c of counties) {
    const r = view === 'ttm' ? c.ttm : c.annual;
    const prior = units === 'sf' ? r.pri.u1 : r.pri.total;
    let status: ScoreResult['status'] = 'value';
    if (r.cls === 'not_in_bps') status = 'nodata';
    else if (r.cls !== 'complete') status = 'na';
    else if (prior == null || prior < minPrior) status = 'low';
    else if (REQUIRED.some((k) => componentValue(c, k, view, units, minPrior) == null)) status = 'na';
    if (status === 'value') eligible.push(c);
    out.set(c.geoid, { score: null, parts: [], partial: false, status, rank: [0, 0, 0, 0] });
  }

  // National percentiles per component, among eligible counties that have the component.
  const pct = new Map<string, Partial<Record<ComponentKey, number>>>();
  for (const key of COMPONENT_KEYS) {
    const have = eligible.filter((c) => componentValue(c, key, view, units, minPrior) != null);
    const ps = percentiles(have.map((c) => componentValue(c, key, view, units, minPrior)!));
    have.forEach((c, i) => { pct.set(c.geoid, { ...pct.get(c.geoid), [key]: ps[i] }); });
  }

  const totalW = COMPONENT_KEYS.reduce((a, k) => a + Math.max(0, weights[k]), 0);
  for (const c of eligible) {
    const p = pct.get(c.geoid) ?? {};
    let num = 0;
    let den = 0;
    let partial = false;
    const parts: ScorePart[] = COMPONENT_KEYS.map((key) => {
      const w = Math.max(0, weights[key]);
      const value = componentValue(c, key, view, units, minPrior);
      const pk = p[key] ?? null;
      if (pk != null && w > 0) { num += w * pk; den += w; }
      else if (pk == null && w > 0) partial = true;
      return { key, value, pct: pk, weight: totalW ? w / totalW : 0 };
    });
    const res = out.get(c.geoid)!;
    res.parts = parts;
    res.partial = partial;
    res.score = den > 0 ? num / den : null;
    if (res.score == null) res.status = 'na';
  }

  // Competition ranks (1 = best), national and within state.
  const scored = eligible.filter((c) => out.get(c.geoid)!.score != null);
  const rankWithin = (list: County[], slot: 0 | 2) => {
    const sorted = [...list].sort((a, b) => out.get(b.geoid)!.score! - out.get(a.geoid)!.score!);
    sorted.forEach((c, i) => {
      const r = out.get(c.geoid)!;
      const prev = i > 0 ? out.get(sorted[i - 1].geoid)! : null;
      r.rank[slot] = prev && prev.score === r.score ? prev.rank[slot] : i + 1;
      r.rank[slot + 1] = list.length;
    });
  };
  rankWithin(scored, 0);
  const byState = new Map<string, County[]>();
  for (const c of scored) byState.set(c.statefp, [...(byState.get(c.statefp) ?? []), c]);
  for (const list of byState.values()) rankWithin(list, 2);
  return out;
}

export function parseWeights(s: string | null): Weights | null {
  if (!s) return null;
  const xs = s.split(',').map(Number);
  if (xs.length !== COMPONENT_KEYS.length || xs.some((x) => !Number.isFinite(x) || x < 0 || x > 100)) return null;
  return Object.fromEntries(COMPONENT_KEYS.map((k, i) => [k, xs[i]])) as Weights;
}

export const weightsString = (w: Weights) => COMPONENT_KEYS.map((k) => w[k]).join(',');
export const isDefaultWeights = (w: Weights) => COMPONENT_KEYS.every((k) => w[k] === DEFAULT_WEIGHTS[k]);
