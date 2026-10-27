"""Build every processed and web artifact from the raw store (no network access).

The build is deterministic: identical raw inputs produce byte-identical outputs. It
writes into a staging directory; ``refresh`` promotes staging only after validation.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from . import PROCESSING_VERSION, config, geography, metrics, permits, population
from .metrics import month_index, period_of
from .sources import RawStore



@dataclass
class Build:
    store: RawStore
    warnings: list[str] = field(default_factory=list)
    notes: dict = field(default_factory=dict)


# --- Loading ------------------------------------------------------------------------
def _parse_cached(store: RawStore, key: str, meta: dict, kind: str, cache: Path | None) -> pd.DataFrame:
    """Parse a raw file, reusing a Parquet cache keyed by the file's SHA-256."""
    if cache is not None:
        stem = cache / f"{meta['sha256']}-{kind}-{meta['period']}"
        cp, side = stem.with_suffix(".parquet"), stem.with_suffix(".json")
        if cp.exists() and side.exists():
            df = pd.read_parquet(cp)
            df.attrs["collapsed_duplicates"] = json.loads(side.read_text())
            return df
    df = permits.parse(store.read(key), kind, meta["period"], key)
    if cache is not None:
        cache.mkdir(parents=True, exist_ok=True)
        dups = df.attrs.get("collapsed_duplicates", [])
        df.to_parquet(cp, index=False)
        side.write_text(json.dumps(dups))
        df.attrs["collapsed_duplicates"] = dups
    return df


def load_bps(b: Build, kind: str, cache: Path | None) -> dict[tuple[str, str], pd.DataFrame]:
    out = {}
    for key, meta in b.store.entries(f"bps_{kind}").items():
        if meta["series"] not in ("c", "y", "a"):
            continue
        df = _parse_cached(b.store, key, meta, kind, cache)
        dups = df.attrs.get("collapsed_duplicates") or []
        if dups:
            b.warnings.append(f"{meta['source_filename']}: collapsed exact duplicate rows for {', '.join(dups)}")
        out[(meta["series"], meta["period"])] = df
    return out


# --- Array assembly -----------------------------------------------------------------
def to_arrays(frames: dict, series: str, last: int, gindex: dict[str, int], cols: list[str]) -> dict[str, np.ndarray]:
    T, G = last + 1, len(gindex)
    arrs = {c: np.full((T, G), np.nan) for c in cols}
    for (s, period), df in frames.items():
        if s != series:
            continue
        t = month_index(period)
        if t < 0 or t > last:
            continue
        gi = df["geoid"].map(gindex).to_numpy()
        for c in cols:
            arrs[c][t, gi] = df[c].to_numpy(dtype=float)
    return arrs


def _round(x, nd=0):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    if nd == 0:
        return int(round(float(x)))
    return round(float(x), nd)


def _col(a: np.ndarray, nd=0) -> list:
    return [_round(v, nd) for v in a]


def inputs_digest(store: RawStore) -> str:
    h = hashlib.sha256()
    for key, meta in store.entries().items():
        h.update(f"{key}:{meta['sha256']}\n".encode())
    h.update(PROCESSING_VERSION.encode())
    return h.hexdigest()


