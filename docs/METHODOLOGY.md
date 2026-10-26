# Methodology and source findings

This document records what the official sources actually contain, the decisions made
because of it, and the exact calculations. Figures quoted are from dataset version
`2026-08.a711eff5` (data through August 2026, published 2026-10-25). The live dashboard
always shows current figures in its methodology panel.

## 1. Sources

| Data | Source | Files used |
|---|---|---|
| Housing units authorized | U.S. Census Bureau, Building Permits Survey (BPS) | `https://www2.census.gov/econ/bps/County/`: `coYYMMc.txt` (month), `coYYMMy.txt` (year to date), `coYYYYa.txt` (final annual), 2000-01 onward |
| Reconciliation totals | BPS state files | `https://www2.census.gov/econ/bps/State/`: `stYYMMc.txt`, `stYYMMy.txt`, `stYYYYa.txt` (state, region, division and U.S. rows) |
| Population | Census Population Estimates Program (PEP) | `popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv` (Vintage 2025, `POPESTIMATE2025` = July 1, 2025) |
| Boundaries | Census cartographic boundary files | `cb_2025_us_county_5m.zip`, `cb_2025_us_state_5m.zip` |

Census documentation consulted: [BPS methodology](https://www.census.gov/construction/bps/methodology.html),
[release schedule](https://www.census.gov/construction/bps/schedule.html),
[BPS home](https://www.census.gov/construction/bps/index.html).

## 2. Verified file layout and field mapping

Every county file from 2000-01 through 2026-08, and every annual file, has the same layout:

```
Survey,FIPS,FIPS,Region,Division,County,,1-unit,,,2-units,,,3-4 units,,,5+ units,,,1-unit rep,,,2-units rep,,,3-4 units rep,,, 5+units rep
Date,State,County,Code,Code,Name,Bldgs,Units,Value,Bldgs,Units,Value,...   (8 Bldgs/Units/Value triples)
[optional blank line]
202608,01,001,3,6,Autauga County            ,22,22,10009211,0,0,0,...
```

* Columns 7–18 are **Census estimates**: reported permits plus imputation for offices that did not report.
  Columns 19–30 ("rep") are **reported only**. The dashboard uses estimates; the
  reported-only columns give the imputed share shown per county.
* The dashboard uses only the **Units** columns: 1-unit (`u1`), 2-units (`u2`),
  3–4 units (`u34`) and 5+ units (`u5`). Buildings and valuation are kept in processed
  data but not used. A 100-unit building contributes 100.
* Single-family = `u1`. Multifamily = `u2 + u34 + u5`, so single-family + multifamily = total.
* State files have the same shape without the county column and include `US`, `R1–R4`
  and `D1–D9` summary rows. State annual files date rows `YYYY99`.

The parser rejects any change to the header rows, column count, survey date or numeric
format ([`scripts/bpsdash/permits.py`](../scripts/bpsdash/permits.py)), so a schema
change fails the refresh instead of being silently misread.

Data quirks found and handled:

| Finding | Handling |
|---|---|
| County code `000` rows: "New Mexico Balance of State" (2,752 units in 2025), Maine Unorganized Territory, and Michigan, Montana and Oregon Balance of State | Statewide permit offices that cannot be attributed to a county. They are excluded from county metrics, included in reconciliation, and disclosed in the dashboard |
| 2000–2015 files list a few counties twice under alternate names (e.g. "Anchorage Borough" and "Anchorage Municipality") | Collapsed only when all 24 numeric fields are identical (true in all 59 affected files); conflicting duplicates fail the file |
| 2000–2002 files leave the reported-only columns blank for some rows | Blank → missing (NaN), never zero |
| `co1504c.txt` (April 2015 monthly) is always answered with an HTML "Request Rejected" page | Recorded as *unavailable at source* in the manifest; retried once per run; April 2015 shows N/A in history |
| Census's firewall can answer HTTP 200 with an HTML error page | Every download is content-checked (data must not be HTML; zips must start with `PK`) |
| Connecticut moved to nine planning regions (09110–09190) starting with 2023 data; the December 2022 YTD file has no Connecticut rows | Matches the 2025 boundaries and PEP. Old county codes are listed as legacy history; nothing is reallocated |
| Former codes in older files (02261 Valdez-Cordova, 02270 Wade Hampton, 51515 Bedford city, …) | Listed as legacy codes; history is not reassigned to current geographies |

## 3. Monthly coverage: the critical finding

**Before January 2022, county monthly files covered only permit offices in the monthly
sample.** On average they summed to 71% of the official U.S. total (range 64–82%) and
included about 750 counties. From January 2022, the county sum matches the U.S. total to
within 0.7% in every month and about 3,020 counties appear. Census's methodology
confirms this: *"Beginning in January 2022, all aggregates include data on all places in
the current universe. Data on places not included in the monthly survey is imputed."*
For earlier years it states that *"for counties not fully covered by monthly reporters,
county totals will be incomplete."*

The pipeline does not hardcode the break date. For each month it computes
`county sum / official U.S. YTD`. A month is "full coverage" when that ratio is within ±3%;
otherwise its records are labeled **partial**. A trailing window counts as comparable only
if all of its input months are full coverage. Windows straddling the change are N/A.

**Can a comparable TTM be produced for every county? No.** For the current window:

| Status | Counties |
|---|---|
| Valid current and prior TTM | 3,013 (95.8% of 3,144) |
| In monthly files but not computable (missing input or revision inconsistency) | 4 |
| Only in the final annual file | 7 |
| In no Census county file (no permit-issuing jurisdiction reported) | 120 |

The 120 counties are missing data, not zero. Census states that over 99% of privately
owned residential buildings are built in permit-issuing places, but construction in
places without permitting is outside the survey. They are concentrated in Texas (31),
Kentucky (23), New Mexico (15; most of the state's permits are issued by its
balance-of-state office) and Montana (11).

## 4. Monthly series versus final annual files

The final annual file and the monthly series are separate estimates. For 2025, the
monthly series' December YTD differs from the annual count in 1,850 of 3,020 counties,
although national totals differ by only 0.3%. Extreme cases include Kings County, NY in
2023 (4,063 monthly vs 15,076 annual) and Norfolk, VA in 2024 (522 vs 6).

Decisions:

* The TTM view uses **only** monthly-series files. The calendar-year view uses **only** annual files.
* The comparison (monthly December YTD vs annual) is computed per county and flagged
  "Monthly ≠ annual" when the gap exceeds 15% and 50 units (108 counties for 2025). It is
  never blended into a value.
* Annual county files reconcile exactly to the U.S. annual total for every year since 2003.
  They form the complete long-run history (2000–2025) in each county's charts.

## 5. Trailing-12-month calculation

Census: *"Year-to-date data include any late reports received or corrections made to
reports from prior months in the year."* Each release revises the previous month in
roughly 310–490 counties, by up to 840 units in a single county. So the plain formula
`YTD(y,m) + YTD(y−1,Dec) − YTD(y−1,m)` puts late reports for month *m* of the prior year
into the wrong window. The pipeline uses the next release's cumulative instead:

```
B(y, m)   = YTD(y, m+1) − Month(y, m+1)     if release (y, m+1) exists and m < 12
          = YTD(y, m)                        otherwise (December, or the latest month)
TTM(y, m) = B(y, m) + YTD(y−1, Dec) − B(y−1, m)        (December: TTM = YTD(y, Dec))
```

With these definitions, the current window (Sep 2025–Aug 2026) and the prior window
(Sep 2024–Aug 2025) partition year 2025 exactly: a late report is counted once. The test
`test_late_report_is_counted_exactly_once` demonstrates the difference from the plain formula.

Rules:

* A county missing from any input file gives N/A. Missing is never zero.
* TTM is computed separately for the total, single-family, multifamily and each structure
  type. Census corrections sometimes move units between types in later releases. For
  example, Collin County, TX's 3–4-unit YTD fell from 38 to 14 in late 2025. A type whose
  slice turns negative is N/A (flag `revision_adjustment`); the total stays valid. A
  negative *total* makes the county N/A (`revision_inconsistency`).
* Annual totals are never used to manufacture monthly values.
* Hand-checked example, Baldwin County, AL (01003): current = 2,188 (co2608y) + 2,665
  (co2512y) − (2,034 − 274) (co2509y − co2509c) = **3,093**; prior = 1,760 + 3,883 −
  (3,155 − 364) = **2,852**; YoY = **+8.45%**. These values are asserted in
  `tests/python/test_pipeline_real_data.py`.

## 6. Growth and per-capita rates

* YoY % = (current / prior − 1) × 100. Prior = 0 gives undefined (N/A), never infinity.
* Low baseline: prior < 50 units (default; adjustable in the dashboard). These counties
  are grayed in the growth map and excluded from growth rankings.
* Per 1,000 residents = units / population × 1,000, using PEP Vintage 2025 July 1, 2025
  estimates for both views. Every one of the 3,144 counties has an estimate; nothing is
  interpolated. Counties under 2,500 residents are flagged.
* Rankings (national and within-state) are computed only among counties with comparable
  data: valid current values for counts and rates, and complete status plus the
  low-baseline rule for growth.

## 7. Color scales

All class breaks are computed from the counties currently shown (after filters) and
rounded to readable values:

* **Absolute permits** use a sequential blue ramp. **Log** classes are evenly spaced in log
  space between the 2nd and 99.5th percentile of counties with permits. **Quantile**
  classes each hold about 1/7 of those counties. Zero has its own class.
* **YoY growth** uses red (decline) → neutral gray → green (increase). The neutral band is
  the ±value holding the 10% of counties with the smallest absolute change (at least ±1%).
  Declines and increases are each split into terciles, and the outer classes are
  open-ended, so outliers such as +478% cannot stretch the scale. A color-vision-friendly
  option swaps green for blue.
* **Permits per 1,000** use a sequential violet ramp, lightness-matched to the blue ramp
  in OKLCH, with quantile classes.
* Missing states use distinct patterns: diagonal hatch for *no BPS county data*,
  anti-diagonal hatch for *N/A (not comparable)*, and dots for *below the minimum prior
  volume*.

## 8. Validation

Every build runs 23 checks ([`scripts/bpsdash/validate.py`](../scripts/bpsdash/validate.py)).
They include FIPS format and uniqueness; boundary and population joins; non-negative
counts; aggregation identities; an independent row-by-row recomputation of TTM for 256
counties; period contiguity; the YoY and per-capita formulas; duplicate county-periods;
missing-not-zero; source dates and gaps; unavailable files; schema; county sums vs the
official U.S. total (fail above 1%) and vs each state (warn above 3%); the coverage regime
of the latest month; row-count stability; and no regression of the reporting month.
Tolerances were calibrated on 2022–2026 files: U.S. gaps never exceeded 0.69%, and 99% of
state-months were within 0.95%.

## 9. Map projection

Counties are drawn in a composite equal-area layout: Albers (EPSG:5070) for the lower 48
and DC, Alaska Albers (EPSG:3338, scaled to 35%) and Hawaii Albers (ESRI:102007) as
insets. The planar coordinates are passed through the inverse spherical Mercator
transform, so MapLibre's Mercator renderer reproduces the equal-area layout exactly. The
map has no basemap tiles, so it needs no map token or third-party tile service.
