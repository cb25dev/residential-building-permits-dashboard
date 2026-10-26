"""Parser for Census Building Permits Survey county and state ASCII (comma-delimited) files.

Verified layout (identical from 2000-01 through 2026-08 and in every annual file):

    row 1  Survey,FIPS,FIPS,Region,Division,County,,1-unit,,,2-units,,,3-4 units,,,5+ units,,,
           1-unit rep,,,2-units rep,,,3-4 units rep,,, 5+units rep
    row 2  Date,State,County,Code,Code,Name, then (Bldgs,Units,Value) x 8
    [optional blank line]
    data   YYYYMM|YYYY, state FIPS, county FIPS, region, division, padded name, 24 integers

The first four (Bldgs, Units, Value) triples are Census estimates including imputation
for non-reporting permit offices; the four "rep" triples are reported-only values.
State files have the same shape without the county FIPS column. County files report
value in dollars; state files report value in thousands of dollars (not used here).
"""
from __future__ import annotations

import io

import pandas as pd

TYPES = ("u1", "u2", "u34", "u5")
NUMERIC = [f"{t}{r}_{m}" for r in ("", "_rep") for t in TYPES for m in ("bldgs", "units", "value")]
UNIT_COLS = [f"{t}_units" for t in TYPES]
REP_UNIT_COLS = [f"{t}_rep_units" for t in TYPES]

_ROW1_TOKENS = ["survey", "fips", "fips", "region", "division", "county", "1-unit", "2-units", "3-4units",
                "5+units", "1-unitrep", "2-unitsrep", "3-4unitsrep", "5+unitsrep"]
_ROW2_COUNTY = ["date", "state", "county", "code", "code", "name"] + ["bldgs", "units", "value"] * 8
_ROW1_STATE = ["survey", "fips", "region", "division", "state", "1-unit", "2-units", "3-4units",
               "5+units", "1-unitrep", "2-unitsrep", "3-4unitsrep", "5+unitsrep"]
_ROW2_STATE = ["date", "state", "code", "code", "name"] + ["bldgs", "units", "value"] * 8


class SchemaError(ValueError):
    """The file does not match the verified BPS layout."""


def _norm(cells: list[str]) -> list[str]:
    return [c.strip().lower().replace(" ", "") for c in cells]


def _split(line: str) -> list[str]:
    return line.split(",")


def parse(content: bytes, kind: str, expected_period: str, source: str) -> pd.DataFrame:
    """Parse one BPS file. ``expected_period`` is 'YYYY-MM' (monthly) or 'YYYY' (annual)."""
    text = content.decode("latin-1")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 3:
        raise SchemaError(f"{source}: fewer than 3 non-blank lines")
    r1 = [t for t in _norm(_split(lines[0])) if t]
    r2 = _norm(_split(lines[1]))
    exp1, exp2 = (_ROW1_TOKENS, _ROW2_COUNTY) if kind == "county" else (_ROW1_STATE, _ROW2_STATE)
    if r1 != exp1:
        raise SchemaError(f"{source}: header row 1 changed: {r1}")
    if r2 != exp2:
        raise SchemaError(f"{source}: header row 2 changed: {r2}")
    ncol = len(exp2)
    rows = [_split(ln) for ln in lines[2:]]
    bad = [i for i, r in enumerate(rows) if len(r) != ncol]
    if bad:
        raise SchemaError(f"{source}: {len(bad)} data row(s) without {ncol} fields (first at data row {bad[0] + 1})")

    lead = ["survey_date", "state_fips", "county_fips", "region", "division", "name"] if kind == "county" \
        else ["survey_date", "state_fips", "region", "division", "name"]
    df = pd.DataFrame(rows, columns=lead + NUMERIC)
    for c in lead:
        df[c] = df[c].str.strip()
    want = expected_period.replace("-", "")
    if kind == "state" and len(want) == 4:
        want += "99"  # state annual files date rows YYYY99
    if not (df["survey_date"] == want).all():
        found = sorted(df.loc[df["survey_date"] != want, "survey_date"].unique())[:5]
        raise SchemaError(f"{source}: survey date(s) {found} do not match file period {want}")
    # Blank numeric cells mean "not reported" (2000-2002 files leave the reported-only
    # columns blank for some offices). They become NaN, never zero.
    raw = df[NUMERIC].apply(lambda s: s.str.strip())
    blank = raw == ""
    if not (raw.apply(lambda s: s.str.fullmatch(r"-?\d+")) | blank).all().all():
        raise SchemaError(f"{source}: non-integer numeric field")
    nums = raw.mask(blank).apply(pd.to_numeric).astype("float64")
    if (nums < 0).any().any():
        raise SchemaError(f"{source}: negative value in a count or valuation field")
    df[NUMERIC] = nums
    df.attrs["blank_cells"] = {c: int(n) for c, n in blank.sum().items() if n}
    # State files also carry U.S. ("US"), region ("R1".."R4") and division ("D1".."D9") rows.
    code_pattern = r"\d{2}" if kind == "county" else r"\d{2}|US|R[1-4]|D[1-9]"
    if not df["state_fips"].str.fullmatch(code_pattern).all():
        raise SchemaError(f"{source}: malformed state code")
    if kind == "county":
        if not df["county_fips"].str.fullmatch(r"\d{3}").all():
            raise SchemaError(f"{source}: malformed county FIPS")
        df["geoid"] = df["state_fips"] + df["county_fips"]
        key = "geoid"
    else:
        key = "state_fips"
    # 2000-2015 files list a few Alaska boroughs twice under alternate names with
    # identical figures. Exact numeric duplicates are collapsed (and reported);
    # conflicting duplicates make the file ambiguous and are rejected.
    dupmask = df[key].duplicated(keep=False)
    collapsed: list[str] = []
    if dupmask.any():
        groups = df[dupmask].groupby(key)[NUMERIC].nunique()
        conflicting = groups[(groups > 1).any(axis=1)].index.tolist()
        if conflicting:
            raise SchemaError(f"{source}: conflicting duplicate rows for {key} {conflicting[:5]}")
        collapsed = sorted(df.loc[dupmask, key].unique())
        df = df.drop_duplicates(subset=[key], keep="first").reset_index(drop=True)
    df.insert(0, "source", source)
    df.insert(1, "period", expected_period)
    blanks = df.attrs.get("blank_cells", {})
    df = df.drop(columns=["survey_date"])
    df.attrs["collapsed_duplicates"] = collapsed
    df.attrs["blank_cells"] = blanks
    return df


def totals(df: pd.DataFrame, rep: bool = False) -> pd.DataFrame:
    """Unit totals by structure type with derived single-family/multifamily aggregates."""
    cols = REP_UNIT_COLS if rep else UNIT_COLS
    out = df[cols].copy()
    out.columns = list(TYPES)
    out["mf"] = out["u2"] + out["u34"] + out["u5"]
    out["total"] = out["u1"] + out["mf"]
    return out
