import { useEffect, useRef } from 'react';
import { dateLabel, fmtInt, monthLabel, periodRange } from '../lib/format';
import type { Meta } from '../lib/types';

interface Props {
  meta: Meta;
  section?: string;
  onClose: () => void;
}

export function Methodology({ meta, section, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = section ? ref.current?.querySelector(`#m-${section}`) : null;
    (el ?? ref.current)?.scrollIntoView({ block: 'start' });
  }, [section]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const c = meta.coverage;
  const U = meta.geography.universe;
  const t = meta.thresholds;
  const offices = c.statewide_offices.filter((o) => (o.ttm_units ?? 0) > 0 || (o.annual_units ?? 0) > 0);
  const firstFull = c.first_full_coverage_month;
  const pre = Object.entries(c.monthly_coverage_ratio).filter(([p, v]) => p < firstFull && v != null).map(([, v]) => v as number);
  const preAvg = pre.length ? pre.reduce((a, b) => a + b, 0) / pre.length : null;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Methodology and coverage" onClick={onClose}>
      <div className="modal-body" ref={ref} onClick={(e) => e.stopPropagation()}>
        <button className="btn icon close" aria-label="Close" onClick={onClose}>×</button>
        <h2>Methodology, coverage and sources</h2>
        <p className="muted">Dataset version {meta.version} · processing {meta.processing_version} · last successful update {dateLabel(meta.last_successful_update)}</p>

        <h3 id="m-coverage">Coverage: can a comparable 12-month figure be produced for every county?</h3>
        <p>
          <b>No.</b> Census county monthly files cover every county that contains a permit-issuing jurisdiction only from{' '}
          <b>{monthLabel(firstFull, true)}</b> onward. Since then Census has imputed activity for permit offices that report only
          annually. Earlier county monthly files contained only offices in the monthly sample
          {preAvg != null && <> (about {Math.round(preAvg * 100)}% of U.S. units)</>}, so they are partial records. Within
          the current period:
        </p>
        <table className="table compact">
          <tbody>
            <tr><th>County equivalents in the boundary universe (50 states + DC, {meta.geography.vintage} boundaries)</th><td className="num">{fmtInt(U)}</td></tr>
            <tr><th>Valid current and prior trailing-12-month values</th><td className="num">{fmtInt(c.ttm_classes.complete)} ({c.ttm_complete_pct.toFixed(1)}%)</td></tr>
            <tr><th>Current period only (growth N/A)</th><td className="num">{fmtInt(c.ttm_classes.current_only)}</td></tr>
            <tr><th>In the monthly files but not computable (missing input or revision inconsistency)</th><td className="num">{fmtInt(c.ttm_classes.incomplete)}</td></tr>
            <tr><th>Only in the final annual file</th><td className="num">{fmtInt(c.ttm_classes.annual_only)}</td></tr>
            <tr><th>Not in any Census county file (no permit-issuing jurisdiction reported; not zero)</th><td className="num">{fmtInt(c.ttm_classes.not_in_bps)}</td></tr>
          </tbody>
        </table>
        <p>
          Counties with valid TTM values account for {fmtInt(c.county_ttm_sum)} units. Statewide permit offices that Census
          cannot attribute to a county account for another {fmtInt(c.unallocated_ttm)}. The official U.S. trailing total from
          the Census state files is {fmtInt(c.us_ttm_official)} ({periodRange(meta.ttm.current)}).
          {offices.length > 0 && <> The statewide offices are: {offices.map((o) => `${o.name} (${fmtInt(o.ttm_units)} units)`).join('; ')}. County figures in those states exclude these units.</>}
        </p>
        <p>
          The <b>calendar-year view</b> uses the finalized annual county file for {meta.annual.year}, which covers{' '}
          {fmtInt(c.annual_classes.complete + c.annual_classes.current_only)} counties. It is the most complete county
          coverage available, at the cost of timeliness.
        </p>

        <h3 id="m-permits">1. Building permits versus housing starts</h3>
        <p>
          This dashboard shows <b>housing units authorized by building permits</b> (Census Building Permits Survey). A permit
          authorizes construction; it is not a start. Starts can lag authorization, and some permitted units are never built.
          Housing starts are a separate Census series (New Residential Construction) and are not published at the county level.
          According to Census, over 99% of privately owned residential buildings are constructed in permit-issuing places; areas
          without permit requirements are outside the survey.
        </p>

        <h3>2. Housing units versus buildings</h3>
        <p>
          All figures count <b>housing units</b>, not buildings. A 100-unit apartment building adds 100 units. Single-family means
          one-unit buildings. Multifamily here means all units in buildings with two or more units (2-unit, 3–4-unit and
          5+-unit buildings), so single-family plus multifamily equals the total.
        </p>

        <h3>3. Monthly versus final annual county coverage</h3>
        <p>
          The monthly series and the final annual file are different estimates. The annual file includes every permit office's
          annual report, and Census uses annual data where both exist. For {meta.annual.year}, the monthly series'
          December year-to-date differs from the annual count by more than {Math.round(t.divergence_share * 100)}% (and at least{' '}
          {t.divergence_min_units} units) in {fmtInt(c.divergent_counties)} counties. These are flagged "Monthly ≠ annual".
          The two series are <b>never mixed</b> in a calculation.
        </p>

        <h3>4. Trailing 12-month methodology</h3>
        <p>
          With data through {monthLabel(meta.data_through, true)}, the current period is {periodRange(meta.ttm.current)} and the
          prior period is {periodRange(meta.ttm.prior)}. Totals are built from Census year-to-date (YTD) files, which include late
          reports and corrections for earlier months of the year:
        </p>
        <pre className="formula">TTM(y, m) = B(y, m) + YTD(y−1, Dec) − B(y−1, m)
B(y, m)   = YTD(y, m+1) − Month(y, m+1)   when the next release exists (otherwise YTD(y, m))</pre>
        <p>
          Using the next release's cumulative total (B) for the subtraction counts a late report exactly once. The plain
          YTD(y, m) difference would push corrections into the wrong window. December TTM equals December YTD. Every term
          comes from the monthly series, and annual totals are never used to manufacture monthly values. If a county is missing
          from any required file, the period is <b>N/A</b>; a missing record is never treated as zero. When Census corrections
          move units between structure types, a type's slice can turn negative. That type is shown as N/A while the total
          remains valid.
        </p>

        <h3>5. YoY percentage calculation</h3>
        <p>
          YoY = (current / prior − 1) × 100. A prior period of zero gives <b>undefined</b> growth, not infinite growth. Counties
          with fewer than {t.low_baseline_units} prior-period units are flagged <i>low baseline</i>. In the growth view they
          are grayed on the map and excluded from rankings by default; the threshold can be changed in the filters. Color
          breaks come from the data: a neutral band holds the 10% of counties with the smallest change, and declines and increases
          are split into terciles with open-ended outer classes, so extreme outliers cannot stretch the scale.
        </p>

        <h3>6. Population normalization</h3>
        <p>
          Permits per 1,000 residents = units / population × 1,000. Population comes from the Census Population Estimates
          Program, <b>Vintage {meta.population.vintage}</b>, using July 1, {meta.population.year} estimates (calendar view: July 1,{' '}
          {meta.population.annual_view_year}). New vintages are ingested automatically when Census publishes them, and earlier
          vintages are kept for reproducibility. No population value is interpolated or substituted. Counties under{' '}
          {fmtInt(t.small_population)} residents are flagged because their rates are volatile.
        </p>

        <h3>7. Census estimates and revisions</h3>
        <p>
          Monthly county figures are Census estimates that combine reported permits with imputations for offices that did not
          report. The share imputed is shown per county, and counties above {Math.round(t.high_imputation_share * 100)}% are
          flagged. The latest month is preliminary. Census does not revise monthly county data after publication, except
          through later YTD files. Each refresh re-checks every source file by SHA-256 and reprocesses all periods from raw
          files whenever any file changes. Census re-uploads are recorded in the manifest with the prior file hash.
        </p>

        <h3>8. Comparing counties with very different permit volumes</h3>
        <p>
          Large metros dominate absolute counts, so the map offers log and quantile scaling. Small counties dominate extreme
          percentages, which is why low-baseline counties are excluded from growth rankings. Per-capita rates in very small
          counties can swing widely on a single subdivision. Rankings are computed only among counties with comparable
          coverage. Pre-2022 monthly history is labeled partial and is never used in current metrics.
        </p>

        <h3 id="m-sources">Sources</h3>
        <ul className="sources">
          <li><a href={meta.sources.bps_home} target="_blank" rel="noreferrer">Census Building Permits Survey</a> · <a href={meta.sources.bps_county_dir} target="_blank" rel="noreferrer">county files</a> · <a href={meta.sources.bps_methodology} target="_blank" rel="noreferrer">methodology</a> · <a href={meta.sources.bps_schedule} target="_blank" rel="noreferrer">release schedule</a></li>
          <li><a href={meta.population.source.url} target="_blank" rel="noreferrer">PEP county population estimates, Vintage {meta.population.vintage}</a> (<a href={meta.sources.pep_home} target="_blank" rel="noreferrer">program</a>)</li>
          <li><a href={meta.geography.county_file.url} target="_blank" rel="noreferrer">Cartographic boundary file {meta.geography.county_file.file}</a> · <a href={meta.sources.geo_home} target="_blank" rel="noreferrer">boundary files</a>. {meta.geography.projection}.</li>
        </ul>
        <details>
          <summary>Files behind the current figures ({meta.sources.ttm_input_files.length + meta.sources.annual_files.length})</summary>
          <table className="table compact mono">
            <thead><tr><th>File</th><th>Census listing time</th><th>Downloaded</th><th>SHA-256</th></tr></thead>
            <tbody>
              {[...meta.sources.ttm_input_files, ...meta.sources.annual_files].map((f) => (
                <tr key={f.file}><td><a href={f.url} target="_blank" rel="noreferrer">{f.file}</a></td><td>{f.listing_last_modified}</td><td>{f.downloaded_at.slice(0, 10)}</td><td title={f.sha256}>{f.sha256.slice(0, 12)}…</td></tr>
              ))}
            </tbody>
          </table>
        </details>
        {meta.sources.notices.length > 0 && (
          <details>
            <summary>Census file notices ({meta.sources.notices.length})</summary>
            <ul>{meta.sources.notices.map((n) => <li key={n.file}><a href={n.url} target="_blank" rel="noreferrer">{n.file}</a>: {n.text}</li>)}</ul>
          </details>
        )}
        {c.legacy_codes.length > 0 && (
          <details>
            <summary>Historical county codes without current boundaries ({c.legacy_codes.length})</summary>
            <p className="small">These codes appear only in older files, for example Connecticut's former counties (replaced by planning regions from 2023 data) and Valdez-Cordova, AK (split in 2019). Their history is not reallocated to current geographies.</p>
            <ul className="small">{c.legacy_codes.map((l) => <li key={l.geoid}>{l.geoid} {l.name} ({l.first}–{l.last})</li>)}</ul>
          </details>
        )}

        <h3 id="m-validation">Automated validation ({meta.validation.counts.pass} passed, {meta.validation.counts.warn} warnings, {meta.validation.counts.fail} failed)</h3>
        <table className="table compact">
          <tbody>
            {meta.validation.checks.map((ch) => (
              <tr key={ch.id}><td><span className={`chip tone-${ch.status === 'pass' ? 'ok' : ch.status === 'warn' ? 'warn' : 'na'}`}>{ch.status}</span></td><th>{ch.title}</th><td className="small">{ch.detail}</td></tr>
            ))}
          </tbody>
        </table>

        <h3>Release history</h3>
        <table className="table compact">
          <thead><tr><th>Version</th><th>Data through</th><th>Published</th><th>Notes</th></tr></thead>
          <tbody>
            {meta.releases.map((r) => <tr key={r.version}><td className="mono">{r.version}</td><td>{monthLabel(r.data_through)}</td><td>{dateLabel(r.created_at)}</td><td>{r.summary}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
