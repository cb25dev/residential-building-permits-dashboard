import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComparePanel } from './components/ComparePanel';
import { Controls } from './components/Controls';
import { DetailPanel } from './components/DetailPanel';
import { Header } from './components/Header';
import { Legend } from './components/Legend';
import { MapView, type MapHandle } from './components/MapView';
import { Methodology } from './components/Methodology';
import { RankingsTable } from './components/RankingsTable';
import { SearchBox } from './components/SearchBox';
import { Tooltip } from './components/Tooltip';
import { buildCounties, loadGeoIndex, loadMeta, loadMetrics } from './lib/data';
import { fmtInt, fmtPct, monthLabel, periodRange } from './lib/format';
import { metricTitle } from './lib/labels';
import {
  type Filters, makeScale, paintFor, type Paint, type Settings, sortCounties, type SortKey, specialCounts, tableRows, toCSV,
} from './lib/model';
import type { SearchItem } from './lib/search';
import type { County, GeoIndex, Meta } from './lib/types';

interface Data { meta: Meta; counties: County[]; geo: GeoIndex; byId: Map<string, County> }

const DEFAULT_SETTINGS: Settings = { view: 'ttm', metric: 'abs', units: 'all', absScale: 'log', cvd: false };

function readHash(lowBaseline: number) {
  const h = new URLSearchParams(location.hash.slice(1));
  const pick = <T extends string>(k: string, allowed: readonly T[], d: T): T => (allowed.includes(h.get(k) as T) ? (h.get(k) as T) : d);
  const settings: Settings = {
    view: pick('view', ['ttm', 'annual'] as const, DEFAULT_SETTINGS.view),
    metric: pick('metric', ['abs', 'yoy', 'per'] as const, DEFAULT_SETTINGS.metric),
    units: pick('units', ['all', 'sf'] as const, DEFAULT_SETTINGS.units),
    absScale: pick('scale', ['log', 'quantile'] as const, DEFAULT_SETTINGS.absScale),
    cvd: h.get('cvd') === '1',
  };
  const filters: Filters = {
    state: /^\d{2}$/.test(h.get('state') ?? '') ? h.get('state') : null,
    minPop: Math.max(0, Number(h.get('minpop')) || 0),
    minPrior: h.has('minprior') ? Math.max(0, Number(h.get('minprior')) || 0) : lowBaseline,
    text: '',
  };
  const county = /^\d{5}$/.test(h.get('county') ?? '') ? h.get('county') : null;
  const compare = (h.get('cmp') ?? '').split(',').filter((g) => /^\d{5}$/.test(g)).slice(0, 5);
  return { settings, filters, county, compare };
}

