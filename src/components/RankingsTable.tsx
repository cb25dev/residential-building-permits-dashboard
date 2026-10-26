import { useState } from 'react';
import { fmtInt, fmtPct, fmtRate } from '../lib/format';
import { CLASS_LABEL } from '../lib/labels';
import { priorValue, row, type Filters, type Settings, type SortKey } from '../lib/model';
import type { County, GeoIndex } from '../lib/types';

interface Props {
  rows: County[];
  total: number;
  settings: Settings;
  filters: Filters;
  setFilters: (p: Partial<Filters>) => void;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  setSort: (s: { key: SortKey; dir: 'asc' | 'desc' }) => void;
  geo: GeoIndex;
  selected: string | null;
  compare: string[];
  onRow: (c: County) => void;
  onToggleCompare: (geoid: string) => void;
  onExport: () => void;
  periodLabel: string;
  lowBaseline: number;
}

const POP_STEPS = [0, 1_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const PAGE = 100;

export function RankingsTable(p: Props) {
  const { rows, settings: s, filters: f, sort } = p;
  const [limit, setLimit] = useState(PAGE);
  const sf = s.units === 'sf';
  const per = s.view === 'ttm' ? 'TTM' : `CY`;
  const cols: { key: SortKey; label: string; num?: boolean; title?: string }[] = [
    { key: 'name', label: 'County' },
    { key: 'st', label: 'State' },
    { key: 'cur', label: `Current ${per}`, num: true, title: `${sf ? 'Single-family' : 'All residential'} units authorized, ${p.periodLabel}` },
    { key: 'pri', label: `Prior ${per}`, num: true },
    { key: 'yoy', label: 'YoY %', num: true },
    { key: 'pop', label: 'Population', num: true },
    { key: 'per', label: 'Per 1,000', num: true },
    { key: 'sf', label: 'Single-family', num: true },
    { key: 'mf', label: 'Multifamily', num: true, title: 'Units in buildings with 2 or more units' },
    { key: 'cls', label: 'Coverage' },
  ];
  const clickSort = (key: SortKey) =>
    p.setSort({ key, dir: sort.key === key ? (sort.dir === 'asc' ? 'desc' : 'asc') : key === 'name' || key === 'st' ? 'asc' : 'desc' });

  return (
    <section className="rankings" aria-label="County rankings">
      <div className="filters">
        <h2>County rankings</h2>
        <label>State
          <select value={f.state ?? ''} onChange={(e) => p.setFilters({ state: e.target.value || null })}>
            <option value="">All states</option>
            {Object.entries(p.geo.states).sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([fp, st]) => (
              <option key={fp} value={fp}>{st.name}</option>
            ))}
          </select>
        </label>
        <label>County name
          <input type="search" value={f.text} placeholder="Filter table…" onChange={(e) => p.setFilters({ text: e.target.value })} />
        </label>
        <label>Min. population
          <select value={f.minPop} onChange={(e) => p.setFilters({ minPop: Number(e.target.value) })}>
            {POP_STEPS.map((v) => <option key={v} value={v}>{v ? fmtInt(v) : 'Any'}</option>)}
          </select>
        </label>
        <label title="Applies when viewing YoY growth: counties with a smaller prior-period volume are grayed on the map and excluded from the growth table">
          Min. prior-period units (YoY)
          <input type="number" min={0} step={10} value={f.minPrior} onChange={(e) => p.setFilters({ minPrior: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label>Sort by
          <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(':'); p.setSort({ key: key as SortKey, dir: dir as 'asc' | 'desc' }); }}>
            <option value="cur:desc">Current permits (high → low)</option>
            <option value="yoy:desc">YoY growth (high → low)</option>
            <option value="yoy:asc">YoY growth (low → high)</option>
            <option value="per:desc">Permits per 1,000 (high → low)</option>
            <option value="pop:desc">Population (high → low)</option>
            <option value="mf:desc">Multifamily units (high → low)</option>
            <option value="name:asc">County name (A → Z)</option>
          </select>
        </label>
        <div className="filters-end">
          <span className="muted">{fmtInt(rows.length)} of {fmtInt(p.total)} counties</span>
          <button className="btn" onClick={p.onExport}>Export CSV</button>
        </div>
      </div>
      {s.metric === 'yoy' && <p className="muted small">Growth view: counties with fewer than {fmtInt(f.minPrior)} prior-period {sf ? 'single-family ' : ''}units are excluded (default {p.lowBaseline}).</p>}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="cmp" title="Select to compare">Cmp</th>
              <th className="num">Rank</th>
              {cols.map((c) => (
                <th key={c.key} className={c.num ? 'num' : ''} title={c.title} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button className="sort" onClick={() => clickSort(c.key)}>
                    {c.label}{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((c, i) => {
              const r = row(c, s.view);
              return (
                <tr key={c.geoid} className={c.geoid === p.selected ? 'sel' : ''} onClick={() => p.onRow(c)}>
                  <td className="cmp" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Compare ${c.name}`} checked={p.compare.includes(c.geoid)}
                           disabled={!p.compare.includes(c.geoid) && p.compare.length >= 5} onChange={() => p.onToggleCompare(c.geoid)} />
                  </td>
                  <td className="num muted">{i + 1}</td>
                  <td>{c.name}</td>
                  <td>{c.st}</td>
                  <td className="num">{fmtInt(sf ? r.cur.u1 : r.cur.total)}</td>
                  <td className="num">{fmtInt(priorValue(c, s.view, s.units))}</td>
                  <td className="num">{fmtPct(sf ? r.yoy.sf : r.yoy.all)}</td>
                  <td className="num">{fmtInt(r.pop)}</td>
                  <td className="num">{fmtRate(sf ? r.per.sf : r.per.all)}</td>
                  <td className="num">{fmtInt(r.cur.u1)}</td>
                  <td className="num">{fmtInt(r.cur.mf)}</td>
                  <td><span className={`chip tone-${CLASS_LABEL[r.cls].tone}`} title={CLASS_LABEL[r.cls].long}>{CLASS_LABEL[r.cls].short}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button className="btn more" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>}
    </section>
  );
}
