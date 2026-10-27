import { useEffect, useState } from 'react';
import { loadStateHistory } from '../lib/data';
import { fmtInt, fmtPct, fmtRate, fmtShare, periodRange } from '../lib/format';
import { CLASS_LABEL, FLAG_LABEL } from '../lib/labels';
import { row, type Settings } from '../lib/model';
import { COMPONENTS, type ScoreResult } from '../lib/score';
import type { County, CountyHistory, Meta, RankTuple } from '../lib/types';
import { HistoryCharts, SERIES } from './HistoryCharts';

interface Props {
  county: County;
  meta: Meta;
  settings: Settings;
  inCompare: boolean;
  score?: ScoreResult;
  onToggleCompare: () => void;
  onClose: () => void;
}

function Rank({ r }: { r: RankTuple }) {
  if (!r[0]) return <span className="muted">not ranked</span>;
  return <span>#{fmtInt(r[0])} <span className="muted">of {fmtInt(r[1])}</span></span>;
}

export function DetailPanel({ county: c, meta, settings: s, score, inCompare, onToggleCompare, onClose }: Props) {
  const [hist, setHist] = useState<CountyHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    loadStateHistory(c.statefp)
      .then((h) => { if (live) setHist(h[c.geoid] ?? null); })
      .catch((e: Error) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [c.geoid, c.statefp]);

  const r = row(c, s.view);
  const sfKey = s.units === 'sf' ? 'sf' : 'all';
  const period = s.view === 'ttm'
    ? `${periodRange(meta.ttm.current)} vs ${periodRange(meta.ttm.prior)}`
    : `Calendar ${meta.annual.year} vs ${meta.annual.prior_year} (final annual files)`;
  const total = r.cur.total;
  const sfShare = total ? (r.cur.u1 ?? 0) / total : null;
  const mfShare = total && r.cur.mf != null ? r.cur.mf / total : null;
  const cls = CLASS_LABEL[r.cls];
  const popYear = s.view === 'ttm' ? meta.population.year : meta.population.annual_view_year;
  const gap = c.recon.decYtd != null && c.recon.annual != null ? c.recon.decYtd - c.recon.annual : null;

  return (
    <aside className="panel" aria-label={`Details for ${c.name}, ${c.state}`}>
      <div className="panel-head">
        <div>
          <h2>{c.name}</h2>
          <div className="muted">{c.state} · FIPS {c.geoid}</div>
        </div>
        <div className="panel-actions">
          <button className={`btn ${inCompare ? 'on' : ''}`} onClick={onToggleCompare}>{inCompare ? '✓ Comparing' : '+ Compare'}</button>
          <button className="btn icon" aria-label="Close details" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="period">{period}</div>
      <div className={`status tone-${cls.tone}`} title={cls.long}><span className="dot" />{cls.short}: {cls.long}</div>

      <section>
        <h3>Overview <span className="muted">· {s.units === 'sf' ? 'single-family units' : 'all residential units'}</span></h3>
        <div className="kpis">
          <div className="kpi"><span>Units authorized</span><b>{fmtInt(s.units === 'sf' ? r.cur.u1 : r.cur.total)}</b><small>prior {fmtInt(s.units === 'sf' ? r.pri.u1 : r.pri.total)}</small></div>
          <div className="kpi"><span>YoY growth</span><b>{fmtPct(r.yoy[sfKey])}</b><small>{r.flags.includes('low_baseline') ? 'low baseline' : ' '}</small></div>
          <div className="kpi"><span>Per 1,000 residents</span><b>{fmtRate(r.per[sfKey])}</b><small title={`Population, July 1, ${popYear} (PEP Vintage ${meta.population.vintage})`}>pop. {fmtInt(r.pop)}</small></div>
        </div>
        <table className="ranks">
          <thead><tr><th>Ranking</th><th>National</th><th>Within {c.st}</th></tr></thead>
          <tbody>
            {([['Absolute permits', `abs_${sfKey}`], ['YoY growth', `yoy_${sfKey}`], ['Per 1,000 residents', `per_${sfKey}`]] as const).map(([lbl, k]) => {
              const t = r.rank[k];
              return (
                <tr key={k}><th>{lbl}</th><td><Rank r={t} /></td><td>{t[2] ? <span>#{t[2]} <span className="muted">of {t[3]}</span></span> : <span className="muted">not ranked</span>}</td></tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted small">Ranked among counties with comparable data; growth ranks exclude prior periods under {meta.thresholds.low_baseline_units} units.</p>
      </section>

      <section className="score-section">
        <h3>Land Opportunity Score <span className="muted">· {s.units === 'sf' ? 'single-family' : 'all residential'}</span></h3>
        {score?.score != null ? (
          <>
            <div className="kpis two">
              <div className="kpi"><span>Score (0–100)</span><b>{Math.round(score.score)}</b><small>{score.partial ? 'partial: some inputs N/A' : 'all inputs available'}</small></div>
              <div className="kpi"><span>Rank</span><b>#{fmtInt(score.rank[0])}</b><small>of {fmtInt(score.rank[1])} · #{score.rank[2]} of {score.rank[3]} in {c.st}</small></div>
            </div>
            <table className="score-parts">
              <thead><tr><th>Input</th><th className="num">Value</th><th className="num">Percentile</th><th className="num">Weight</th></tr></thead>
              <tbody>
                {score.parts.map((p) => {
                  const def = COMPONENTS.find((d) => d.key === p.key)!;
                  const val = p.value == null ? 'N/A' : p.key === 'volume' ? fmtInt(p.value) : p.key === 'intensity' ? fmtRate(p.value) : fmtPct(p.value);
                  return (
                    <tr key={p.key} title={def.describe(s.units, s.view, meta.growth)}>
                      <th>{def.label}</th>
                      <td className="num">{val}</td>
                      <td className="num">{p.pct == null ? 'N/A' : Math.round(p.pct)}<span className="pctbar"><span style={{ width: `${p.pct ?? 0}%` }} /></span></td>
                      <td className="num muted">{Math.round(p.weight * 100)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted small">Percentiles are national, among scored counties. Change the weights above the map when the score is selected.</p>
          </>
        ) : (
          <p className="small muted">
            {score?.status === 'low' ? `Not scored: prior-period volume is below the minimum (${s.units === 'sf' ? 'single-family ' : ''}units).`
              : score?.status === 'nodata' ? 'Not scored: no Census permit data for this county.'
              : 'Not scored: current and prior periods are not both available.'}
          </p>
        )}
      </section>

      <section>
        <h3>Construction breakdown</h3>
        <table className="breakdown">
          <tbody>
            <tr><th><span className="sw" style={{ background: SERIES.sf }} />Single-family</th><td>{fmtInt(r.cur.u1)}</td><td className="muted">{fmtShare(sfShare)}</td></tr>
            <tr><th className="indent">Two-unit buildings</th><td>{fmtInt(r.cur.u2)}</td><td /></tr>
            <tr><th className="indent">Three- and four-unit buildings</th><td>{fmtInt(r.cur.u34)}</td><td /></tr>
            <tr><th className="indent">Five-or-more-unit buildings</th><td>{fmtInt(r.cur.u5)}</td><td /></tr>
            <tr><th><span className="sw" style={{ background: SERIES.mf }} />Total multifamily (2+ units)</th><td>{fmtInt(r.cur.mf)}</td><td className="muted">{fmtShare(mfShare)}</td></tr>
            <tr className="total"><th>Total residential units</th><td>{fmtInt(total)}</td><td /></tr>
          </tbody>
        </table>
        {sfShare != null && mfShare != null && total! > 0 && (
          <div className="sharebar" role="img" aria-label={`Single-family ${fmtShare(sfShare)}, multifamily ${fmtShare(mfShare)}`}>
            <span style={{ width: `${sfShare * 100}%`, background: SERIES.sf }} />
            <span style={{ width: `${mfShare * 100}%`, background: SERIES.mf }} />
          </div>
        )}
        {r.imputed != null && <p className="muted small">Share of units imputed by Census (non-reporting or annual-only offices): {fmtShare(r.imputed)}</p>}
      </section>

      {r.flags.length > 0 && (
        <section>
          <h3>Data notes</h3>
          <ul className="flags">
            {r.flags.filter((f) => f !== 'low_baseline_sf' || s.units === 'sf').map((f) => (
              <li key={f}><b>{FLAG_LABEL[f].label}.</b> {FLAG_LABEL[f].detail}</li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Historical trends</h3>
        <HistoryCharts history={hist} meta={meta} loading={loading} error={error} />
      </section>

      <section>
        <h3>Monthly series vs final annual, {meta.annual.year}</h3>
        <p className="small">
          December year-to-date (monthly estimates): <b>{fmtInt(c.recon.decYtd)}</b> · final annual file: <b>{fmtInt(c.recon.annual)}</b>
          {gap != null && c.recon.annual ? <> · difference {fmtPct((gap / c.recon.annual) * 100)}</> : null}
        </p>
        <p className="muted small">The two Census series are estimated differently and are not combined in any calculation.</p>
      </section>
    </aside>
  );
}
