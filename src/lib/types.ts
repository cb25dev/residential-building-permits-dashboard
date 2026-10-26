// Shapes of the artifacts written by the Python pipeline (scripts/bpsdash/build.py).

export type View = 'ttm' | 'annual';
export type Metric = 'abs' | 'yoy' | 'per';
export type Units = 'all' | 'sf';
export type AbsScale = 'log' | 'quantile';

export type TtmClass = 'complete' | 'current_only' | 'incomplete' | 'annual_only' | 'not_in_bps';
export type Flag =
  | 'low_baseline'
  | 'low_baseline_sf'
  | 'no_prior_permits'
  | 'high_imputation'
  | 'revision_inconsistency'
  | 'revision_adjustment'
  | 'monthly_annual_divergence'
  | 'small_population';

/** [national rank, national n, state rank, state n]; rank 0 = not ranked. */
export type RankTuple = [number, number, number, number];
type Num = number | null;

export interface ViewColumns {
  cls: TtmClass[];
  cur_total: Num[]; cur_u1: Num[]; cur_u2: Num[]; cur_u34: Num[]; cur_u5: Num[]; cur_mf: Num[];
  pri_total: Num[]; pri_u1: Num[]; pri_mf: Num[];
  yoy_all: Num[]; yoy_sf: Num[]; per_all: Num[]; per_sf: Num[];
  imputed?: Num[];
  flags: Flag[][];
  rk_abs_all: RankTuple[]; rk_abs_sf: RankTuple[]; rk_per_all: RankTuple[]; rk_per_sf: RankTuple[];
  rk_yoy_all: RankTuple[]; rk_yoy_sf: RankTuple[];
  pop: Num[];
}

export interface MetricsFile {
  geoid: string[];
  ttm: ViewColumns;
  annual: ViewColumns;
  recon: { dec_ytd: Num[]; annual: Num[] };
}

export interface ViewRow {
  cls: TtmClass;
  cur: { total: Num; u1: Num; u2: Num; u34: Num; u5: Num; mf: Num };
  pri: { total: Num; u1: Num; mf: Num };
  yoy: { all: Num; sf: Num };
  per: { all: Num; sf: Num };
  imputed: Num;
  flags: Flag[];
  rank: Record<'abs_all' | 'abs_sf' | 'per_all' | 'per_sf' | 'yoy_all' | 'yoy_sf', RankTuple>;
  pop: Num;
}

export interface County {
  idx: number;
  geoid: string;
  name: string;
  short: string;
  st: string;
  state: string;
  statefp: string;
  bbox: [number, number, number, number];
  ttm: ViewRow;
  annual: ViewRow;
  recon: { decYtd: Num; annual: Num };
}

export interface GeoIndex {
  vintage: number;
  bbox: [number, number, number, number];
  projection: string;
  counties: Record<string, { name: string; short: string; st: string; state: string; statefp: string; lsad: string; bbox: [number, number, number, number] }>;
  states: Record<string, { name: string; st: string; bbox: [number, number, number, number] }>;
}

export interface SourceFile {
  file: string; url: string; sha256: string; listing_last_modified: string; downloaded_at: string;
}

export interface ValidationCheck { id: string; title: string; status: 'pass' | 'warn' | 'fail'; detail: string }

export interface Meta {
  version: string;
  processing_version: string;
  data_through: string;
  latest_month_preliminary: boolean;
  last_successful_update: string | null;
  ttm: { current: [string, string]; prior: [string, string] };
  annual: { year: number; prior_year: number };
  population: { vintage: number; year: number; annual_view_year: number; estimates_base: string; source: SourceFile; prior_vintages: number[] };
  geography: { vintage: number; universe: number; states: number; county_file: SourceFile; state_file: SourceFile; projection: string };
  coverage: {
    ttm_classes: Record<TtmClass, number>;
    annual_classes: Record<'complete' | 'current_only' | 'not_in_bps', number>;
    ttm_complete_pct: number;
    counties_with_current_ttm: number;
    first_full_coverage_month: string;
    monthly_coverage_ratio: Record<string, number | null>;
    us_ttm_official: number; us_ttm_prior_official: number; us_ttm_yoy_official: number;
    county_ttm_sum: number; unallocated_ttm: number; divergent_counties: number;
    statewide_offices: { statefp: string; state: string; name: string; ttm_units: number | null; annual_units: number | null }[];
    legacy_codes: { geoid: string; name: string; first: string; last: string }[];
  };
  thresholds: { low_baseline_units: number; small_population: number; divergence_share: number; divergence_min_units: number; high_imputation_share: number };
  history: { start: string; months: number; month_full: boolean[]; ttm_full: boolean[]; annual_start: number; annual_years: number };
  sources: {
    agency: string; bps_home: string; bps_county_dir: string; bps_methodology: string; bps_schedule: string;
    pep_home: string; geo_home: string;
    ttm_input_files: SourceFile[]; annual_files: SourceFile[];
    notices: { file: string; url: string; text: string }[];
  };
  warnings: string[];
  validation: { status: 'pass' | 'fail'; counts: Record<'pass' | 'warn' | 'fail', number>; checks: ValidationCheck[] };
  release: { version: string; created_at: string; summary: string } | null;
  releases: { version: string; data_through: string; created_at: string; population_vintage: number; summary: string }[];
}

export interface CountyHistory {
  m_sf?: Num[]; m_mf?: Num[]; t_all?: Num[]; t_sf?: Num[]; y_all?: Num[]; y_sf?: Num[];
  a_sf: Num[]; a_mf: Num[];
}
