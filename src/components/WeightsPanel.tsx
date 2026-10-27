import { fmtInt } from '../lib/format';
import { COMPONENTS, DEFAULT_WEIGHTS, isDefaultWeights, type GrowthYears, type Weights } from '../lib/score';
import type { Units, View } from '../lib/types';

interface Props {
  weights: Weights;
  setWeights: (w: Weights) => void;
  units: Units;
  view: View;
  years: GrowthYears;
  minPrior: number;
  scored: number;
}

export function WeightsPanel({ weights, setWeights, units, view, years, minPrior, scored }: Props) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return (
    <div className="weights" aria-label="Land Opportunity Score weights">
      <div className="weights-head">
        <b>Score weights</b>
        <span className="muted small">
          {fmtInt(scored)} counties scored · each input is a national percentile · counties need ≥ {fmtInt(minPrior)} prior-period
          {units === 'sf' ? ' single-family' : ''} units
        </span>
        <button className="btn" disabled={isDefaultWeights(weights)} onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}>Reset weights</button>
      </div>
      <div className="weights-grid">
        {COMPONENTS.map((c) => (
          <label key={c.key} title={c.describe(units, view, years)}>
            <span className="w-label">{c.label}<span className="w-pct">{total ? Math.round((weights[c.key] / total) * 100) : 0}%</span></span>
            <input type="range" min={0} max={100} step={5} value={weights[c.key]} aria-label={`${c.label} weight`}
              onChange={(e) => setWeights({ ...weights, [c.key]: Number(e.target.value) })} />
            <span className="w-desc">{c.describe(units, view, years)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
