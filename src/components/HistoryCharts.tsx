import { useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { addMonths, fmtInt, fmtPct, monthLabel } from '../lib/format';
import type { CountyHistory, Meta } from '../lib/types';

export const SERIES = { total: '#2a78d6', sf: '#eb6834', mf: '#1baf7a' } as const;
const GRID = '#e1e0d9';
const AXIS = '#898781';

export const legendText = (v: string) => <span style={{ color: '#52514e' }}>{v}</span>;

interface Props {
  history: CountyHistory | null;
  meta: Meta;
  loading: boolean;
  error: string | null;
}

const tickYear = (p: string) => (p.endsWith('-01') ? p.slice(0, 4) : '');
const axisNum = (v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${v}`);

function ChartTip({ active, payload, label, pct }: { active?: boolean; payload?: { name: string; value: number | null; color: string; dataKey: string }[]; label?: string; pct?: boolean }) {
  if (!active || !payload?.length || !label) return null;
  const rows = payload.filter((p) => p.value != null);
  if (!rows.length) return null;
  return (
    <div className="chart-tip">
      <div className="ct-head">{/^\d{4}$/.test(label) ? label : monthLabel(label)}</div>
      {rows.map((p) => (
        <div key={p.dataKey} className="ct-row">
          <span className="sw" style={{ background: p.color }} />
          <span>{p.name}</span>
          <b>{pct ? fmtPct(p.value) : fmtInt(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

export function HistoryCharts({ history: h, meta, loading, error }: Props) {
  const [showPartial, setShowPartial] = useState(false);
  const firstFull = meta.coverage.first_full_coverage_month;

  const monthly = useMemo(() => {
    if (!h?.t_all) return [];
    return meta.history.month_full.map((full, t) => {
      const period = addMonths(meta.history.start, t);
      const ttmFull = meta.history.ttm_full[t];
      const g = (a?: (number | null)[]) => (a ? a[t] : null);
      return {
        period,
        sf: full ? g(h.m_sf) : null, mf: full ? g(h.m_mf) : null,
        sf_p: !full ? g(h.m_sf) : null, mf_p: !full ? g(h.m_mf) : null,
        t_all: ttmFull ? g(h.t_all) : null, t_sf: ttmFull ? g(h.t_sf) : null,
        t_mf: ttmFull && g(h.t_all) != null && g(h.t_sf) != null ? g(h.t_all)! - g(h.t_sf)! : null,
        t_all_p: !ttmFull ? g(h.t_all) : null,
        y_all: ttmFull ? g(h.y_all) : null, y_sf: ttmFull ? g(h.y_sf) : null,
        y_all_p: !ttmFull ? g(h.y_all) : null,
      };
    });
  }, [h, meta]);

  const visible = useMemo(() => (showPartial ? monthly : monthly.filter((d) => d.period >= firstFull)), [monthly, showPartial, firstFull]);
  const ttmVisible = useMemo(() => visible.filter((d) => d.t_all != null || d.t_all_p != null || d.period >= firstFull), [visible, firstFull]);
  const yoyVisible = useMemo(() => {
    const firstYoy = visible.findIndex((d) => d.y_all != null || (showPartial && d.y_all_p != null));
    return firstYoy < 0 ? [] : visible.slice(firstYoy);
  }, [visible, showPartial]);
  const annual = useMemo(() => (h ? h.a_sf.map((sf, i) => ({ period: String(meta.history.annual_start + i), sf, mf: h.a_mf[i] })) : []), [h, meta]);
  const anyMonthly = monthly.some((d) => d.sf != null || d.sf_p != null);

  if (loading) return <div className="charts-loading">Loading history…</div>;
  if (error) return <div className="charts-loading">History unavailable: {error}</div>;
  if (!h) return null;

  return (
    <div className="charts">
      <div className="chart-opts">
        <label className="check" title="Before January 2022, Census county monthly files covered only permit offices in the monthly sample (about 70% of U.S. units); they are partial records, not comparable with later data.">
          <input type="checkbox" checked={showPartial} onChange={(e) => setShowPartial(e.target.checked)} />
          Show pre-{firstFull.slice(0, 4)} partial monthly records
        </label>
      </div>

      {anyMonthly ? (
        <>
          <figure>
            <figcaption>Monthly units authorized <span className="muted">· as first published</span></figcaption>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={visible} barCategoryGap={0.5} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="period" tickFormatter={tickYear} interval={0} tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={{ stroke: '#c3c2b7' }} minTickGap={2} />
                <YAxis tick={{ fontSize: 10, fill: AXIS }} tickFormatter={axisNum} tickLine={false} axisLine={false} width={40} />
                <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(11,11,11,0.05)' }} />
                <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
                <Bar dataKey="sf" name="Single-family" stackId="m" fill={SERIES.sf} isAnimationActive={false} />
                <Bar dataKey="mf" name="Multifamily (2+ units)" stackId="m" fill={SERIES.mf} isAnimationActive={false} />
                {showPartial && <Bar dataKey="sf_p" name="Single-family (partial, pre-2022)" stackId="m" fill={SERIES.sf} fillOpacity={0.35} isAnimationActive={false} />}
                {showPartial && <Bar dataKey="mf_p" name="Multifamily (partial, pre-2022)" stackId="m" fill={SERIES.mf} fillOpacity={0.35} isAnimationActive={false} />}
              </BarChart>
            </ResponsiveContainer>
          </figure>

          <figure>
            <figcaption>Trailing 12-month units authorized</figcaption>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={ttmVisible} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="period" tickFormatter={tickYear} interval={0} tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={{ stroke: '#c3c2b7' }} />
                <YAxis tick={{ fontSize: 10, fill: AXIS }} tickFormatter={axisNum} tickLine={false} axisLine={false} width={40} />
                <Tooltip content={<ChartTip />} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
                <Line dataKey="t_all" name="Total" stroke={SERIES.total} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line dataKey="t_sf" name="Single-family" stroke={SERIES.sf} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line dataKey="t_mf" name="Multifamily" stroke={SERIES.mf} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                {showPartial && <Line dataKey="t_all_p" name="Total (partial, pre-2022)" stroke={SERIES.total} strokeOpacity={0.5} strokeDasharray="3 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              </LineChart>
            </ResponsiveContainer>
          </figure>

          <figure>
            <figcaption>YoY growth of trailing 12-month units</figcaption>
            {yoyVisible.length ? (
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={yoyVisible} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="period" tickFormatter={tickYear} interval={0} tick={{ fontSize: 10, fill: AXIS }} tickLine={false} axisLine={{ stroke: '#c3c2b7' }} />
                  <YAxis tick={{ fontSize: 10, fill: AXIS }} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} width={44} />
                  <ReferenceLine y={0} stroke="#c3c2b7" />
                  <Tooltip content={<ChartTip pct />} />
                  <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
                  <Line dataKey="y_all" name="Total" stroke={SERIES.total} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line dataKey="y_sf" name="Single-family" stroke={SERIES.sf} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  {showPartial && <Line dataKey="y_all_p" name="Total (partial, pre-2022)" stroke={SERIES.total} strokeOpacity={0.5} strokeDasharray="3 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="muted small">Not enough comparable months to compute growth.</p>}
          </figure>
        </>
      ) : (
        <p className="muted small">This county does not appear in the Census monthly county files.</p>
      )}

      <figure>
        <figcaption>Annual units authorized <span className="muted">· final annual files (complete records)</span></figcaption>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={annual} barCategoryGap={1} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="period" tick={{ fontSize: 10, fill: AXIS }} tickLine={false} interval={4} axisLine={{ stroke: '#c3c2b7' }} />
            <YAxis tick={{ fontSize: 10, fill: AXIS }} tickFormatter={axisNum} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(11,11,11,0.05)' }} />
            <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 11 }} formatter={legendText} />
            <Bar dataKey="sf" name="Single-family" stackId="a" fill={SERIES.sf} isAnimationActive={false} />
            <Bar dataKey="mf" name="Multifamily (2+ units)" stackId="a" fill={SERIES.mf} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </figure>
      <p className="muted small">
        Gaps mean the county is absent from that month's or year's file (missing, not zero). Monthly bars are
        values as first published; trailing totals use year-to-date files, which include later corrections.
      </p>
    </div>
  );
}
