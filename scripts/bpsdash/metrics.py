"""Trailing-12-month, YoY and per-capita calculations on month x county arrays.

Notation (all values are housing units authorized, Census estimates):
  YTD(y, m)  units Jan..m of year y from the year-to-date file for month m (coYYMMy)
  C(y, m)    units in month m as first published (coYYMMc)

Census: "Year-to-date data include any late reports received or corrections made to
reports from prior months in the year." So the best available Jan..m cumulative for a
past month comes from the *next* release, with that release's own month removed:

  B(y, m) = YTD(y, m+1) - C(y, m+1)   if release (y, m+1) exists and m < 12
          = YTD(y, m)                 otherwise (December, or the latest release)

  TTM(y, m) = B(y, m) + YTD(y-1, 12) - B(y-1, m)

For m = 12 this reduces to YTD(y, 12). Using B rather than YTD(y-1, m) in the
subtraction keeps the two TTM windows that partition year y-1 consistent: a late
report for, say, August that arrives with the September release is counted exactly
once rather than in neither window. All terms come from the monthly series; the final
annual file is never mixed in (it is not comparable at county level).

Arrays are float64 of shape (T, G) with NaN meaning "county absent from that file".
Absent is never treated as zero.
"""
from __future__ import annotations

import numpy as np

START_YEAR = 2000


def month_index(period: str) -> int:
    y, m = int(period[:4]), int(period[5:7])
    return (y - START_YEAR) * 12 + (m - 1)


def period_of(t: int) -> str:
    return f"{START_YEAR + t // 12:04d}-{t % 12 + 1:02d}"


def best_cumulative(ytd: np.ndarray, cur: np.ndarray, last: int) -> np.ndarray:
    """B(t) for t = 0..last (see module docstring)."""
    T = last + 1
    b = ytd[:T].copy()
    for t in range(T - 1):
        if t % 12 != 11:  # not December
            b[t] = ytd[t + 1] - cur[t + 1]
    return b


def ttm(ytd: np.ndarray, cur: np.ndarray, last: int) -> tuple[np.ndarray, np.ndarray]:
    """Return (ttm, negative_mask). Values with a negative result are set to NaN."""
    T, G = last + 1, ytd.shape[1]
    b = best_cumulative(ytd, cur, last)
    out = np.full((T, G), np.nan)
    for t in range(12, T):
        m = t % 12 + 1
        if m == 12:
            out[t] = ytd[t]  # the prior-year terms cancel; do not require the prior December
        else:
            out[t] = b[t] + ytd[t - m] - b[t - 12]
    neg = out < 0
    out[neg] = np.nan
    return out, neg


def ttm_inputs(t: int, last: int) -> list[int]:
    """Month indexes whose files enter TTM(t)."""
    m = t % 12 + 1
    if m == 12:
        return [t]
    ins = {t, t - m, t - 12, t - 11}
    if t + 1 <= last:
        ins.add(t + 1)
    return sorted(ins)


def ttm_full_coverage(full: np.ndarray, last: int) -> np.ndarray:
    """True where every input month of TTM(t) is a full-coverage month."""
    out = np.zeros(last + 1, dtype=bool)
    for t in range(12, last + 1):
        out[t] = all(full[i] for i in ttm_inputs(t, last))
    return out


def yoy_pct(cur: np.ndarray, prior: np.ndarray) -> np.ndarray:
    """(cur / prior - 1) * 100; undefined (NaN) when prior is 0 or either is missing."""
    with np.errstate(divide="ignore", invalid="ignore"):
        out = (cur / prior - 1.0) * 100.0
    out[~(prior > 0)] = np.nan
    out[np.isnan(cur)] = np.nan
    return out


def per_1000(units: np.ndarray, population: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        out = units / population * 1000.0
    out[~(population > 0)] = np.nan
    return out


def yoy_series(series: np.ndarray) -> np.ndarray:
    """YoY % for each month against the same month a year earlier (shape (T, G))."""
    out = np.full_like(series, np.nan)
    out[12:] = yoy_pct(series[12:], series[:-12])
    return out


def rank_desc(values: np.ndarray, eligible: np.ndarray, groups: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Competition ranks (1 = highest) among eligible entries, optionally within groups.

    Returns (rank, n) arrays; ineligible entries get rank 0 and n 0.
    """
    rank = np.zeros(len(values), dtype=np.int64)
    n = np.zeros(len(values), dtype=np.int64)
    keys = np.zeros(len(values), dtype=object) if groups is None else groups
    for g in np.unique(keys[eligible]) if eligible.any() else []:
        idx = np.where(eligible & (keys == g))[0]
        v = values[idx]
        # rank = 1 + number of strictly greater values
        order = np.sort(v)[::-1]
        r = 1 + np.searchsorted(-order, -v, side="left")
        rank[idx] = r
        n[idx] = len(idx)
    return rank, n
