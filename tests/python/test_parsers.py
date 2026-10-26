"""Parser and schema tests on synthetic fixtures (see fixtures/README.md)."""
from pathlib import Path

import numpy as np
import pytest

from bpsdash import permits, population
from bpsdash.permits import SchemaError

FIX = Path(__file__).parent / "fixtures"
COUNTY = (FIX / "synthetic_county_ytd.txt").read_bytes()


def test_county_file_parses_units_not_buildings():
    df = permits.parse(COUNTY, "county", "2026-08", "fixture").set_index("geoid")
    assert list(df.index) == ["01001", "01003", "35000"]
    assert df.loc["01001", "name"] == "Synthetic County A"  # padding stripped
    t = permits.totals(df.reset_index())
    t.index = df.index
    # 5+ units: 2 buildings but 100 housing units -> units are what we count
    assert df.loc["01001", "u5_bldgs"] == 2 and df.loc["01001", "u5_units"] == 100
    assert t.loc["01001", "total"] == 10 + 2 + 4 + 100
    assert t.loc["01001", "mf"] == 2 + 4 + 100
    assert t.loc["01003", "total"] == 0  # genuine reported zero stays zero


def test_reported_only_columns_are_separate():
    df = permits.parse(COUNTY, "county", "2026-08", "fixture")
    rep = permits.totals(df, rep=True)
    assert rep.iloc[0]["total"] == 8 + 2 + 0 + 100


@pytest.mark.parametrize("mutate,msg", [
    (lambda s: s.replace("5+ units,,,", "5 plus units,,,"), "header row 1"),
    (lambda s: s.replace("Name,Bldgs", "Name,Buildings"), "header row 2"),
    (lambda s: s.replace("202608,01,003", "202607,01,003"), "survey date"),
    (lambda s: s.replace(",0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0\n", ",0,0,0\n", 1), "fields"),
    (lambda s: s.replace(",10,10,1000000,", ",10,ten,1000000,"), "non-integer"),
    (lambda s: s.replace(",10,10,1000000,", ",10,-10,1000000,"), "negative"),
])
def test_schema_changes_are_rejected(mutate, msg):
    with pytest.raises(SchemaError, match=msg):
        permits.parse(mutate(COUNTY.decode()).encode(), "county", "2026-08", "fixture")


def test_blank_cells_are_missing_not_zero():
    text = COUNTY.decode().replace(",8,8,800000,1,2,200000,0,0,0,2,100,9000000", ",,,,,,,,,,,,")
    df = permits.parse(text.encode(), "county", "2026-08", "fixture")
    assert np.isnan(df.loc[0, "u1_rep_units"])
    assert df.loc[0, "u1_units"] == 10
    assert df.attrs["blank_cells"]["u1_rep_units"] == 1


def test_exact_duplicates_collapse_but_conflicts_fail():
    lines = COUNTY.decode().splitlines()
    dup = "\n".join(lines + [lines[3].replace("Synthetic County A", "Synthetic Alias A ")]) + "\n"
    df = permits.parse(dup.encode(), "county", "2026-08", "fixture")
    assert len(df) == 3 and df.attrs["collapsed_duplicates"] == ["01001"]
    conflict = "\n".join(lines + [lines[3].replace(",10,10,1000000,", ",11,11,1000000,")]) + "\n"
    with pytest.raises(SchemaError, match="conflicting duplicate"):
        permits.parse(conflict.encode(), "county", "2026-08", "fixture")


def test_state_annual_file_with_summary_rows():
    df = permits.parse((FIX / "synthetic_state_annual.txt").read_bytes(), "state", "2025", "fixture")
    assert set(df["state_fips"]) == {"US", "R3", "01"}


def test_population_parse_and_schema():
    pop = population.parse((FIX / "synthetic_pep.csv").read_bytes(), 2025, "fixture")
    assert sorted(pop["geoid"].unique()) == ["01001", "01003"]  # state row (SUMLEV 040) excluded
    p25 = pop[pop.year == 2025].set_index("geoid")["population"]
    assert p25["01001"] == 110
    with pytest.raises(population.PopulationSchemaError):
        population.parse((FIX / "synthetic_pep.csv").read_bytes(), 2026, "fixture")
