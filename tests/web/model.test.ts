// Synthetic county rows (test fixtures only).
import { describe, expect, it } from 'vitest';
import { fmtInt, fmtPct, periodRange } from '../../src/lib/format';
import { metricValue, paintFor, makeScale, sortCounties, status, tableRows, toCSV, type Filters, type Settings } from '../../src/lib/model';
import { searchIndex } from '../../src/lib/search';
import type { County, GeoIndex, ViewRow } from '../../src/lib/types';

const rank = [0, 0, 0, 0] as [number, number, number, number];
function vr(p: Partial<ViewRow> & { total: number | null; prior: number | null; sf?: number | null }): ViewRow {
  const yoy = p.prior && p.total != null ? (p.total / p.prior - 1) * 100 : null;
  return {
    cls: p.cls ?? 'complete',
    cur: { total: p.total, u1: p.sf ?? p.total, u2: 0, u34: 0, u5: 0, mf: p.total != null ? p.total - (p.sf ?? p.total) : null },
    pri: { total: p.prior, u1: p.prior, mf: 0 },
    yoy: { all: yoy, sf: yoy },
    per: { all: p.total != null ? p.total / 10 : null, sf: null },
    imputed: null, flags: [], pop: p.pop ?? 10_000,
    rank: { abs_all: rank, abs_sf: rank, per_all: rank, per_sf: rank, yoy_all: rank, yoy_sf: rank },
  };
}
function county(geoid: string, name: string, v: ViewRow): County {
  return { idx: 0, geoid, name, short: name, st: 'TX', state: 'Texas', statefp: geoid.slice(0, 2), bbox: [0, 0, 1, 1], ttm: v, annual: v, recon: { decYtd: null, annual: null }, growth: { pop3: null, p3All: null, p3Sf: null, p3BaseAll: null, p3BaseSf: null } };
}

const A = county('48001', 'Alpha County', vr({ total: 1000, prior: 800, sf: 600 }));
const B = county('48003', 'Beta County', vr({ total: 30, prior: 10 }));                       // low baseline
const C = county('48005', 'Gamma County', vr({ total: null, prior: null, cls: 'not_in_bps' })); // no data
const D = county('06001', 'Delta County', vr({ total: 5, prior: 0, pop: 900 }));               // zero prior
const E = county('48007', 'Epsilon County', vr({ total: null, prior: null, cls: 'incomplete' }));
const all = [A, B, C, D, E];
const S: Settings = { view: 'ttm', metric: 'yoy', units: 'all', absScale: 'log', cvd: false };
const F: Filters = { state: null, minPop: 0, minPrior: 50, text: '' };

describe('status and painting', () => {
  it('distinguishes no data, N/A, low baseline and values', () => {
    expect(status(A, S, F)).toBe('value');
    expect(status(B, S, F)).toBe('low');
    expect(status(C, S, F)).toBe('nodata');
    expect(status(D, S, F)).toBe('na'); // undefined growth from a zero prior
    expect(status(E, S, F)).toBe('na');
  });
  it('missing data is never painted as a value class', () => {
    const scale = makeScale(all, { ...S, metric: 'abs' }, F);
    expect(paintFor(C, { ...S, metric: 'abs' }, F, scale).pattern).toBe('nodata');
    expect(paintFor(E, { ...S, metric: 'abs' }, F, scale).pattern).toBe('na');
  });
  it('filters dim counties without changing their data status', () => {
    const f = { ...F, state: '48' };
    const scale = makeScale(all, S, f);
    expect(paintFor(D, S, f, scale).dim).toBe(true);
    expect(paintFor(A, S, f, scale).dim).toBe(false);
  });
  it('single-family toggle switches the measured series', () => {
    expect(metricValue(A, { ...S, metric: 'abs', units: 'sf' })).toBe(600);
    expect(metricValue(A, { ...S, metric: 'abs', units: 'all' })).toBe(1000);
  });
});

describe('table rows, sorting and CSV', () => {
  it('YoY table applies the minimum prior volume; N/A sorts last', () => {
    const rows = sortCounties(tableRows(all, S, F), 'yoy', 'desc', S);
    expect(rows.map((r) => r.geoid)).toEqual(['48001', '48005', '48007']); // Delta (prior 0) is below the minimum
  });
  it('minimum population and state filters', () => {
    expect(tableRows(all, { ...S, metric: 'abs' }, { ...F, minPop: 1000 }).map((c) => c.geoid)).not.toContain('06001');
    expect(tableRows(all, { ...S, metric: 'abs' }, { ...F, state: '06' }).map((c) => c.geoid)).toEqual(['06001']);
  });
  it('CSV leaves N/A cells empty rather than writing zero', () => {
    const csv = toCSV([A, C], { ...S, metric: 'abs' }, 'Sep 2025 – Aug 2026', 'Sep 2024 – Aug 2025', '2026-08');
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('48001,Alpha County,TX');
    const gamma = lines[2].split(',');
    expect(gamma[7]).toBe(''); // current units N/A
  });
});

describe('formatting and search', () => {
  it('formats N/A, signs and periods', () => {
    expect(fmtInt(null)).toBe('N/A');
    expect(fmtPct(12.345)).toBe('+12.3%');
    expect(fmtPct(-4)).toBe('−4.0%');
    expect(periodRange(['2025-09', '2026-08'])).toBe('Sep 2025 – Aug 2026');
  });
  it('search finds states first and counties by name or FIPS', () => {
    const geo = { states: { '48': { name: 'Texas', st: 'TX', bbox: [0, 0, 1, 1] } } } as unknown as GeoIndex;
    const idx = searchIndex(all, geo);
    expect(idx.search('tex')[0]).toMatchObject({ kind: 'state', id: '48' });
    expect(idx.search('beta')[0]).toMatchObject({ kind: 'county', id: '48003' });
    expect(idx.search('48005')[0]).toMatchObject({ id: '48005' });
  });
});