export function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [filters, setFiltersState] = useState<Filters>({ state: null, minPop: 0, minPrior: 50, text: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [hover, setHover] = useState<{ geoid: string; point: { x: number; y: number } } | null>(null);
  const [methodology, setMethodology] = useState<{ section?: string } | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'cur', dir: 'desc' });
  const mapRef = useRef<MapHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([loadMeta(), loadMetrics(), loadGeoIndex()])
      .then(([meta, metrics, geo]) => {
        const counties = buildCounties(metrics, geo);
        const st = readHash(meta.thresholds.low_baseline_units);
        setSettings(st.settings);
        setFiltersState(st.filters);
        setSelected(st.county);
        setCompare(st.compare);
        setData({ meta, counties, geo, byId: new Map(counties.map((c) => [c.geoid, c])) });
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Follow links that change only the hash (shared URLs, back/forward). Our own
  // history.replaceState calls below do not fire hashchange.
  useEffect(() => {
    if (!data) return;
    const onHash = () => {
      const st = readHash(data.meta.thresholds.low_baseline_units);
      setSettings(st.settings);
      setFiltersState((f) => ({ ...st.filters, text: f.text }));
      setSelected(st.county);
      setCompare(st.compare);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [data]);

  // Keep the URL shareable: view, metric, filters and selection live in the hash.
  useEffect(() => {
    if (!data) return;
    const h = new URLSearchParams();
    if (settings.view !== 'ttm') h.set('view', settings.view);
    h.set('metric', settings.metric);
    if (settings.units !== 'all') h.set('units', settings.units);
    if (settings.absScale !== 'log') h.set('scale', settings.absScale);
    if (settings.cvd) h.set('cvd', '1');
    if (filters.state) h.set('state', filters.state);
    if (filters.minPop) h.set('minpop', String(filters.minPop));
    if (filters.minPrior !== data.meta.thresholds.low_baseline_units) h.set('minprior', String(filters.minPrior));
    if (selected) h.set('county', selected);
    if (compare.length) h.set('cmp', compare.join(','));
    history.replaceState(null, '', `#${h.toString()}`);
  }, [data, settings, filters, selected, compare]);

  const lastState = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!data || lastState.current === filters.state) return;
    const first = lastState.current === undefined;
    lastState.current = filters.state;
    // Wait a frame on first load so the map has its size.
    const go = () => (filters.state ? mapRef.current?.fitBounds(data.geo.states[filters.state].bbox, 7)
      : !first && mapRef.current?.reset());
    if (first) setTimeout(go, 400); else go();
  }, [data, filters.state]);

  const set = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), []);
  const setFilters = useCallback((p: Partial<Filters>) => setFiltersState((f) => ({ ...f, ...p })), []);

  const scale = useMemo(() => (data ? makeScale(data.counties, settings, filters) : null), [data, settings, filters]);
  const paints = useMemo(() => {
    const m = new Map<string, Paint>();
    if (data && scale) for (const c of data.counties) m.set(c.geoid, paintFor(c, settings, filters, scale));
    return m;
  }, [data, settings, filters, scale]);
  const special = useMemo(() => (data ? specialCounts(data.counties, settings, filters) : { nodata: 0, na: 0, low: 0 }), [data, settings, filters]);
  const rows = useMemo(() => (data ? sortCounties(tableRows(data.counties, settings, filters), sort.key, sort.dir, settings) : []), [data, settings, filters, sort]);

  const selectCounty = useCallback((c: County, zoom = true) => {
    setSelected(c.geoid);
    if (zoom) mapRef.current?.fitBounds(c.bbox, 7);
  }, []);
  const toggleCompare = useCallback((geoid: string) => {
    setCompare((cs) => (cs.includes(geoid) ? cs.filter((g) => g !== geoid) : cs.length >= 5 ? cs : [...cs, geoid]));
  }, []);

  const onPick = useCallback((it: SearchItem) => {
    if (!data) return;
    if (it.kind === 'state') {
      setFilters({ state: it.id });
    } else {
      const c = data.byId.get(it.id);
      if (c) selectCounty(c);
    }
  }, [data, selectCounty, setFilters]);

  const exportCSV = useCallback(() => {
    if (!data) return;
    const m = data.meta;
    const period = settings.view === 'ttm' ? periodRange(m.ttm.current) : `CY${m.annual.year}`;
    const prior = settings.view === 'ttm' ? periodRange(m.ttm.prior) : `CY${m.annual.prior_year}`;
    const blob = new Blob([toCSV(rows, settings, period, prior, m.data_through)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `building-permits-${settings.view}-${settings.units}-${m.data_through}${filters.state ? `-${data.geo.states[filters.state].st}` : ''}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [data, rows, settings, filters.state]);

  if (error) return <div className="fatal">Could not load dashboard data: {error}</div>;
  if (!data || !scale) return <div className="loading">Loading Census building permits data…</div>;

  const { meta, counties, geo, byId } = data;
  const sel = selected ? byId.get(selected) ?? null : null;
  const hov = hover ? byId.get(hover.geoid) ?? null : null;
  const box = wrapRef.current?.getBoundingClientRect();
  const filtered = !!filters.state || filters.minPop > 0;
  const periodLabel = settings.view === 'ttm' ? periodRange(meta.ttm.current) : `calendar ${meta.annual.year}`;
  const cov = meta.coverage;

  return (
    <div className="app">
      <Header meta={meta} onMethodology={(section) => setMethodology({ section })} />
      {settings.view === 'ttm' ? (
        <div className="banner">
          Trailing 12 months from the Census monthly county series: {fmtInt(cov.ttm_classes.complete)} of {fmtInt(meta.geography.universe)} counties
          have comparable current and prior periods. {fmtInt(cov.ttm_classes.not_in_bps + cov.ttm_classes.annual_only + cov.ttm_classes.incomplete)} counties
          are shown as missing or N/A, not zero.{' '}
          <button className="link" onClick={() => setMethodology({ section: 'coverage' })}>Why?</button>
        </div>
      ) : (
        <div className="banner">
          Calendar {meta.annual.year} from the finalized annual county file, the most complete county coverage
          ({fmtInt(cov.annual_classes.complete + cov.annual_classes.current_only)} counties), compared with {meta.annual.prior_year}.
        </div>
      )}
      <main className="layout">
        <div className="map-col">
          <Controls meta={meta} settings={settings} set={set} />
          <div className="map-wrap" ref={wrapRef}>
            <MapView ref={mapRef} fullBounds={geo.bbox} paints={paints} selected={selected} compare={compare}
              ariaLabel={`County choropleth map: ${metricTitle(settings.metric, settings.units, settings.view)}`}
              onHover={(g, p) => setHover(g && p ? { geoid: g, point: p } : null)}
              onSelect={(g, additive) => {
                if (!g) return;
                if (additive) toggleCompare(g);
                else setSelected(g);
              }} />
            <div className="map-tools">
              <SearchBox counties={counties} geo={geo} onPick={onPick} />
              <button className="btn" onClick={() => mapRef.current?.reset()}>Reset view</button>
              {filters.state && (
                <button className="btn" onClick={() => setFilters({ state: null })}>
                  {geo.states[filters.state].name} ×
                </button>
              )}
            </div>
            {hov && hover && box && (
              <Tooltip county={hov} point={hover.point} settings={settings} filters={filters} container={{ width: box.width, height: box.height }} />
            )}
          </div>
          <Legend title={metricTitle(settings.metric, settings.units, settings.view)} scale={scale} special={special}
            showLow={settings.metric === 'yoy'} minPrior={filters.minPrior}
            dimmedNote={filtered ? 'Breaks reflect the filtered counties; others are faded.' : null} />
        </div>
        <div className="side-col">
          {sel ? (
            <DetailPanel county={sel} meta={meta} settings={settings} inCompare={compare.includes(sel.geoid)}
              onToggleCompare={() => toggleCompare(sel.geoid)} onClose={() => setSelected(null)} />
          ) : (
            <aside className="panel summary">
              <h2>United States</h2>
              <div className="period">{periodRange(meta.ttm.current)} · data through {monthLabel(meta.data_through)}</div>
              <div className="kpis">
                <div className="kpi"><span>Units authorized (TTM)</span><b>{fmtInt(cov.us_ttm_official)}</b><small>official U.S. estimate</small></div>
                <div className="kpi"><span>YoY growth</span><b>{fmtPct(cov.us_ttm_yoy_official)}</b><small>vs {periodRange(meta.ttm.prior)}</small></div>
              </div>
              <p className="small">
                Counties with valid data sum to {fmtInt(cov.county_ttm_sum)} units, plus {fmtInt(cov.unallocated_ttm)} from
                statewide permit offices that Census does not assign to a county.
              </p>
              <h3>How to use</h3>
              <ul className="small howto">
                <li>Hover a county for values; <b>click</b> it for the full profile and history.</li>
                <li><b>Shift-click</b> counties (or tick them in the table) to compare up to five.</li>
                <li>Search a state to zoom in and filter the rankings to it.</li>
                <li>Hatched and gray counties are missing or not comparable; they are not zero.</li>
              </ul>
              <button className="btn" onClick={() => setMethodology({})}>Methodology &amp; sources</button>
            </aside>
          )}
        </div>
      </main>
      {compare.length > 0 && (
        <ComparePanel counties={compare.map((g) => byId.get(g)!).filter(Boolean)} meta={meta} settings={settings}
          onRemove={toggleCompare} onClear={() => setCompare([])} onSelect={(c) => selectCounty(c)} />
      )}
      <RankingsTable rows={rows} total={counties.length} settings={settings} filters={filters} setFilters={setFilters}
        sort={sort} setSort={setSort} geo={geo} selected={selected} compare={compare}
        onRow={(c) => selectCounty(c)} onToggleCompare={toggleCompare} onExport={exportCSV}
        periodLabel={periodLabel} lowBaseline={meta.thresholds.low_baseline_units} />
      <footer className="footer">
        <span>Source: U.S. Census Bureau, Building Permits Survey (county files) and Population Estimates Program, Vintage {meta.population.vintage}. Boundaries: Census cartographic boundary files, {meta.geography.vintage}.</span>
        <span>Dataset {meta.version} · <button className="link" onClick={() => setMethodology({ section: 'validation' })}>validation report</button> · <button className="link" onClick={() => setMethodology({ section: 'sources' })}>source files</button></span>
      </footer>
      {methodology && <Methodology meta={meta} section={methodology.section} onClose={() => setMethodology(null)} />}
    </div>
  );
}
