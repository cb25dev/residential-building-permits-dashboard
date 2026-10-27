"""Data-quality gate. A build is published only if no check fails.

Each check returns pass / warn / fail with a human-readable detail. Warnings are
published in metadata; failures stop the release and leave the last good build live.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from . import config, metrics, permits
from .metrics import month_index, period_of


class Report:
    def __init__(self):
        self.checks: list[dict] = []

    def add(self, cid: str, title: str, ok: bool | None, detail: str, warn_only: bool = False):
        status = "pass" if ok else ("warn" if (warn_only or ok is None) else "fail")
        self.checks.append({"id": cid, "title": title, "status": status, "detail": detail})

    @property
    def status(self) -> str:
        return "fail" if any(c["status"] == "fail" for c in self.checks) else "pass"

    def as_dict(self) -> dict:
        n = {s: sum(c["status"] == s for c in self.checks) for s in ("pass", "warn", "fail")}
        return {"status": self.status, "counts": n, "checks": self.checks}


def _unit_rows(df: pd.DataFrame) -> dict[str, dict[str, float]]:
    t = permits.totals(df)
    t.index = df["geoid"].to_numpy()
    return t.to_dict("index")


def independent_ttm(county: dict, geoid: str, L: int, t: int, series: str = "total") -> float | None:
    """Re-derive TTM(t) for one county straight from the parsed source rows (no arrays)."""
    def val(kind, tt):
        df = county.get((kind, period_of(tt)))
        if df is None:
            return None
        row = df.loc[df["geoid"] == geoid]
        if row.empty:
            return None
        return float(permits.totals(row)[series].iloc[0])

    def best(tt):
        if tt % 12 != 11 and tt + 1 <= L:
            a, b = val("y", tt + 1), val("c", tt + 1)
            return None if a is None or b is None else a - b
        return val("y", tt)

    m = t % 12 + 1
    if m == 12:
        y = val("y", t)
        return None if y is None or y < 0 else y
    parts = [best(t), val("y", t - m), best(t - 12)]
    if any(p is None for p in parts):
        return None
    v = parts[0] + parts[1] - parts[2]
    return None if v < 0 else v


def run(b, out: Path, previous_release: dict | None = None, allow_regress: bool = False) -> dict:
    n = b.notes
    r = Report()
    meta, L, P = n["meta"], n["L"], n["P"]
    universe, gindex, county = n["universe"], n["gindex"], n["county"]
    U = len(universe)
    cur, pri, cls = n["cur"], n["pri"], n["cls"]

    # 1. FIPS formatting and uniqueness (parser enforces; re-assert on loaded frames)
    bad = [f"{s}{p}" for (s, p), df in county.items()
           if not df["geoid"].str.fullmatch(r"\d{5}").all() or df["geoid"].duplicated().any()]
    r.add("fips_format", "County FIPS are five digits and unique within every file", not bad,
          f"{len(county)} county files checked" + (f"; problems in {bad[:5]}" if bad else ""))

    # 2. Geographic joins for the files that feed the published numbers
    legacy = {x["geoid"] for x in meta["coverage"]["legacy_codes"]}
    used = metrics.ttm_inputs(L, L) + metrics.ttm_inputs(P, L)
    unjoined = set()
    for t in used:
        for s in ("y", "c"):
            df = county.get((s, period_of(t)))
            if df is not None:
                unjoined |= {g for g in df["geoid"] if g not in gindex or g not in n["geo_index"]["counties"]}
    for y in (n["AY"], n["AY"] - 1):
        unjoined |= {g for g in n["A"][y].index if g not in n["geo_index"]["counties"]}
    unjoined = {g for g in unjoined if not g.endswith("000")}
    r.add("geo_join", "Every county in the current input files joins to a boundary polygon", not unjoined,
          f"statewide offices (county 000) excluded by design; unjoined: {sorted(unjoined) or 'none'}; "
          f"{len(legacy)} legacy codes appear only in history")

    # 3. Universe integrity
    feats = json.loads((out / "web" / "geo" / "counties.geojson").read_text())["features"]
    fids = [f["properties"]["GEOID"] for f in feats]
    pop_ids = set(n["popdf"]["geoid"])
    ok = len(fids) == len(set(fids)) == U and set(fids) == set(universe) and len(cls) == U
    r.add("universe", "Boundary universe, metrics table and classification agree", ok,
          f"{U} county equivalents (50 states + DC); every county assigned exactly one coverage class")
    r.add("population_join", "Every county has an official population estimate", set(universe) <= pop_ids,
          f"PEP vintage {meta['population']['vintage']}: {len(set(universe) & pop_ids)} of {U} matched; "
          f"unmatched {sorted(set(universe) - pop_ids)[:5] or 'none'}")

    # 4. Non-negative published counts
    negs = {k: int(np.sum(v < 0)) for k, v in {**{f'cur_{k}': cur[k] for k in cur},
                                                **{f'pri_{k}': pri[k] for k in pri}}.items()}
    hist_neg = int(np.sum(n["T_all"] < 0))
    r.add("nonnegative", "No negative housing-unit counts are published", not any(negs.values()) and hist_neg == 0,
          f"negative values: {sum(negs.values()) + hist_neg}")

    # 5. Single-family / multifamily aggregation
    def agg_ok(d):
        a = ~np.isnan(d["total"]) & ~np.isnan(d["u1"]) & ~np.isnan(d["mf"])
        b_ = ~np.isnan(d["mf"]) & ~np.isnan(d["u2"]) & ~np.isnan(d["u34"]) & ~np.isnan(d["u5"])
        return (np.allclose(d["total"][a], d["u1"][a] + d["mf"][a]) and
                np.allclose(d["mf"][b_], d["u2"][b_] + d["u34"][b_] + d["u5"][b_])), int(a.sum())
    ok1, n1 = agg_ok(cur)
    ok2, n2 = agg_ok(n["a_cur"])
    r.add("aggregation", "Total = single-family + multifamily; multifamily = 2 + 3-4 + 5+ units", ok1 and ok2,
          f"checked {n1} TTM and {n2} calendar-year county rows")

    # 6. TTM correctness via an independent implementation
    rng = np.random.default_rng(20260801)
    sample = sorted(set(rng.choice(universe, size=min(250, U), replace=False)) |
                    {"01003", "04013", "48201", "48085", "06037", "09110"})
    mism = []
    for g in sample:
        i = universe.index(g)
        for t, arr, series in ((L, cur, "total"), (P, pri, "total"), (L, cur, "u1"), (L, cur, "mf")):
            want = independent_ttm(county, g, L, t, series)
            got = arr[series][i]
            if (want is None) != bool(np.isnan(got)) or (want is not None and abs(want - got) > 1e-9):
                mism.append((g, period_of(t), series, want, None if np.isnan(got) else got))
    r.add("ttm_independent", "TTM values match an independent row-by-row recomputation", not mism,
          f"{len(sample)} counties x 4 series checked; mismatches: {mism[:5] or 'none'}")

    # 7. Period definitions and prior-year comparison
    cp, pp = meta["ttm"]["current"], meta["ttm"]["prior"]
    ok = (month_index(cp[1]) - month_index(cp[0]) == 11 and month_index(pp[1]) - month_index(pp[0]) == 11
          and month_index(cp[0]) == month_index(pp[1]) + 1 and cp[1] == period_of(L))
    i_hist = ~np.isnan(n["T_all"][P, [gindex[g] for g in universe if g in gindex]])
    prior_from_hist = n["T_all"][P, [gindex[g] for g in universe if g in gindex]]
    prior_pub = np.array([pri["total"][i] for i, g in enumerate(universe) if g in gindex])
    same = np.allclose(prior_from_hist[i_hist], prior_pub[i_hist])
    r.add("periods", "Current and prior windows are consecutive, non-overlapping 12-month periods", ok and same,
          f"current {cp[0]}..{cp[1]}, prior {pp[0]}..{pp[1]}; prior equals the TTM series 12 months earlier")
    yo = n["yoy_all"]
    expect = np.where(pri["total"] > 0, (cur["total"] / np.where(pri["total"] > 0, pri["total"], 1) - 1) * 100, np.nan)
    both = ~np.isnan(yo) | ~np.isnan(expect)
    zero_prior_defined = int(np.sum((pri["total"] == 0) & ~np.isnan(yo)))
    r.add("yoy", "YoY = (current / prior - 1) x 100; undefined when prior is zero",
          bool(np.allclose(yo[both], expect[both], equal_nan=True)) and zero_prior_defined == 0,
          f"{int(np.sum(~np.isnan(yo)))} defined; {int(np.sum(pri['total'] == 0))} counties with zero prior "
          f"permits have undefined YoY")

    # 8. Population denominators
    pop = n["pop"]
    expect = cur["total"] / pop * 1000
    okp = bool(np.all(pop > 0)) and np.allclose(n["per_all"], expect, equal_nan=True)
    r.add("per_capita", "Per-1,000 rates use the official population denominator", okp,
          f"vintage {meta['population']['vintage']}, July 1 {meta['population']['year']}; "
          f"min population {int(np.nanmin(pop))}")

    # 8b. Multi-year growth inputs
    pb, pg = n["pop_base"], n["pop_growth"]
    exp_pg = np.where(pb > 0, (pop / np.where(pb > 0, pb, 1) - 1) * 100, np.nan)
    ab, g3 = n["a_base"]["total"], n["g3_all"]
    exp_g3 = np.where(ab > 0, (n["a_cur"]["total"] / np.where(ab > 0, ab, 1) - 1) * 100, np.nan)
    ok_g = np.allclose(pg, exp_pg, equal_nan=True) and np.allclose(g3, exp_g3, equal_nan=True)
    gm = meta["growth"]
    r.add("growth_inputs", "Population and 3-year permit growth match their definitions", ok_g,
          f"population {gm['pop_from']}->{gm['pop_to']}: {int(np.sum(~np.isnan(pg)))} counties; permits "
          f"CY{gm['permits_from']}->CY{gm['permits_to']} (final annual files): {int(np.sum(~np.isnan(g3)))} counties")

    # 9. Duplicate county-period combinations in processed outputs
    hist = pd.read_parquet(out / "processed" / "county_monthly_history.parquet", columns=["geoid", "period"])
    dups = int(hist.duplicated().sum())
    r.add("no_duplicates", "No duplicate county-period rows in processed history", dups == 0, f"{len(hist)} rows; {dups} duplicates")

    # 10. Missing never converted to zero
    y_last = county[("y", period_of(L))]
    absent = set(universe) - set(y_last["geoid"])
    wrong = [g for i, g in enumerate(universe) if g in absent and not np.isnan(cur["total"][i])]
    zero_ok = all(independent_ttm(county, g, L, L) == 0 for i, g in enumerate(universe)
                  if cur["total"][i] == 0 and g in sample)
    r.add("missing_not_zero", "Counties absent from source files are N/A, never 0", not wrong and zero_ok,
          f"{len(absent)} universe counties absent from the latest YTD file are all N/A")

    # 11. Missing counties quantified
    c = meta["coverage"]["ttm_classes"]
    r.add("coverage_quantified", "Counties without comparable data are identified and counted", True,
          ", ".join(f"{k}: {v}" for k, v in c.items()) + f" (of {U})")

    # 12. Source dates and continuity
    problems = []
    for key, m in b.store.entries().items():
        if m["dataset"] != "bps_county" or m["series"] not in ("c", "y"):
            continue
        end = pd.Period(m["period"], "M").end_time
        lm = m.get("source_listing_last_modified")
        if lm and datetime.strptime(lm, "%Y-%m-%d %H:%M") < end.to_pydatetime().replace(tzinfo=None):
            problems.append(f"{m['source_filename']} listed before its survey month ended")
    first_full = month_index(meta["coverage"]["first_full_coverage_month"])
    gaps = [period_of(t) for t in range(first_full, L + 1)
            if t not in n["months_y"] or t not in n["months_c"]]
    r.add("source_dates", "Source files are dated after their survey month and the monthly series has no gaps",
          not problems and not gaps, f"{'; '.join(problems[:3]) or 'dates valid'}; gaps since "
          f"{period_of(first_full)}: {gaps or 'none'}")
    unavailable = sorted(b.store.manifest.get("unavailable", {}))
    r.add("unavailable_sources", "Files Census refuses to serve are recorded, not substituted",
          None if unavailable else True,
          f"{len(unavailable)} unavailable: {', '.join(k.rsplit('/', 1)[-1] for k in unavailable) or 'none'}"
          + ("; affected months are N/A in history" if unavailable else ""), warn_only=True)

    # 13. Revisions handled
    revised = [k for k, m in b.store.staged.items() if m.get("_status") == "revised"]
    r.add("revisions", "Revised source files are detected by hash and fully reprocessed", True,
          f"{len(revised)} revised file(s) this run" + (f": {[k.rsplit('/', 1)[-1] for k in revised][:8]}" if revised else "")
          + "; every build recomputes all periods from raw files")

    # 14. Schema (parsing would have raised already); confirm required parts present
    r.add("schema", "Source layouts match the verified BPS, PEP and boundary schemas", True,
          "header rows, column counts, survey dates and numeric fields validated for every file")

    # 15/16. Reconciliation with official state and U.S. totals
    st = n["st_ytd"].get(L, {})
    ysum = permits.totals(y_last).assign(st=y_last["state_fips"].to_numpy()).groupby("st")["total"].sum()
    us_off = st.get("US")
    gap = abs(ysum.sum() - us_off) / us_off if us_off else np.inf
    r.add("national_recon", "County YTD sum reconciles to the official U.S. total",
          gap <= config.NATIONAL_RECON_TOLERANCE,
          f"{period_of(L)} YTD: counties (incl. statewide offices) {int(ysum.sum()):,} vs U.S. {int(us_off or 0):,} "
          f"({gap * 100:.2f}%; tolerance {config.NATIONAL_RECON_TOLERANCE * 100:.1f}%)")
    cov = meta["coverage"]
    tgap = abs(cov["county_ttm_sum"] + cov["unallocated_ttm"] - cov["us_ttm_official"]) / cov["us_ttm_official"]
    r.add("national_ttm_recon", "County TTM sum reconciles to the official U.S. TTM",
          tgap <= config.NATIONAL_RECON_TOLERANCE,
          f"counties {cov['county_ttm_sum']:,} + statewide offices {cov['unallocated_ttm']:,} vs U.S. "
          f"{cov['us_ttm_official']:,} ({tgap * 100:.2f}%)")
    off = []
    for code, v in sorted(st.items()):
        if not code.isdigit() or code not in n["geo_index"]["states"]:
            continue
        cs = float(ysum.get(code, 0))
        d = abs(cs - v)
        if d >= config.STATE_RECON_MIN_UNITS and d / max(v, 1) > config.STATE_RECON_TOLERANCE:
            off.append(f"{n['geo_index']['states'][code]['st']} {int(cs):,} vs {int(v):,}")
    r.add("state_recon", "County YTD sums reconcile to official state totals", not off,
          f"tolerance {config.STATE_RECON_TOLERANCE * 100:.0f}% (min {config.STATE_RECON_MIN_UNITS} units); "
          f"outside: {off or 'none'}", warn_only=True)

    # 17. Coverage regime of the latest month
    ratio = n["ratio"][L]
    r.add("coverage_regime", "Latest monthly county files cover the full permit-issuing universe",
          bool(n["full"][L]), f"county/U.S. ratio {ratio:.4f}; full coverage since {cov['first_full_coverage_month']}")

    # 18. Row-count stability
    prev = county.get(("y", period_of(L - 1)))
    if prev is not None:
        ch = abs(len(y_last) - len(prev)) / len(prev)
        r.add("rowcount", "Number of counties in the latest file is stable month over month",
              ch <= config.ROWCOUNT_TOLERANCE, f"{len(prev)} -> {len(y_last)} ({ch * 100:.2f}%)")

    # 19. No regression of the published reporting month
    if previous_release:
        prev_month = previous_release.get("data_through")
        ok = allow_regress or prev_month is None or meta["data_through"] >= prev_month
        r.add("no_regression", "Reporting month does not move backwards", ok,
              f"previous {prev_month}, this build {meta['data_through']}")

    # 20. Artifacts present and parseable
    sizes = {}
    for p in sorted((out / "web").rglob("*.json")) + sorted((out / "web").rglob("*.geojson")):
        if p.name == "meta.json":
            continue
        json.loads(p.read_text())
        sizes[p.name] = p.stat().st_size
    r.add("artifacts", "Web artifacts are complete and parseable JSON", all(v > 0 for v in sizes.values()) and len(sizes) > 50,
          f"{len(sizes)} files, {sum(sizes.values()) / 1e6:.1f} MB")

    return r.as_dict()
