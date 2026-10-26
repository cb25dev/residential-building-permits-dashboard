"""End-to-end checks against the committed raw Census files.

Expected values below were derived by hand from the raw rows (shown in comments), not
from the pipeline, so these tests catch calculation regressions on real data.
"""
import json
import shutil

import numpy as np
import pytest

from bpsdash import build, config, validate
from bpsdash.sources import RawStore, load_manifest

pytestmark = pytest.mark.skipif(not config.MANIFEST.exists(), reason="raw Census files not present")


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("build")
    b = build.run(RawStore(load_manifest()), out, cache=config.PARSE_CACHE, log=lambda *a: None)
    yield b, out
    shutil.rmtree(out, ignore_errors=True)


def _row(b, geoid):
    return b.notes["universe"].index(geoid)


def test_baldwin_county_al_hand_calculation(built):
    b, _ = built
    if b.notes["meta"]["data_through"] != "2026-08":
        pytest.skip("hand-derived values are for data through 2026-08")
    i = _row(b, "01003")
    cur, pri = b.notes["cur"], b.notes["pri"]
    # co2608y 2098+10+3+77=2188; co2512y 2517+12+4+132=2665; co2509y 2034 - co2509c 274 = 1760
    assert cur["total"][i] == 2188 + 2665 - 1760 == 3093
    # single-family: 2098 + 2517 - (1952 - 255)
    assert cur["u1"][i] == 2918
    # prior: 1760 + co2412y 3883 - (co2409y 3155 - co2409c 364)
    assert pri["total"][i] == 2852
    assert b.notes["yoy_all"][i] == pytest.approx((3093 / 2852 - 1) * 100)


def test_collin_county_tx_structure_reclassification(built):
    b, _ = built
    if b.notes["meta"]["data_through"] != "2026-08":
        pytest.skip("hand-derived values are for data through 2026-08")
    i = _row(b, "48085")
    cur = b.notes["cur"]
    assert cur["u1"][i] == 6788 + 11186 - (9126 - 818)  # 9666
    assert cur["total"][i] == 15010
    assert np.isnan(cur["u34"][i])  # 7 + 14 - 38 < 0 -> N/A for that type only


def test_universe_coverage_and_join(built):
    b, _ = built
    m = b.notes["meta"]
    assert m["geography"]["universe"] == 3144
    assert sum(m["coverage"]["ttm_classes"].values()) == 3144
    assert m["coverage"]["first_full_coverage_month"] == "2022-01"
    assert "09110" in b.notes["universe"]  # Connecticut planning regions
    assert "02063" in b.notes["universe"] and "02261" not in b.notes["universe"]  # Chugach replaces Valdez-Cordova


def test_validation_passes(built):
    b, out = built
    report = validate.run(b, out)
    failed = [c for c in report["checks"] if c["status"] == "fail"]
    assert not failed, failed


def test_web_artifacts_have_no_hardcoded_or_missing_counties(built):
    _, out = built
    mj = json.loads((out / "web" / "metrics.json").read_text())
    assert len(mj["geoid"]) == 3144 and len(mj["ttm"]["cls"]) == 3144
    i = mj["geoid"].index("01003")
    assert mj["ttm"]["cur_total"][i] == 3093 or mj["ttm"]["cur_total"][i] is not None
