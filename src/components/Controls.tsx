import { METRIC_LABEL } from '../lib/labels';
import type { Settings } from '../lib/model';
import type { Meta, Metric } from '../lib/types';
import { periodRange } from '../lib/format';

interface Props {
  meta: Meta;
  settings: Settings;
  set: (p: Partial<Settings>) => void;
}

function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: {
  value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string; size?: 'md' | 'sm' | 'lg';
}) {
  return (
    <div className={`segmented ${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} title={o.title}
                className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Controls({ meta, settings: s, set }: Props) {
  const metrics: Metric[] = ['abs', 'yoy', 'per', 'score'];
  return (
    <div className="controls">
      <Segmented<Metric> label="Map metric" size="lg" value={s.metric} onChange={(metric) => set({ metric })}
        options={metrics.map((m) => ({ value: m, label: METRIC_LABEL[m] }))} />
      <div className="controls-row">
        <Segmented label="Period" value={s.view} onChange={(view) => set({ view })} options={[
          { value: 'ttm', label: `Trailing 12 months · ${periodRange(meta.ttm.current)}`, title: 'Monthly Census series (estimates; latest month preliminary)' },
          { value: 'annual', label: `Calendar ${meta.annual.year} · final annual`, title: 'Finalized annual county file: the most complete county coverage' },
        ]} />
        <Segmented label="Units" value={s.units} onChange={(units) => set({ units })} options={[
          { value: 'all', label: 'All residential' },
          { value: 'sf', label: 'Single-family' },
        ]} size="sm" />
        {s.metric === 'abs' && (
          <Segmented label="Color scaling" value={s.absScale} onChange={(absScale) => set({ absScale })} size="sm" options={[
            { value: 'log', label: 'Log scale', title: 'Classes evenly spaced on a logarithmic scale' },
            { value: 'quantile', label: 'Quantiles', title: 'Each class holds roughly the same number of counties' },
          ]} />
        )}
        {s.metric === 'score' && s.units !== 'sf' && (
          <span className="hint">Tip: single-family units track buildable-lot demand most closely.</span>
        )}
        {(s.metric === 'yoy' || s.metric === 'score') && (
          <label className="check" title="Swap green for blue (red–blue scale for color-vision deficiencies)">
            <input type="checkbox" checked={s.cvd} onChange={(e) => set({ cvd: e.target.checked })} />
            Color-vision friendly
          </label>
        )}
      </div>
    </div>
  );
}
