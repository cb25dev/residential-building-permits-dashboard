"""Central configuration: source locations, storage layout, and analytic thresholds.

Every threshold used to flag or filter counties lives here so it is documented in one
place and surfaced in the published metadata. Color-scale breaks are NOT configured
here: the dashboard derives them from the data at render time.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# --- Source locations -------------------------------------------------------------
SOURCE_AGENCY = "U.S. Census Bureau"
BPS_COUNTY_DIR = "https://www2.census.gov/econ/bps/County/"
BPS_STATE_DIR = "https://www2.census.gov/econ/bps/State/"
BPS_HOME = "https://www.census.gov/construction/bps/index.html"
BPS_METHODOLOGY = "https://www.census.gov/construction/bps/methodology.html"
BPS_SCHEDULE = "https://www.census.gov/construction/bps/schedule.html"
PEP_DATASETS_DIR = "https://www2.census.gov/programs-surveys/popest/datasets/"
PEP_HOME = "https://www.census.gov/programs-surveys/popest.html"

# Cartographic boundary vintage. Changing it is a deliberate, reviewed act (see
# docs/OPERATIONS.md): new county codes must also appear in the BPS files.
GEO_VINTAGE = 2025
GEO_BASE = f"https://www2.census.gov/geo/tiger/GENZ{GEO_VINTAGE}/shp/"
GEO_COUNTY_ZIP = f"cb_{GEO_VINTAGE}_us_county_5m.zip"
GEO_STATE_ZIP = f"cb_{GEO_VINTAGE}_us_state_5m.zip"
GEO_HOME = "https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html"

# 50 states + DC. Puerto Rico and the Island Areas are outside the BPS county files.
EXCLUDED_STATE_FIPS = {"60", "66", "69", "72", "78"}

# First calendar year of BPS county files ingested. Monthly county files begin 2000-01.
HISTORY_START_YEAR = 2000

# --- Storage layout ----------------------------------------------------------------
DATA = ROOT / "data"
RAW = DATA / "raw"
RAW_PERMITS_COUNTY = RAW / "permits" / "county"
RAW_PERMITS_STATE = RAW / "permits" / "state"
RAW_POPULATION = RAW / "population"
GEOGRAPHY = DATA / "geography"
PROCESSED = DATA / "processed"
RELEASES = DATA / "releases"
LOGS = DATA / "logs"
MANIFEST = RAW / "manifest.json"
STAGING = DATA / ".staging"
PARSE_CACHE = DATA / ".cache" / "parsed"  # parsed raw files keyed by SHA-256 (disposable)
WEB_DATA = ROOT / "public" / "data"

# --- Analytic thresholds (documented in docs/METHODOLOGY.md) -----------------------
# Prior-period units below which YoY growth is flagged "low baseline". The dashboard
# lets the user raise or lower the minimum interactively; this is the default.
LOW_BASELINE_UNITS = 50
# Population below which per-capita rates are flagged as volatile.
SMALL_POPULATION = 2_500
# Monthly-series December YTD vs final annual file: flag when the relative gap exceeds
# this share AND the absolute gap is at least DIVERGENCE_MIN_UNITS.
DIVERGENCE_SHARE = 0.15
DIVERGENCE_MIN_UNITS = 50
# Share of TTM units that are Census imputations rather than reported permits.
HIGH_IMPUTATION_SHARE = 0.50

# --- Validation tolerances -----------------------------------------------------------
# Month-over-month change in the number of counties present in a monthly file.
ROWCOUNT_TOLERANCE = 0.03
# County sums (including statewide "balance of state" offices) vs the official state
# and U.S. rows of the state files for the same month. Calibrated on 2022-01..2026-08:
# U.S. gaps never exceeded 0.69%; 99% of state-months were within 0.95%.
NATIONAL_RECON_TOLERANCE = 0.01   # exceeded -> validation failure
STATE_RECON_TOLERANCE = 0.03      # exceeded (and >= STATE_RECON_MIN_UNITS) -> warning
STATE_RECON_MIN_UNITS = 50
# A month's county files are "full coverage" when their U.S. sum is within this share
# of the official U.S. total. Pre-2022 county files cover monthly-sample offices only
# (about 69-72% of U.S. units) and fall outside it.
FULL_COVERAGE_BAND = 0.03

HTTP_USER_AGENT = "bpsdash/1.0 (+residential building permits dashboard pipeline)"
HTTP_TIMEOUT = 90
