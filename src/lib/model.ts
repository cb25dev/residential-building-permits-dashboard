import { fmtInt } from './format';
import { CLASS_LABEL } from './labels';
import { PALETTES, SPECIAL, divergingScale, sequentialScale, type Scale } from './scales';
import type { AbsScale, County, Metric, Units, View, ViewRow } from './types';

export interface Filters {
  state: string | null; // state FIPS
  minPop: number;
  minPrior: number; // minimum prior-period units for YoY
  text: string;
}

export interface Settings {
  view: View;
  metric: Metric;
  units: Units;
  absScale: AbsScale;
  cvd: boolean;
}

export type Status = 'value' | 'nodata' | 'na' | 'low';

export const row = (c: County, view: View): ViewRow => (view === 'ttm' ? c.ttm : c.annual);

export function metricValue(c: County, s: Pick<Settings, 'view' | 'metric' | 'units'>): number | null {
  const r = row(c, s.view);
  if (s.metric === 'abs') return s.units === 'sf' ? r.cur.u1 : r.cur.total;
  if (s.metric === 'yoy') return s.units === 'sf' ? r.yoy.sf : r.yoy.all;
  return s.units === 'sf' ? r.per.sf : r.per.all;
}

export const priorValue = (c: County, view: View, units: Units) =>
  units === 'sf' ? row(c, view).pri.u1 : row(c, view).pri.total;

export function status(c: County, s: Settings, f: Filters): Status {
  const r = row(c, s.view);
  if (r.cls === 'not_in_bps') return 'nodata';
  const v = metricValue(c, s);
  if (v == null) return 'na';
  if (s.metric === 'yoy') {
    const p = priorValue(c, s.view, s.units);
    if (p == null || p < f.minPrior) return 'low';
  }
  return 'value';
}

/** Whether a county passes the map/table filters (independent of data status). */
export function passes(c: County, f: Filters, view: View): boolean {
  if (f.state && c.statefp !== f.state) return false;
  const pop = row(c, view).pop;
  if (f.minPop > 0 && (pop == null || pop < f.minPop)) return false;
  return true;
}

export function textMatch(c: County, text: string): boolean {
  if (!text.trim()) return true;
  const q = text.trim().toLowerCase();
  return c.name.toLowerCase().includes(q) || c.state.toLowerCase().includes(q) || c.st.toLowerCase() === q || c.geoid.startsWith(q);
}

export function makeScale(counties: County[], s: Settings, f: Filters): Scale {
  const vals: number[] = [];
  for (const c of counties) {
    if (!passes(c, f, s.view) || status(c, s, f) !== 'value') continue;
    vals.push(metricValue(c, s)!);
  }
  if (s.metric === 'abs') return sequentialScale(vals, s.absScale, PALETTES.blue, PALETTES.zeroBlue);
  if (s.metric === 'per') return sequentialScale(vals, 'quantile', PALETTES.violet, PALETTES.zeroViolet, 7);
  return divergingScale(vals, PALETTES.red, s.cvd ? PALETTES.blueArm : PALETTES.green, PALETTES.neutral);
}

export interface Paint {
  color: string;
  pattern: 'nodata' | 'na' | 'low' | null;
  dim: boolean;
}

export function paintFor(c: County, s: Settings, f: Filters, scale: Scale): Paint {
  const st = status(c, s, f);
  const dim = !passes(c, f, s.view);
  if (st === 'value') return { color: scale.classes[scale.classify(metricValue(c, s)!)].color, pattern: null, dim };
  return { color: SPECIAL[st].fill, pattern: st, dim };
}

export function specialCounts(counties: County[], s: Settings, f: Filters) {
  const n = { nodata: 0, na: 0, low: 0 };
  for (const c of counties) {
    if (!passes(c, f, s.view)) continue;
    const st = status(c, s, f);
    if (st !== 'value') n[st]++;
  }
  return n;
}

export type SortKey = 'name' | 'st' | 'cur' | 'pri' | 'yoy' | 'pop' | 'per' | 'sf' | 'mf' | 'cls';

export function sortValue(c: County, key: SortKey, s: Settings): number | string | null {
  const r = row(c, s.view);
  switch (key) {
    case 'name': return c.name;
    case 'st': return c.st;
    case 'cur': return s.units === 'sf' ? r.cur.u1 : r.cur.total;
    case 'pri': return priorValue(c, s.view, s.units);
    case 'yoy': return s.units === 'sf' ? r.yoy.sf : r.yoy.all;
    case 'pop': return r.pop;
    case 'per': return s.units === 'sf' ? r.per.sf : r.per.all;
    case 'sf': return r.cur.u1;
    case 'mf': return r.cur.mf;
    case 'cls': return r.cls;
  }
}

/** Sort with N/A always last regardless of direction. */
export function sortCounties(list: County[], key: SortKey, dir: 'asc' | 'desc', s: Settings): County[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, key, s);
    const vb = sortValue(b, key, s);
    if (va == null && vb == null) return a.geoid.localeCompare(b.geoid);
    if (va == null) return 1;
    if (vb == null) return -1;
    const d = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return d !== 0 ? sign * d : a.geoid.localeCompare(b.geoid);
  });
}

export function tableRows(counties: County[], s: Settings, f: Filters): County[] {
  return counties.filter((c) => {
    if (!passes(c, f, s.view) || !textMatch(c, f.text)) return false;
    // When ranking by growth, apply the minimum prior-volume rule to the table too.
    if (s.metric === 'yoy') {
      const p = priorValue(c, s.view, s.units);
      if (p != null && p < f.minPrior) return false;
    }
    return true;
  });
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows: County[], s: Settings, periodLabel: string, priorLabel: string, dataThrough: string): string {
  const head = [
    'rank', 'fips', 'county', 'state', 'period', 'prior_period', 'units_measure',
    'current_units', 'prior_units', 'yoy_growth_pct', 'population', 'permits_per_1000',
    'single_family_units', 'multifamily_units', 'units_2', 'units_3_4', 'units_5plus',
    'coverage_status', 'flags', 'data_through', 'source',
  ];
  const lines = [head.join(',')];
  rows.forEach((c, i) => {
    const r = row(c, s.view);
    const sf = s.units === 'sf';
    lines.push([
      i + 1, c.geoid, c.name, c.st, periodLabel, priorLabel, sf ? 'single-family units' : 'all residential units',
      sf ? r.cur.u1 : r.cur.total, sf ? r.pri.u1 : r.pri.total, sf ? r.yoy.sf : r.yoy.all, r.pop,
      sf ? r.per.sf : r.per.all, r.cur.u1, r.cur.mf, r.cur.u2, r.cur.u34, r.cur.u5,
      CLASS_LABEL[r.cls].short, r.flags.join(';'), dataThrough, 'U.S. Census Bureau, Building Permits Survey; PEP',
    ].map(csvCell).join(','));
  });
  return lines.join('\n') + '\n';
}

export const describeCount = (n: number, word: string) => `${fmtInt(n)} ${word}${n === 1 ? '' : 's'}`;
