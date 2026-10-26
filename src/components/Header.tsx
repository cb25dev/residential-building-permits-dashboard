import { dateLabel, fmtInt, monthLabel } from '../lib/format';
import type { Meta } from '../lib/types';

interface Props {
  meta: Meta;
  onMethodology: (section?: string) => void;
}

export function Header({ meta, onMethodology }: Props) {
  const cov = meta.coverage;
  const U = meta.geography.universe;
  return (
    <header className="header">
      <div className="brand">
        <h1>U.S. Residential Building Permits</h1>
        <p className="sub">
          County-level new housing units authorized by building permits · not housing starts
        </p>
      </div>
      <dl className="facts" aria-label="Data status">
        <div className="fact primary">
          <dt>Data through</dt>
          <dd>
            {monthLabel(meta.data_through, true)}
            {meta.latest_month_preliminary && <span className="tag" title="The latest month is a preliminary estimate; Census incorporates late reports in the next release.">preliminary</span>}
          </dd>
        </div>
        <div className="fact">
          <dt>Last successful update</dt>
          <dd>{dateLabel(meta.last_successful_update)}</dd>
        </div>
        <div className="fact">
          <dt>Source</dt>
          <dd><a href={meta.sources.bps_home} target="_blank" rel="noreferrer">U.S. Census Bureau</a></dd>
        </div>
        <div className="fact">
          <dt>Population estimates</dt>
          <dd title={`Census PEP Vintage ${meta.population.vintage}, July 1, ${meta.population.year} estimates`}>
            Vintage {meta.population.vintage} (July 1, {meta.population.year})
          </dd>
        </div>
        <div className="fact">
          <dt>Counties covered</dt>
          <dd title="Counties with a valid current trailing-12-month value, of all county equivalents in the boundary universe (50 states + DC)">
            {fmtInt(cov.counties_with_current_ttm)} <span className="muted">of {fmtInt(U)}</span>
          </dd>
        </div>
        <div className="fact">
          <dt>Valid current &amp; prior TTM</dt>
          <dd>{cov.ttm_complete_pct.toFixed(1)}% <span className="muted">({fmtInt(cov.ttm_classes.complete)})</span></dd>
        </div>
        <div className="fact">
          <dt>Known limitations</dt>
          <dd><button className="link" onClick={() => onMethodology('coverage')}>Coverage &amp; methodology</button></dd>
        </div>
      </dl>
    </header>
  );
}