def run(store: RawStore, out: Path, cache: Path | None = None, log=print) -> Build:
    b = Build(store)
    files = store.entries()

    # Geography -------------------------------------------------------------------
    geo_keys = {m["dataset"]: k for k, m in files.items() if m["dataset"] in ("cb_county", "cb_state")}
    if set(geo_keys) != {"cb_county", "cb_state"}:
        raise RuntimeError("Boundary files missing from raw store")
    geo = geography.build(store.path(geo_keys["cb_county"]), store.path(geo_keys["cb_state"]))
    gidx = geo["index"]
    universe = sorted(gidx["counties"])
    log(f"geography: {len(universe)} counties, {len(gidx['states'])} states")

    # Permits ---------------------------------------------------------------------
    county = load_bps(b, "county", cache)
    state = load_bps(b, "state", cache)
    months_c = {month_index(p) for s, p in county if s == "c"}
    months_y = {month_index(p) for s, p in county if s == "y"}
    st_months = {month_index(p) for s, p in state if s == "y"} & {month_index(p) for s, p in state if s == "c"}
    county_last = max(months_c & months_y)
    last = max(t for t in (months_c & months_y) if t in st_months)
    if last < county_last:
        b.warnings.append(f"County files for {period_of(county_last)} are published but the matching state files "
                          f"used for verification are not; holding at {period_of(last)}.")
    L = last
    log(f"latest verified-candidate month: {period_of(L)}")

    all_geoids = sorted(set().union(*[set(df["geoid"]) for (s, p), df in county.items()]))
    gindex = {g: i for i, g in enumerate(all_geoids)}
    Y = to_arrays(county, "y", L, gindex, permits.UNIT_COLS)
    C = to_arrays(county, "c", L, gindex, permits.UNIT_COLS)
    Yr = to_arrays(county, "y", L, gindex, permits.REP_UNIT_COLS)
    Cr = to_arrays(county, "c", L, gindex, permits.REP_UNIT_COLS)

    # National coverage ratio per month (county sum incl. statewide offices / U.S. row).
    us_y = np.full(L + 1, np.nan)
    us_c = np.full(L + 1, np.nan)
    st_ytd = {}
    for (s, p), df in state.items():
        t = month_index(p) if s in ("c", "y") else None
        if t is None or t < 0 or t > L:
            continue
        tot = permits.totals(df)["total"].to_numpy()
        codes = df["state_fips"].to_numpy()
        us = float(tot[codes == "US"][0])
        (us_y if s == "y" else us_c)[t] = us
        if s == "y":
            st_ytd[t] = dict(zip(codes, tot))
    county_sum_y = np.nansum(np.stack([Y[c] for c in permits.UNIT_COLS]).sum(axis=0), axis=1)
    present = ~np.all(np.isnan(Y["u1_units"]), axis=1)
    ratio = np.where(present & (us_y > 0), county_sum_y / us_y, np.nan)
    full = np.abs(ratio - 1) <= config.FULL_COVERAGE_BAND
    if not full[L]:
        raise RuntimeError(f"Latest month {period_of(L)} county files do not cover the U.S. total "
                           f"(ratio {ratio[L]:.3f}); coverage regime may have changed")
    first_full = int(np.argmax(full))
    ttm_full = metrics.ttm_full_coverage(full, L)
    ttm_mixed = np.zeros(L + 1, dtype=bool)
    for t in range(12, L + 1):
        ins = [full[i] for i in metrics.ttm_inputs(t, L)]
        ttm_mixed[t] = any(ins) and not all(ins)

    # TTM per series -----------------------------------------------------------------
    # Each published aggregate gets its own TTM. Census corrections sometimes move units
    # between structure types in later releases (e.g. Collin Co. TX 3-4 unit YTD fell
    # 38 -> 14 in late 2025), which can make one type's Sep-Dec slice negative while the
    # total is sound. Only the negative series is set to N/A (flag: revision_adjustment).
    def agg(arrs, cols):
        return sum(arrs[c] for c in cols)

    series_cols = {"total": permits.UNIT_COLS, "u1": ["u1_units"], "mf": ["u2_units", "u34_units", "u5_units"],
                   "u2": ["u2_units"], "u34": ["u34_units"], "u5": ["u5_units"]}
    ttm, negs = {}, {}
    for name, cols in series_cols.items():
        v, neg = metrics.ttm(agg(Y, cols), agg(C, cols), L)
        v[ttm_mixed] = np.nan  # windows straddling the 2022 coverage change are not comparable
        ttm[name], negs[name] = v, neg
    neg_total = negs["total"]
    neg_detail = negs["u1"] | negs["mf"] | negs["u2"] | negs["u34"] | negs["u5"]
    ttm_rep_total = metrics.ttm(agg(Yr, permits.REP_UNIT_COLS), agg(Cr, permits.REP_UNIT_COLS), L)[0]
    T_sf, T_mf, T_all = ttm["u1"], ttm["mf"], ttm["total"]

    def yoy_regime(series):
        y = metrics.yoy_series(series)
        for t in range(12, L + 1):
            if ttm_full[t] != ttm_full[t - 12]:
                y[t] = np.nan
        return y

    Y_all, Y_sf = yoy_regime(T_all), yoy_regime(T_sf)

    # Annual files ------------------------------------------------------------------
    ann = {int(p): df for (s, p), df in county.items() if s == "a"}
    AY = max(ann)
    if AY - 1 not in ann:
        raise RuntimeError(f"Annual file for {AY - 1} missing")
    years = list(range(config.HISTORY_START_YEAR, AY + 1))

    def annual_frame(year):
        df = ann.get(year)
        if df is None:
            return pd.DataFrame(columns=["u1", "u2", "u34", "u5", "mf", "total"])
        return permits.totals(df).set_index(df["geoid"])

    A = {y: annual_frame(y) for y in years}

    # Population ----------------------------------------------------------------------
    pops = {}
    for key, meta in store.entries("pep_county").items():
        v = int(meta["period"])
        pops[v] = population.parse(store.read(key), v, key)
    V = max(pops)
    popdf = pops[V]
    pop_year = int(popdf["year"].max())
    pop_by_year = popdf.pivot(index="geoid", columns="year", values="population")
    pop_ay_year = AY if AY in pop_by_year.columns else pop_year
    log(f"population: vintage {V}, TTM denominator July 1 {pop_year}, CY{AY} denominator July 1 {pop_ay_year}")

    # --- Current TTM table (universe) ---------------------------------------------
    U = len(universe)
    ui = np.array([gindex.get(g, -1) for g in universe])
    has = ui >= 0

    def at(arr, t):
        out = np.full(U, np.nan)
        out[has] = arr[t, ui[has]]
        return out

    P = L - 12
    cur = {k: at(ttm[k], L) for k in series_cols}
    pri = {k: at(ttm[k], P) for k in series_cols}
    rep_cur = at(ttm_rep_total, L)
    neg_cur = at(neg_total.astype(float), L) > 0
    adj_cur = (at(neg_detail.astype(float), L) > 0) | (at(neg_detail.astype(float), P) > 0)
    pop = pop_by_year.reindex(universe)[pop_year].to_numpy(dtype=float)
    pop_ay = pop_by_year.reindex(universe)[pop_ay_year].to_numpy(dtype=float)

    in_inputs = np.zeros(U, dtype=bool)
    for t in metrics.ttm_inputs(L, L) + metrics.ttm_inputs(P, L):
        in_inputs |= ~np.isnan(at(Y["u1_units"], t)) | ~np.isnan(at(C["u1_units"], t))
    in_annual = np.array([g in A[AY].index for g in universe])
    cls = np.where(~np.isnan(cur["total"]) & ~np.isnan(pri["total"]), "complete",
          np.where(~np.isnan(cur["total"]), "current_only",
          np.where(in_inputs, "incomplete",
          np.where(in_annual, "annual_only", "not_in_bps"))))

    yoy_all = metrics.yoy_pct(cur["total"], pri["total"])
    yoy_sf = metrics.yoy_pct(cur["u1"], pri["u1"])
    per_all = metrics.per_1000(cur["total"], pop)
    per_sf = metrics.per_1000(cur["u1"], pop)
    with np.errstate(divide="ignore", invalid="ignore"):
        imputed = np.where(cur["total"] > 0, 1 - rep_cur / cur["total"], np.nan)

    # Monthly-series December YTD vs final annual for AY (comparability diagnostic).
    dec_ytd = at(sum(Y[c] for c in permits.UNIT_COLS), month_index(f"{AY}-12")) if month_index(f"{AY}-12") <= L \
        else np.full(U, np.nan)
    ann_tot = A[AY]["total"].reindex(universe).to_numpy(dtype=float)
    gap = dec_ytd - ann_tot
    with np.errstate(divide="ignore", invalid="ignore"):
        gap_share = np.where(ann_tot > 0, gap / ann_tot, np.where(dec_ytd > 0, np.inf, 0.0))
    divergent = (~np.isnan(gap)) & (np.abs(gap) >= config.DIVERGENCE_MIN_UNITS) & (np.abs(gap_share) > config.DIVERGENCE_SHARE)

    def flags_for(i: int, view: str) -> list[str]:
        f = []
        if view == "ttm":
            if cls[i] == "complete" and pri["total"][i] < config.LOW_BASELINE_UNITS:
                f.append("low_baseline")
            if cls[i] == "complete" and pri["total"][i] == 0:
                f.append("no_prior_permits")
            if cls[i] == "complete" and pri["u1"][i] < config.LOW_BASELINE_UNITS:
                f.append("low_baseline_sf")
            if not np.isnan(imputed[i]) and imputed[i] > config.HIGH_IMPUTATION_SHARE:
                f.append("high_imputation")
            if neg_cur[i]:
                f.append("revision_inconsistency")
            if adj_cur[i]:
                f.append("revision_adjustment")
        if divergent[i]:
            f.append("monthly_annual_divergence")
        if pop[i] < config.SMALL_POPULATION:
            f.append("small_population")
        return f

    statefp = np.array([gidx["counties"][g]["statefp"] for g in universe])

    def ranks(values, eligible):
        rn, nn = metrics.rank_desc(np.nan_to_num(values, nan=-np.inf), eligible & ~np.isnan(values))
        rs, ns = metrics.rank_desc(np.nan_to_num(values, nan=-np.inf), eligible & ~np.isnan(values), statefp)
        return rn, nn, rs, ns

    valid_cur = np.isin(cls, ["complete", "current_only"])
    comp = cls == "complete"
    rank_cols = {}
    for name, vals, elig in (
        ("abs_all", cur["total"], valid_cur), ("abs_sf", cur["u1"], valid_cur),
        ("per_all", per_all, valid_cur), ("per_sf", per_sf, valid_cur),
        ("yoy_all", yoy_all, comp & (pri["total"] >= config.LOW_BASELINE_UNITS)),
        ("yoy_sf", yoy_sf, comp & (pri["u1"] >= config.LOW_BASELINE_UNITS)),
    ):
        rank_cols[name] = ranks(vals, elig)

    # --- Calendar-year (final annual) table -----------------------------------------
    a_cur = {k: A[AY][k].reindex(universe).to_numpy(dtype=float) for k in ("u1", "u2", "u34", "u5", "mf", "total")}
    a_pri = {k: A[AY - 1][k].reindex(universe).to_numpy(dtype=float) for k in ("u1", "u2", "u34", "u5", "mf", "total")}
    acls = np.where(~np.isnan(a_cur["total"]) & ~np.isnan(a_pri["total"]), "complete",
           np.where(~np.isnan(a_cur["total"]), "current_only", "not_in_bps"))
    ayoy_all = metrics.yoy_pct(a_cur["total"], a_pri["total"])
    ayoy_sf = metrics.yoy_pct(a_cur["u1"], a_pri["u1"])
    aper_all = metrics.per_1000(a_cur["total"], pop_ay)
    aper_sf = metrics.per_1000(a_cur["u1"], pop_ay)
    avalid = np.isin(acls, ["complete", "current_only"])
    acomp = acls == "complete"
    arank_cols = {}
    for name, vals, elig in (
        ("abs_all", a_cur["total"], avalid), ("abs_sf", a_cur["u1"], avalid),
        ("per_all", aper_all, avalid), ("per_sf", aper_sf, avalid),
        ("yoy_all", ayoy_all, acomp & (a_pri["total"] >= config.LOW_BASELINE_UNITS)),
        ("yoy_sf", ayoy_sf, acomp & (a_pri["u1"] >= config.LOW_BASELINE_UNITS)),
    ):
        arank_cols[name] = ranks(vals, elig)

    # --- Multi-year growth inputs (same for both views) ------------------------------
    # Population: PEP change over three years ending at the vintage's latest year.
    # Permits: final annual files, latest year vs three years earlier (complete records).
    pop_from = pop_year - 3
    pop_base = (pop_by_year.reindex(universe)[pop_from].to_numpy(dtype=float)
                if pop_from in pop_by_year.columns else np.full(U, np.nan))
    pop_growth = metrics.yoy_pct(pop, pop_base)
    AY3 = AY - 3
    a_base = {k: A[AY3][k].reindex(universe).to_numpy(dtype=float) if len(A.get(AY3, [])) else np.full(U, np.nan)
              for k in ("u1", "total")}
    g3_all = metrics.yoy_pct(a_cur["total"], a_base["total"])
    g3_sf = metrics.yoy_pct(a_cur["u1"], a_base["u1"])

    def aflags(i):
        f = []
        if acls[i] == "complete" and a_pri["total"][i] < config.LOW_BASELINE_UNITS:
            f.append("low_baseline")
        if acls[i] == "complete" and a_pri["total"][i] == 0:
            f.append("no_prior_permits")
        if acls[i] == "complete" and a_pri["u1"][i] < config.LOW_BASELINE_UNITS:
            f.append("low_baseline_sf")
        if divergent[i]:
            f.append("monthly_annual_divergence")
        if pop_ay[i] < config.SMALL_POPULATION:
            f.append("small_population")
        return f

    # --- Statewide offices not attributable to a county & legacy codes ---------------
    unalloc = []
    for g in all_geoids:
        if g.endswith("000"):
            gi = gindex[g]
            st = g[:2]
            unalloc.append({
                "statefp": st, "state": gidx["states"].get(st, {}).get("name"),
                "name": next(df.loc[df.geoid == g, "name"].iloc[0] for (s, p), df in sorted(county.items(), reverse=True)
                             if s == "y" and (df.geoid == g).any()),
                "ttm_units": _round(ttm["total"][L, gi]),
                "annual_units": _round(A[AY]["total"].get(g, np.nan)),
            })
    legacy = []
    for g in all_geoids:
        if g in gidx["counties"] or g.endswith("000"):
            continue
        seen = [p for (s, p), df in county.items() if s in ("y", "a") and (df.geoid == g).any()]
        name = next(df.loc[df.geoid == g, "name"].iloc[0] for (s, p), df in sorted(county.items(), reverse=True)
                    if (df.geoid == g).any())
        legacy.append({"geoid": g, "name": name, "first": min(seen), "last": max(seen)})

    # --- National context -------------------------------------------------------------
    us_b = us_y.copy()
    for t in range(L):
        if t % 12 != 11:
            us_b[t] = us_y[t + 1] - us_c[t + 1]
    us_ttm = np.full(L + 1, np.nan)
    for t in range(12, L + 1):
        us_ttm[t] = us_b[t] + us_y[t - (t % 12 + 1)] - us_b[t - 12]
    county_ttm_sum = float(np.nansum(cur["total"][valid_cur]))
    unalloc_ttm = float(sum(u["ttm_units"] or 0 for u in unalloc))

    # --- Assemble outputs ----------------------------------------------------------------
    names = [gidx["counties"][g]["name"] for g in universe]
    sts = [gidx["counties"][g]["st"] for g in universe]
    counts = pd.Series(cls).value_counts().to_dict()
    acounts = pd.Series(acls).value_counts().to_dict()

    metrics_json = {
        "geoid": universe,
        "ttm": {
            "cls": cls.tolist(),
            **{f"cur_{k}": _col(cur[k]) for k in ("total", "u1", "u2", "u34", "u5", "mf")},
            **{f"pri_{k}": _col(pri[k]) for k in ("total", "u1", "mf")},
            "yoy_all": _col(yoy_all, 1), "yoy_sf": _col(yoy_sf, 1),
            "per_all": _col(per_all, 2), "per_sf": _col(per_sf, 2),
            "imputed": _col(imputed, 3),
            "flags": [flags_for(i, "ttm") for i in range(U)],
            **{f"rk_{n}": [[int(a), int(b_), int(c), int(d)] for a, b_, c, d in zip(*v)] for n, v in rank_cols.items()},
            "pop": _col(pop),
        },
        "annual": {
            "cls": acls.tolist(),
            **{f"cur_{k}": _col(a_cur[k]) for k in ("total", "u1", "u2", "u34", "u5", "mf")},
            **{f"pri_{k}": _col(a_pri[k]) for k in ("total", "u1", "mf")},
            "yoy_all": _col(ayoy_all, 1), "yoy_sf": _col(ayoy_sf, 1),
            "per_all": _col(aper_all, 2), "per_sf": _col(aper_sf, 2),
            "flags": [aflags(i) for i in range(U)],
            **{f"rk_{n}": [[int(a), int(b_), int(c), int(d)] for a, b_, c, d in zip(*v)] for n, v in arank_cols.items()},
            "pop": _col(pop_ay),
        },
        "recon": {"dec_ytd": _col(dec_ytd), "annual": _col(ann_tot)},
        "growth": {
            "pop_3y": _col(pop_growth, 2),
            "permits_3y_all": _col(g3_all, 1), "permits_3y_sf": _col(g3_sf, 1),
            "permits_base_all": _col(a_base["total"]), "permits_base_sf": _col(a_base["u1"]),
        },
    }

    # History per state: monthly first-published, TTM, YoY; annual by type.
    hist_start = 0
    history = {}
    for i, g in enumerate(universe):
        gi = gindex.get(g)
        st = gidx["counties"][g]["statefp"]
        if gi is None:
            rec = None
        else:
            m_sf = C["u1_units"][hist_start:, gi]
            m_mf = (C["u2_units"] + C["u34_units"] + C["u5_units"])[hist_start:, gi]
            rec = {
                "m_sf": _col(m_sf), "m_mf": _col(m_mf),
                "t_all": _col(T_all[hist_start:, gi]), "t_sf": _col(T_sf[hist_start:, gi]),
                "y_all": _col(Y_all[hist_start:, gi], 1), "y_sf": _col(Y_sf[hist_start:, gi], 1),
            }
        arec = {"a_sf": [_round(A[y]["u1"].get(g, np.nan)) for y in years],
                "a_mf": [_round(A[y]["mf"].get(g, np.nan)) for y in years]}
        history.setdefault(st, {})[g] = {**(rec or {}), **arec}

    digest = inputs_digest(store)
    version = f"{period_of(L)}.{digest[:8]}"
    period_cur = (period_of(L - 11), period_of(L))
    period_pri = (period_of(P - 11), period_of(P))

    def src(key):
        m = files[key]
        return {"file": m["source_filename"], "url": m["source_url"], "sha256": m["sha256"],
                "listing_last_modified": m["source_listing_last_modified"], "downloaded_at": m["downloaded_at"]}

    def ckey(series, t):
        p = period_of(t)
        return f"raw/permits/county/co{p[2:4]}{p[5:7]}{series}.txt"

    input_months = metrics.ttm_inputs(L, L) + metrics.ttm_inputs(P, L)
    input_files = sorted({ckey(sr, t) for t in input_months for sr in ("y", "c")} & set(files))
    pep_key = next(k for k, m in store.entries("pep_county").items() if int(m["period"]) == V)
    pep_meta = files[pep_key]

    meta = {
        "version": version,
        "processing_version": PROCESSING_VERSION,
        "inputs_sha256": digest,
        "data_through": period_of(L),
        "latest_month_preliminary": True,
        "ttm": {"current": period_cur, "prior": period_pri},
        "annual": {"year": AY, "prior_year": AY - 1},
        "population": {"vintage": V, "year": pop_year, "annual_view_year": pop_ay_year,
                       "estimates_base": pep_meta.get("extra", {}).get("estimates_base"),
                       "source": src(pep_key), "prior_vintages": sorted(v for v in pops if v != V)},
        "geography": {"vintage": config.GEO_VINTAGE, "universe": U, "states": len(gidx["states"]),
                      "county_file": src(geo_keys["cb_county"]), "state_file": src(geo_keys["cb_state"]),
                      "projection": gidx["projection"]},
        "coverage": {
            "ttm_classes": {k: int(counts.get(k, 0)) for k in
                            ("complete", "current_only", "incomplete", "annual_only", "not_in_bps")},
            "annual_classes": {k: int(acounts.get(k, 0)) for k in ("complete", "current_only", "not_in_bps")},
            "ttm_complete_pct": round(100 * counts.get("complete", 0) / U, 1),
            "counties_with_current_ttm": int(valid_cur.sum()),
            "first_full_coverage_month": period_of(first_full),
            "monthly_coverage_ratio": {period_of(t): (None if np.isnan(ratio[t]) else round(float(ratio[t]), 4))
                                       for t in range(L + 1)},
            "us_ttm_official": _round(us_ttm[L]), "us_ttm_prior_official": _round(us_ttm[P]),
            "us_ttm_yoy_official": _round(metrics.yoy_pct(np.array([us_ttm[L]]), np.array([us_ttm[P]]))[0], 1),
            "county_ttm_sum": int(county_ttm_sum), "unallocated_ttm": int(unalloc_ttm),
            "divergent_counties": int(divergent.sum()),
            "statewide_offices": unalloc, "legacy_codes": legacy,
        },
        "growth": {"pop_from": pop_from, "pop_to": pop_year, "permits_from": AY3, "permits_to": AY},
        "thresholds": {"low_baseline_units": config.LOW_BASELINE_UNITS, "small_population": config.SMALL_POPULATION,
                       "divergence_share": config.DIVERGENCE_SHARE, "divergence_min_units": config.DIVERGENCE_MIN_UNITS,
                       "high_imputation_share": config.HIGH_IMPUTATION_SHARE},
        "history": {"start": period_of(hist_start), "months": L + 1 - hist_start,
                    "month_full": [bool(x) for x in full[hist_start:]],
                    "ttm_full": [bool(x) for x in ttm_full[hist_start:]],
                    "annual_start": years[0], "annual_years": len(years)},
        "sources": {
            "agency": config.SOURCE_AGENCY,
            "bps_home": config.BPS_HOME, "bps_county_dir": config.BPS_COUNTY_DIR,
            "bps_methodology": config.BPS_METHODOLOGY, "bps_schedule": config.BPS_SCHEDULE,
            "pep_home": config.PEP_HOME, "geo_home": config.GEO_HOME,
            "ttm_input_files": [src(k) for k in input_files],
            "annual_files": [src(f"raw/permits/county/co{y}a.txt") for y in (AY - 1, AY)],
            "notices": [{"file": m["source_filename"], "url": m["source_url"],
                         "text": store.read(k).decode("latin-1").strip()}
                        for k, m in store.entries("bps_county").items() if m["series"] == "notice"],
        },
        "warnings": sorted(set(b.warnings)),
    }

    # Write --------------------------------------------------------------------------------
    web = out / "web"
    proc = out / "processed"
    (web / "geo").mkdir(parents=True, exist_ok=True)
    (web / "history").mkdir(parents=True, exist_ok=True)
    proc.mkdir(parents=True, exist_ok=True)

    def dump(path: Path, obj):
        path.write_text(json.dumps(obj, separators=(",", ":"), sort_keys=False, ensure_ascii=False))

    dump(web / "geo" / "counties.geojson", geo["counties"])
    dump(web / "geo" / "states.geojson", geo["states"])
    dump(web / "geo" / "insets.geojson", geo["insets"])
    dump(web / "geo" / "index.json", gidx)
    dump(web / "metrics.json", metrics_json)
    for st, recs in sorted(history.items()):
        dump(web / "history" / f"{st}.json", recs)

    # Processed tables (Parquet) for analysis and audit.
    cur_df = pd.DataFrame({"geoid": universe, "name": names, "st": sts, "class": cls,
                           **{f"ttm_{k}": cur[k] for k in cur}, **{f"prior_ttm_{k}": pri[k] for k in pri},
                           "yoy_pct": yoy_all, "yoy_sf_pct": yoy_sf, "per_1000": per_all, "per_1000_sf": per_sf,
                           "population": pop, "imputed_share": imputed,
                           "pop_growth_3y_pct": pop_growth, "permits_3y_pct": g3_all, "permits_3y_sf_pct": g3_sf,
                           "flags": [";".join(flags_for(i, "ttm")) for i in range(U)]})
    cur_df.insert(4, "period_start", period_cur[0])
    cur_df.insert(5, "period_end", period_cur[1])
    cur_df.to_parquet(proc / "county_ttm_current.parquet", index=False)
    pd.DataFrame({"geoid": universe, "name": names, "st": sts, "class": acls,
                  **{f"cy_{k}": a_cur[k] for k in a_cur}, **{f"prior_cy_{k}": a_pri[k] for k in a_pri},
                  "yoy_pct": ayoy_all, "per_1000": aper_all, "population": pop_ay,
                  "year": AY}).to_parquet(proc / "county_annual_current.parquet", index=False)
    tt = []
    for i, g in enumerate(universe):
        gi = gindex.get(g)
        if gi is None:
            continue
        tt.append(pd.DataFrame({"geoid": g, "period": [period_of(t) for t in range(L + 1)],
                                "month_sf": C["u1_units"][:, gi],
                                "month_mf": (C["u2_units"] + C["u34_units"] + C["u5_units"])[:, gi],
                                "ttm_total": T_all[:, gi], "ttm_sf": T_sf[:, gi],
                                "yoy_pct": Y_all[:, gi], "ttm_full_coverage": ttm_full}))
    pd.concat(tt).to_parquet(proc / "county_monthly_history.parquet", index=False)
    pd.concat([A[y].assign(year=y).rename_axis("geoid").reset_index() for y in years if len(A[y])]) \
        .to_parquet(proc / "county_annual_history.parquet", index=False)
    popdf.to_parquet(proc / f"population_v{V}.parquet", index=False)

    b.notes = {
        "meta": meta, "L": L, "P": P, "universe": universe, "gindex": gindex, "Y": Y, "C": C, "ttm": ttm,
        "T_all": T_all, "cur": cur, "pri": pri, "cls": cls, "pop": pop, "per_all": per_all, "yoy_all": yoy_all,
        "full": full, "ratio": ratio, "st_ytd": st_ytd, "county": county, "state": state, "A": A, "AY": AY,
        "popdf": popdf, "geo_index": gidx, "pops": pops, "acls": acls, "a_cur": a_cur, "a_pri": a_pri,
        "aper_all": aper_all, "ayoy_all": ayoy_all, "months_c": months_c, "months_y": months_y,
        "pop_growth": pop_growth, "pop_base": pop_base, "g3_all": g3_all, "g3_sf": g3_sf, "a_base": a_base,
    }
    return b


def write_meta(out: Path, meta: dict) -> None:
    (out / "web").mkdir(parents=True, exist_ok=True)
    (out / "web" / "meta.json").write_text(json.dumps(meta, indent=1, sort_keys=True, ensure_ascii=False))
