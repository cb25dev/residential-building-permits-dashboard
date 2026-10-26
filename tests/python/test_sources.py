"""Discovery, download hardening, and raw-store tests (no network)."""
import gzip
from pathlib import Path

import pytest

from bpsdash import config, http, sources

FIX = Path(__file__).parent / "fixtures"


@pytest.mark.parametrize("name,kind,expect", [
    ("co2608y.txt", "county", {"series": "y", "period": "2026-08", "year": 2026}),
    ("co0001c.txt", "county", {"series": "c", "period": "2000-01", "year": 2000}),
    ("co8812c.txt", "county", {"series": "c", "period": "1988-12", "year": 1988}),
    ("co2025a.txt", "county", {"series": "a", "period": "2025", "year": 2025}),
    ("co2022aupdatednotice.txt", "county", {"series": "notice", "period": None, "year": None}),
    ("st2608c.txt", "state", {"series": "c", "period": "2026-08", "year": 2026}),
    ("st2025a.txt", "state", {"series": "a", "period": "2025", "year": 2025}),
    ("co2613y.txt", "county", None),
    ("readme.txt", "county", None),
])
def test_classify_bps_name(name, kind, expect):
    assert sources.classify_bps_name(name, kind) == expect


def test_listing_parser(monkeypatch):
    html = (FIX / "synthetic_listing.html").read_bytes()
    monkeypatch.setattr(http, "get", lambda url, expect="data": http.Download(url, html, None, None))
    entries = http.listing("https://example.invalid/")
    assert [e.name for e in entries] == ["co2608c.txt", "co2608y.txt", "co2025a.txt"]
    assert entries[1].last_modified == "2026-09-24 07:46"


def test_firewall_pages_are_rejected():
    page = b"<html><head><title>Request Rejected</title></head><body>The requested URL was rejected."
    with pytest.raises(http.RejectedResponse):
        http._check_body("u", page, "data")
    with pytest.raises(http.RejectedResponse):
        http._check_body("u", b"not a zip", "zip")
    http._check_body("u", b"Survey,FIPS,FIPS", "data")
    http._check_body("u", b"PK\x03\x04", "zip")


def test_rawstore_stage_promote_and_revision_history(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA", tmp_path)
    monkeypatch.setattr(config, "MANIFEST", tmp_path / "raw" / "manifest.json")
    cand = sources.Candidate(key="raw/permits/county/co2608y.txt", url="https://x/co2608y.txt",
                             dataset="bps_county", series="y", period="2026-08",
                             listing_last_modified="2026-09-24 07:46")
    m = sources.load_manifest(config.MANIFEST)
    store = sources.RawStore(m, staging=tmp_path / ".staging")
    assert store.stage(cand, b"v1", None) == "new"
    assert store.read(cand.key) == b"v1"             # read from staging before promotion
    assert not (tmp_path / cand.stored_as).exists()  # nothing committed yet
    store.promote()
    assert gzip.decompress((tmp_path / cand.stored_as).read_bytes()) == b"v1"

    m = sources.load_manifest(config.MANIFEST)
    store = sources.RawStore(m, staging=tmp_path / ".staging")
    assert store.stage(cand, b"v1", None) == "unchanged"
    store.discard()
    store = sources.RawStore(m, staging=tmp_path / ".staging")
    assert store.stage(cand, b"v2", None) == "revised"
    store.discard()  # a failed validation discards staged bytes...
    assert gzip.decompress((tmp_path / cand.stored_as).read_bytes()) == b"v1"  # ...committed file untouched
    store = sources.RawStore(m, staging=tmp_path / ".staging")
    store.stage(cand, b"v2", None)
    store.promote()
    meta = sources.load_manifest(config.MANIFEST)["files"][cand.key]
    assert meta["sha256"] == sources.sha256(b"v2")
    assert meta["revisions"][0]["sha256"] == sources.sha256(b"v1")


def test_needs_download_on_new_listing_time(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA", tmp_path)
    (tmp_path / "raw").mkdir()
    (tmp_path / "raw" / "a.txt.gz").write_bytes(b"x")
    m = {"files": {"raw/a.txt": {"stored_as": "raw/a.txt.gz", "source_listing_last_modified": "2026-01-01 00:00"}},
         "unavailable": {}}
    c = sources.Candidate("raw/a.txt", "u", "bps_county", "y", "2026-01", "2026-01-01 00:00")
    assert not sources.needs_download(c, m)
    c.listing_last_modified = "2026-02-01 00:00"
    assert sources.needs_download(c, m)
