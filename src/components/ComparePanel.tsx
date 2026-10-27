import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { loadStateHistory } from '../lib/data';
import { addMonths, fmtInt, fmtPct, fmtRate, monthLabel } from '../lib/format';
import { CLASS_LABEL } from '../lib/labels';
import { legendText } from './HistoryCharts';
import { row, type Settings } from '../lib/model';
import type { ScoreMap } from '../lib/score';
import type { County, CountyHistory, Meta } from '../lib/types';

// Categorical slots 1-5 in fixed order (validated adjacent-pair palette).
const SLOTS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

interface Props {
  counties: County[];
  meta: Meta;
  settings: Settings;
  onRemove: (geoid: string) => void;
  onClear: () => void;
  onSelect: (c: County) => void;
  scores?: ScoreMap;
}

export function ComparePanel({ counties, meta, settings: s, onRemove, onClear, onSelect, scores }: Props) {
  const [hist, setHist] = useState<Record<string, CountyHistory>>({});
  useEffect(() => {
    let live = true;
    Promise.all(counties.map((c) => loadStateHistory(c.statefp).then((h) => [c.geoid, h[c.geoid]] as const)))
      .then((pairs) => { if (live) setHist(Object.fromEntries(pairs.filter((p) => p[1]))); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [counties]);

  const key = s.units === 'sf' ? 't_sf' : 't_all';
  const firstFull = meta.coverage.first_full_coverage_month;
  const data = useMemo(() => {
    const out: Record<string, string | number | null>[] = [];
    meta.history.ttm_full.forEach((full, t) => {
      const period = addMonths(meta.history.start, t);
      if (period < firstFull || !full) return;
      const d: Record<string, string | number | null> = { period };
      for (const c of counties) d[c.geoid] = hist[c.geoid]?.[key]?.[t] ?? null;
      out.push(d);
    });
    return out;
  }, [hist, counties, meta, key, firstFull]);

  // Color follows the entity: slot is fixed by position in the selection order.
  const colorOf = (g: string) => SLOTS[counties.findIndex((c) => c.geoid === g)];
  const sf = s.units === 'sf';

  return (
    <section className="compare" aria-label="County comparison">
      <div className="compare-head">
        <h2>Compare counties <span className="muted">· {sf ? 'single-family' : 'all residential'} units</span></h2>
        <button className="btn" onClick={onClear}>Clear</button>
      </div>
      <div className="compare-body">
        <table className="table compact">
          <thead>
            <tr><th>County</th><th className="num">Current</th><th className="num">Prior</th><th className="num">YoY</th><th className="num">Per 1,000</th><th className="num">Population</th><th className="num">SF share</th><th className="num">Land score</th><th>Coverage</th><th /></tr>
          </thead>
          <tbody>
            {counties.map((c) => {
              const r = row(c, s.view);
              return (
                <tr key={c.geoid} onClick={() => onSelect(c)}>
                  <td><span className="sw" style={{ background: colorOf(c.geoid) }} />{c.name}, {c.st}</td>
                  <td className="num">{fmtInt(sf ? r.cur.u1 : r.cur.total)}</td>
                  <td className="num">{fmtInt(sf ? r.pri.u1 : r.pri.total)}</td>
                  <td className="num">{fmtPct(sf ? r.yoy.sf : r.yoy.all)}</td>
                  <td className="num">{fmtRate(sf ? r.per.sf : r.per.all)}</td>
                  <td className="num">{fmtInt(r.pop)}</td>
                  <td className="num">{r.cur.total ? `${Math.round(((r.cur.u1 ?? 0) / r.cur.total) * 100)}%` : 'N/A'}</td>
                  <td className="num"><b>{scores?.get(c.geoid)?.score != null ? Math.round(scores.get(c.geoid)!.score!) : 'N/A'}</b></td>
                  <td><span className={`chip tone-${CLASS_LABEL[r.cls].tone}`}>{CLASS_LABEL[r.cls].short}</span></td>
                  <td><button className="btn icon" aria-label={`Remove ${c.name}`} onClick={(e) => { e.stopPropagation(); onRemove(c.geoid); }}>×</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <figure>
          <figcaption>Trailing 12-month units authorized, {monthLabel(firstFull)} onward</figcaption>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#e1e0d9" />
              <XAxis dataKey="period" tickFormatter={(p: string) => (p.endsWith('-01') ? p.slice(0, 4) : '')} interval={0} tick={{ fontSize: 11, fill: '#898781' }} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#898781' }} tickFormatter={(v: number) => fmtInt(v)} tickLine={false} axisLine={false} width={56} />
              <Tooltip formatter={(v: number) => fmtInt(v)} labelFormatter={(l: string) => monthLabel(l)} />
              <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendText} />
              {counties.map((c) => (
                <Line key={c.geoid} dataKey={c.geoid} name={`${c.name}, ${c.st}`} stroke={colorOf(c.geoid)} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </figure>
      </div>
    </section>
  );
}
