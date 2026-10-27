import { fmtInt, fmtPct, fmtRate } from '../lib/format';
import { CLASS_LABEL, FLAG_LABEL, SHOWN_FLAGS } from '../lib/labels';
import { priorValue, row, type Settings, status, type Filters } from '../lib/model';
import type { ScoreResult } from '../lib/score';
import type { County } from '../lib/types';

interface Props {
  county: County;
  point: { x: number; y: number };
  settings: Settings;
  filters: Filters;
  container: { width: number; height: number };
  score?: ScoreResult;
}

export function Tooltip({ county: c, point, settings: s, filters: f, container, score }: Props) {
  const r = row(c, s.view);
  const sf = s.units === 'sf';
  const st = status(c, s, f, score ? new Map([[c.geoid, score]]) : undefined);
  const flags = r.flags.filter((x) => SHOWN_FLAGS.includes(x));
  const left = point.x + 16 + 280 > container.width ? point.x - 296 : point.x + 16;
  const top = Math.min(point.y + 12, container.height - 230);
  const unitWord = sf ? 'Single-family units' : 'Residential units';
  const per = s.view === 'ttm' ? 'TTM' : `CY`;
  return (
    <div className="tooltip" style={{ left, top }} role="tooltip">
      <div className="tt-head">
        <strong>{c.name}</strong>, {c.state}
      </div>
      <table>
        <tbody>
          <tr><th>{unitWord}, current {per}</th><td>{fmtInt(sf ? r.cur.u1 : r.cur.total)}</td></tr>
          <tr><th>{unitWord}, prior {per}</th><td>{fmtInt(priorValue(c, s.view, s.units))}</td></tr>
          <tr><th>YoY growth</th><td>{fmtPct(sf ? r.yoy.sf : r.yoy.all)}{st === 'low' && (s.metric === 'yoy' || s.metric === 'score') ? ' *' : ''}</td></tr>
          <tr><th>Permits per 1,000 residents</th><td>{fmtRate(sf ? r.per.sf : r.per.all)}</td></tr>
          <tr><th>Population</th><td>{fmtInt(r.pop)}</td></tr>
          <tr><th>Population growth, 3 yr</th><td>{fmtPct(c.growth.pop3)}</td></tr>
          <tr className={s.metric === 'score' ? 'hl' : ''}><th>Land Opportunity Score</th><td>{score?.score != null ? `${Math.round(score.score)} / 100` : 'N/A'}</td></tr>
        </tbody>
      </table>
      <div className={`tt-status tone-${CLASS_LABEL[r.cls].tone}`}>
        <span className="dot" /> {CLASS_LABEL[r.cls].short}
        {flags.length > 0 && <span className="tt-flags"> · {flags.map((x) => FLAG_LABEL[x].label).join(' · ')}</span>}
      </div>
      {st === 'low' && (s.metric === 'yoy' || s.metric === 'score') && (
        <div className="tt-note">* Prior volume below {fmtInt(f.minPrior)} units — shown gray on the map.</div>
      )}
      <div className="tt-hint">Click for details · Shift-click to compare</div>
    </div>
  );
}
