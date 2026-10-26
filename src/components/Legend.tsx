import { fmtInt } from '../lib/format';
import { SPECIAL, type Scale } from '../lib/scales';

interface Props {
  title: string;
  scale: Scale;
  special: { nodata: number; na: number; low: number };
  showLow: boolean;
  minPrior: number;
  dimmedNote: string | null;
}

export function Legend({ title, scale, special, showLow, minPrior, dimmedNote }: Props) {
  return (
    <div className="legend" aria-label="Map legend">
      <div className="legend-title">{title}</div>
      <div className="legend-row">
      <ul className="legend-classes">
        {scale.classes.map((c, i) => (
          <li key={i} title={`${fmtInt(c.count)} counties`}>
            <span className="swatch" style={{ background: c.color }} />
            <span className="lbl">{c.label}</span>
            <span className="cnt">{fmtInt(c.count)}</span>
          </li>
        ))}
      </ul>
      <ul className="legend-special">
        {showLow && (
          <li title={`Prior-period volume below ${minPrior} units: growth rates from small bases are volatile`}>
            <span className="swatch pat-low" />
            <span className="lbl">{SPECIAL.low.label} (&lt; {fmtInt(minPrior)} units)</span>
            <span className="cnt">{fmtInt(special.low)}</span>
          </li>
        )}
        <li title="Data exist for the county but this metric cannot be computed reliably (incomplete inputs, annual-only reporting, or zero prior permits)">
          <span className="swatch pat-na" />
          <span className="lbl">{SPECIAL.na.label}</span>
          <span className="cnt">{fmtInt(special.na)}</span>
        </li>
        <li title="No permit-issuing jurisdiction for this county appears in the Census county files. This is missing data, not zero permits.">
          <span className="swatch pat-nodata" />
          <span className="lbl">{SPECIAL.nodata.label}</span>
          <span className="cnt">{fmtInt(special.nodata)}</span>
        </li>
      </ul>
      </div>
      <p className="legend-note">{scale.note}{dimmedNote ? ` ${dimmedNote}` : ''}</p>
    </div>
  );
}
