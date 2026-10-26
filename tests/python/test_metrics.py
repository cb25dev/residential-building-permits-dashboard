"""Calculation tests on synthetic month x county arrays.

The helper ``releases`` simulates how Census publishes: each month's YTD file holds
revised values for earlier months plus the preliminary value for the new month, and
the current-month file holds that preliminary value.
"""
import numpy as np
import pytest

from bpsdash import metrics

NAN = np.nan


def releases(prelim: np.ndarray, revised: np.ndarray):
    """prelim/revised: (T,) true monthly values starting January. Returns (ytd, cur) (T, 1)."""
    T = len(prelim)
    ytd = np.zeros((T, 1))
    cur = prelim.reshape(-1, 1).astype(float).copy()
    for t in range(T):
        y0 = t - t % 12
        ytd[t, 0] = revised[y0:t].sum() + prelim[t]
    return ytd, cur


def test_month_index_roundtrip():
    for p in ("2000-01", "2022-01", "2026-08"):
        assert metrics.period_of(metrics.month_index(p)) == p


def test_ttm_without_revisions_is_the_sum_of_twelve_months():
    v = np.arange(1, 37, dtype=float)  # Jan year0 .. Dec year2
    ytd, cur = releases(v, v)
    T, _ = metrics.ttm(ytd, cur, last=35)
    for t in range(12, 36):
        assert T[t, 0] == v[t - 11:t + 1].sum()


def test_december_ttm_equals_december_ytd():
    v = np.full(24, 10.0)
    ytd, cur = releases(v, v)
    ytd[:12] = NAN  # county absent from every file of the prior year
    T, _ = metrics.ttm(ytd, cur, last=23)
    assert T[23, 0] == ytd[23, 0] == 120


def test_late_report_is_counted_exactly_once():
    # August of year 1 is first published as 10 and revised to 15 in the September release.
    prelim = np.full(36, 10.0)
    revised = prelim.copy()
    revised[12 + 7] = 15.0
    ytd, cur = releases(prelim, revised)
    T, _ = metrics.ttm(ytd, cur, last=35)
    aug_y1, aug_y2 = 12 + 7, 24 + 7
    # Prior window (Sep y0..Aug y1) uses the revised August value...
    assert T[aug_y1, 0] == 11 * 10 + 15
    # ...and the current window (Sep y1..Aug y2) excludes it: no double count, no loss.
    assert T[aug_y2, 0] == 12 * 10
    # Naive YTD(y, m) + YTD(y-1, 12) - YTD(y-1, m) would put the +5 revision in the current window:
    naive = ytd[aug_y2, 0] + ytd[23, 0] - ytd[aug_y1, 0]
    assert naive == 12 * 10 + 5


def test_latest_month_uses_preliminary_ytd():
    v = np.full(20, 10.0)
    ytd, cur = releases(v, v)
    T, _ = metrics.ttm(ytd, cur, last=19)
    assert T[19, 0] == 120


def test_missing_county_in_any_input_is_na_not_zero():
    v = np.full(36, 10.0)
    ytd, cur = releases(v, v)
    ytd[23, 0] = NAN  # absent from December YTD of year 1
    T, _ = metrics.ttm(ytd, cur, last=35)
    assert np.isnan(T[24 + 7, 0])
    assert not np.isnan(T[23 - 12, 0]) if 23 - 12 >= 12 else True


def test_negative_result_is_flagged_and_na():
    ytd = np.zeros((24, 1))
    cur = np.zeros((24, 1))
    ytd[12:, 0] = 0
    ytd[0:12, 0] = 50
    ytd[9, 0], cur[9, 0] = 50, 0  # Jan-Sep y0 = 50 per the Sep release
    ytd[11, 0] = 20               # a later correction cut the full-year total to 20
    T, neg = metrics.ttm(ytd, cur, last=23)
    assert np.isnan(T[12 + 7, 0]) and neg[12 + 7, 0]


def test_yoy_definitions():
    cur = np.array([110.0, 5.0, 0.0, 10.0, NAN])
    pri = np.array([100.0, 0.0, 0.0, NAN, 10.0])
    y = metrics.yoy_pct(cur, pri)
    assert y[0] == pytest.approx(10.0)
    assert np.isnan(y[1])  # zero prior -> undefined, never infinite
    assert np.isnan(y[2])
    assert np.isnan(y[3]) and np.isnan(y[4])
    assert metrics.yoy_pct(np.array([0.0]), np.array([50.0]))[0] == pytest.approx(-100.0)


def test_per_1000():
    r = metrics.per_1000(np.array([50.0, 1.0, 5.0]), np.array([10_000.0, 0.0, NAN]))
    assert r[0] == pytest.approx(5.0)
    assert np.isnan(r[1]) and np.isnan(r[2])


def test_ttm_inputs_and_mixed_regime():
    last = 40
    assert metrics.ttm_inputs(23, last) == [23]                # December: YTD(y,12) only
    assert metrics.ttm_inputs(19, last) == [7, 8, 11, 19, 20]  # August: B uses Sep releases
    full = np.zeros(last + 1, dtype=bool)
    full[24:] = True  # coverage regime starts in month 24
    f = metrics.ttm_full_coverage(full, last)
    assert not f[30] and f[35] and f[36]


def test_rank_desc_competition_and_groups():
    v = np.array([10.0, 30.0, 30.0, 5.0, 7.0])
    elig = np.array([True, True, True, True, False])
    r, n = metrics.rank_desc(v, elig)
    assert r.tolist() == [3, 1, 1, 4, 0] and n.tolist() == [4, 4, 4, 4, 0]
    g = np.array(["a", "a", "b", "b", "b"], dtype=object)
    r, n = metrics.rank_desc(v, elig, g)
    assert r.tolist() == [2, 1, 1, 2, 0] and n.tolist() == [2, 2, 2, 2, 0]
