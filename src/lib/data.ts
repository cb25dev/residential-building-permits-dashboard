import type { County, CountyHistory, GeoIndex, Meta, MetricsFile, ViewColumns, ViewRow } from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Failed to load ${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const loadMeta = () => getJSON<Meta>('meta.json');
export const loadMetrics = () => getJSON<MetricsFile>('metrics.json');
export const loadGeoIndex = () => getJSON<GeoIndex>('geo/index.json');
export const geoUrl = (name: 'counties' | 'states' | 'insets') => new URL(`${BASE}geo/${name}.geojson`, location.href).href;

const historyCache = new Map<string, Promise<Record<string, CountyHistory>>>();
export function loadStateHistory(statefp: string) {
  if (!historyCache.has(statefp)) {
    const p = getJSON<Record<string, CountyHistory>>(`history/${statefp}.json`);
    p.catch(() => historyCache.delete(statefp));
    historyCache.set(statefp, p);
  }
  return historyCache.get(statefp)!;
}

function viewRow(c: ViewColumns, i: number): ViewRow {
  return {
    cls: c.cls[i],
    cur: { total: c.cur_total[i], u1: c.cur_u1[i], u2: c.cur_u2[i], u34: c.cur_u34[i], u5: c.cur_u5[i], mf: c.cur_mf[i] },
    pri: { total: c.pri_total[i], u1: c.pri_u1[i], mf: c.pri_mf[i] },
    yoy: { all: c.yoy_all[i], sf: c.yoy_sf[i] },
    per: { all: c.per_all[i], sf: c.per_sf[i] },
    imputed: c.imputed ? c.imputed[i] : null,
    flags: c.flags[i],
    rank: {
      abs_all: c.rk_abs_all[i], abs_sf: c.rk_abs_sf[i], per_all: c.rk_per_all[i],
      per_sf: c.rk_per_sf[i], yoy_all: c.rk_yoy_all[i], yoy_sf: c.rk_yoy_sf[i],
    },
    pop: c.pop[i],
  };
}

/** Join the columnar metrics file with the boundary index into one row per county. */
export function buildCounties(m: MetricsFile, geo: GeoIndex): County[] {
  return m.geoid.map((geoid, i) => {
    const g = geo.counties[geoid];
    if (!g) throw new Error(`County ${geoid} missing from boundary index`);
    return {
      idx: i, geoid, name: g.name, short: g.short, st: g.st, state: g.state, statefp: g.statefp, bbox: g.bbox,
      ttm: viewRow(m.ttm, i), annual: viewRow(m.annual, i),
      recon: { decYtd: m.recon.dec_ytd[i], annual: m.recon.annual[i] },
      growth: {
        pop3: m.growth.pop_3y[i], p3All: m.growth.permits_3y_all[i], p3Sf: m.growth.permits_3y_sf[i],
        p3BaseAll: m.growth.permits_base_all[i], p3BaseSf: m.growth.permits_base_sf[i],
      },
    };
  });
}
