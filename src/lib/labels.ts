import type { Flag, Metric, TtmClass, Units, View } from './types';

export const METRIC_LABEL: Record<Metric, string> = {
  abs: 'Absolute Permits',
  yoy: 'YoY Growth',
  per: 'Permits / 1,000 Residents',
};

export function metricTitle(metric: Metric, units: Units, view: View): string {
  const u = units === 'sf' ? 'single-family units' : 'housing units';
  const per = view === 'ttm' ? 'trailing 12 months' : 'calendar year';
  if (metric === 'abs') return `Residential ${u} authorized, ${per}`;
  if (metric === 'yoy') return `Change in ${u} authorized vs prior ${view === 'ttm' ? '12 months' : 'year'}`;
  return `${units === 'sf' ? 'Single-family units' : 'Housing units'} authorized per 1,000 residents, ${per}`;
}

export const CLASS_LABEL: Record<TtmClass, { short: string; long: string; tone: 'ok' | 'warn' | 'na' }> = {
  complete: { short: 'Complete', long: 'Valid current and prior periods', tone: 'ok' },
  current_only: { short: 'Current only', long: 'Current period valid; prior period unavailable, so growth is N/A', tone: 'warn' },
  incomplete: {
    short: 'Incomplete',
    long: 'County appears in the monthly files but a required input is missing or a Census revision made the period total inconsistent',
    tone: 'na',
  },
  annual_only: {
    short: 'Annual only',
    long: 'Reported only in the final annual file, not the monthly series; see the calendar-year view',
    tone: 'na',
  },
  not_in_bps: {
    short: 'No BPS data',
    long: 'No permit-issuing jurisdiction for this county appears in the Census county files (not the same as zero permits)',
    tone: 'na',
  },
};

export const FLAG_LABEL: Record<Flag, { label: string; detail: string }> = {
  low_baseline: { label: 'Low baseline', detail: 'Prior period had fewer than the minimum units; percentage changes are volatile.' },
  low_baseline_sf: { label: 'Low single-family baseline', detail: 'Prior-period single-family units are below the minimum.' },
  no_prior_permits: { label: 'No prior permits', detail: 'Zero units in the prior period, so growth is undefined (not infinite).' },
  high_imputation: { label: 'Mostly imputed', detail: 'More than half of the units are Census imputations for offices that did not report monthly.' },
  revision_inconsistency: { label: 'Revision inconsistency', detail: 'Later Census corrections made the period total negative; shown as N/A.' },
  revision_adjustment: {
    label: 'Revision adjustment',
    detail: 'Census corrections moved units between structure types in a later release; affected type detail is N/A, totals are unaffected.',
  },
  monthly_annual_divergence: {
    label: 'Monthly ≠ annual',
    detail: 'The monthly series differed from the final annual count by more than 15% (and 50+ units) in the latest complete year.',
  },
  small_population: { label: 'Small population', detail: 'Fewer than 2,500 residents; per-capita rates are volatile.' },
};

export const SHOWN_FLAGS: Flag[] = [
  'low_baseline', 'no_prior_permits', 'high_imputation', 'monthly_annual_divergence', 'revision_adjustment',
  'revision_inconsistency', 'small_population',
];
