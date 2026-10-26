"""Census Population Estimates Program (PEP) county totals, e.g. co-est2025-alldata.csv."""
from __future__ import annotations

import io

import pandas as pd


class PopulationSchemaError(ValueError):
    pass


REQUIRED = ["SUMLEV", "STATE", "COUNTY", "STNAME", "CTYNAME"]


def parse(content: bytes, vintage: int, source: str) -> pd.DataFrame:
    """County rows (SUMLEV 050) in long form: geoid, year, population (July 1 estimates)."""
    df = pd.read_csv(io.BytesIO(content), dtype=str, encoding="latin-1")
    missing = [c for c in REQUIRED + [f"POPESTIMATE{vintage}"] if c not in df.columns]
    if missing:
        raise PopulationSchemaError(f"{source}: missing columns {missing}")
    df = df[df["SUMLEV"] == "050"].copy()
    if df.empty:
        raise PopulationSchemaError(f"{source}: no county (SUMLEV 050) rows")
    df["geoid"] = df["STATE"].str.zfill(2) + df["COUNTY"].str.zfill(3)
    if df["geoid"].duplicated().any():
        raise PopulationSchemaError(f"{source}: duplicate county GEOIDs")
    years = sorted(int(c[len("POPESTIMATE"):]) for c in df.columns
                   if c.startswith("POPESTIMATE") and c[len("POPESTIMATE"):].isdigit())
    long = df.melt(id_vars=["geoid", "CTYNAME", "STNAME"], value_vars=[f"POPESTIMATE{y}" for y in years],
                   var_name="col", value_name="population")
    long["year"] = long["col"].str[len("POPESTIMATE"):].astype(int)
    long["population"] = pd.to_numeric(long["population"], errors="raise").astype("int64")
    if (long["population"] < 0).any():
        raise PopulationSchemaError(f"{source}: negative population")
    long["vintage"] = vintage
    long["source"] = source
    return long[["geoid", "year", "population", "vintage", "source", "CTYNAME", "STNAME"]].rename(
        columns={"CTYNAME": "pep_name", "STNAME": "pep_state"}).sort_values(["geoid", "year"]).reset_index(drop=True)
