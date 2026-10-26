"""Source discovery, download, and the raw-file store with its provenance manifest.

Raw files are stored gzip-compressed (deterministically, mtime=0) under data/raw and
data/geography and committed to git, so every published number can be reproduced
from the exact bytes Census served. The manifest records, per file: agency, URL,
survey period, the server's listing timestamp, HTTP Last-Modified, download time,
SHA-256 of the uncompressed bytes, and the history of earlier versions.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .http import SourceError, get, listing, subdirectories

MANIFEST_SCHEMA = 1


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# --- File naming ----------------------------------------------------------------------
_CO_MONTHLY = re.compile(r"^co(\d{2})(\d{2})([cy])\.txt$")
_CO_ANNUAL = re.compile(r"^co(\d{4})a\.txt$")
_CO_NOTICE = re.compile(r"^co\w*notice\.txt$")
_ST_MONTHLY = re.compile(r"^st(\d{2})(\d{2})([cy])\.txt$")
_ST_ANNUAL = re.compile(r"^st(\d{4})a\.txt$")


def _year2(yy: str) -> int:
    """Expand a two-digit BPS file year. Files exist from 1980s onward; anything later
    than next year must be 19YY."""
    y = int(yy)
    return 2000 + y if 2000 + y <= datetime.now(timezone.utc).year + 1 else 1900 + y


def classify_bps_name(name: str, kind: str) -> dict | None:
    """Return {series, period} for a BPS file name, or None if it is not ingested."""
    if kind == "county":
        if m := _CO_MONTHLY.match(name):
            y, mo, s = _year2(m[1]), int(m[2]), m[3]
            if 1 <= mo <= 12:
                return {"series": s, "period": f"{y:04d}-{mo:02d}", "year": y}
        if m := _CO_ANNUAL.match(name):
            return {"series": "a", "period": m[1], "year": int(m[1])}
        if _CO_NOTICE.match(name):
            return {"series": "notice", "period": None, "year": None}
    else:
        if m := _ST_MONTHLY.match(name):
            y, mo = _year2(m[1]), int(m[2])
            if 1 <= mo <= 12:
                return {"series": m[3], "period": f"{y:04d}-{mo:02d}", "year": y}
        if m := _ST_ANNUAL.match(name):
            return {"series": "a", "period": m[1], "year": int(m[1])}
    return None


# --- Manifest -------------------------------------------------------------------------
def load_manifest(path: Path = config.MANIFEST) -> dict:
    if path.exists():
        m = json.loads(path.read_text())
        if m.get("schema") != MANIFEST_SCHEMA:
            raise RuntimeError(f"Unsupported manifest schema {m.get('schema')}")
        m.setdefault("unavailable", {})
        return m
    return {"schema": MANIFEST_SCHEMA, "files": {}, "unavailable": {}}


def write_json(path: Path, obj, indent: int | None = 1) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=indent, sort_keys=True, ensure_ascii=False) + "\n")
    tmp.replace(path)


# --- Candidates -----------------------------------------------------------------------
@dataclass
class Candidate:
    key: str              # logical path relative to data/, e.g. raw/permits/county/co2608y.txt
    url: str
    dataset: str          # bps_county | bps_state | pep_county | cb_county | cb_state
    series: str | None
    period: str | None
    listing_last_modified: str | None
    compress: bool = True
    extra: dict = field(default_factory=dict)

    @property
    def stored_as(self) -> str:
        return self.key + (".gz" if self.compress else "")


def discover_bps(kind: str) -> list[Candidate]:
    base = config.BPS_COUNTY_DIR if kind == "county" else config.BPS_STATE_DIR
    folder = "raw/permits/county" if kind == "county" else "raw/permits/state"
    out = []
    for e in listing(base):
        info = classify_bps_name(e.name, kind)
        if info is None:
            continue
        if info["year"] is not None and info["year"] < config.HISTORY_START_YEAR:
            continue
        out.append(Candidate(
            key=f"{folder}/{e.name}", url=base + e.name, dataset=f"bps_{kind}",
            series=info["series"], period=info["period"], listing_last_modified=e.last_modified,
        ))
    if kind == "county" and not any(c.series == "y" for c in out):
        raise SourceError("No county year-to-date files found in BPS listing; layout may have changed")
    return out


def discover_population() -> list[Candidate]:
    """Find the newest PEP county-totals vintage (directory with the latest end year)."""
    dirs = [d for d in subdirectories(config.PEP_DATASETS_DIR) if re.fullmatch(r"\d{4}-\d{4}", d)]
    if not dirs:
        raise SourceError("No PEP dataset directories found")
    newest = max(dirs, key=lambda d: (int(d[5:]), int(d[:4])))
    vintage = int(newest[5:])
    base = f"{config.PEP_DATASETS_DIR}{newest}/counties/totals/"
    fname = f"co-est{vintage}-alldata.csv"
    entries = {e.name: e for e in listing(base)}
    if fname not in entries:
        # A new vintage directory can appear before the county file; keep the prior one.
        older = sorted((d for d in dirs if d != newest), key=lambda d: int(d[5:]))
        if not older:
            raise SourceError(f"{fname} not present in {base}")
        newest = older[-1]
        vintage = int(newest[5:])
        base = f"{config.PEP_DATASETS_DIR}{newest}/counties/totals/"
        fname = f"co-est{vintage}-alldata.csv"
        entries = {e.name: e for e in listing(base)}
        if fname not in entries:
            raise SourceError(f"{fname} not present in {base}")
    return [Candidate(
        key=f"raw/population/{fname}", url=base + fname, dataset="pep_county", series="vintage",
        period=str(vintage), listing_last_modified=entries[fname].last_modified,
        extra={"vintage": vintage, "estimates_base": newest},
    )]


def discover_geography() -> list[Candidate]:
    entries = {e.name: e for e in listing(config.GEO_BASE)}
    out = []
    for fname, ds in ((config.GEO_COUNTY_ZIP, "cb_county"), (config.GEO_STATE_ZIP, "cb_state")):
        if fname not in entries:
            raise SourceError(f"{fname} not found at {config.GEO_BASE}")
        out.append(Candidate(
            key=f"geography/{fname}", url=config.GEO_BASE + fname, dataset=ds, series="boundaries",
            period=str(config.GEO_VINTAGE), listing_last_modified=entries[fname].last_modified,
            compress=False,
        ))
    return out


def discover_all() -> list[Candidate]:
    return discover_bps("county") + discover_bps("state") + discover_population() + discover_geography()


# --- Raw store with a staging overlay -------------------------------------------------
class RawStore:
    """Committed raw files plus a staging overlay for files downloaded this run.

    Reads prefer staged bytes, so a build can be validated against new files before
    anything committed is touched. ``promote`` moves staged files into place.
    """

    def __init__(self, manifest: dict, staging: Path = config.STAGING / "raw"):
        self.manifest = manifest
        self.staging = staging
        self.staged: dict[str, dict] = {}
        self.failures: dict[str, str] = {}
        self.recovered: set[str] = set()

    def entries(self, dataset: str | None = None) -> dict[str, dict]:
        merged = {**self.manifest["files"], **self.staged}
        return {k: v for k, v in sorted(merged.items()) if dataset is None or v["dataset"] == dataset}

    def _path(self, key: str) -> Path:
        meta = self.staged.get(key) or self.manifest["files"].get(key)
        if meta is None:
            raise KeyError(key)
        staged_bytes = key in self.staged and self.staged[key].get("_staged_file")
        base = self.staging if staged_bytes else config.DATA
        return base / meta["stored_as"]

    def read(self, key: str) -> bytes:
        p = self._path(key)
        data = p.read_bytes()
        return gzip.decompress(data) if p.suffix == ".gz" else data

    def path(self, key: str) -> Path:
        return self._path(key)

    def stage(self, cand: Candidate, content: bytes, http_last_modified: str | None) -> str:
        """Stage downloaded bytes. Returns 'new', 'revised', or 'unchanged'."""
        digest = sha256(content)
        prior = self.manifest["files"].get(cand.key)
        now = utcnow()
        status = "new" if prior is None else ("unchanged" if prior["sha256"] == digest else "revised")
        meta = {
            "source_agency": config.SOURCE_AGENCY,
            "dataset": cand.dataset,
            "series": cand.series,
            "period": cand.period,
            "source_url": cand.url,
            "source_filename": cand.url.rsplit("/", 1)[-1],
            "source_listing_last_modified": cand.listing_last_modified,
            "source_listing_timezone": "America/New_York (Census web server listing)",
            "http_last_modified": http_last_modified,
            "bytes": len(content),
            "sha256": digest,
            "downloaded_at": now,
            "stored_as": cand.stored_as,
            "revisions": list(prior.get("revisions", [])) if prior else [],
            **({"extra": cand.extra} if cand.extra else {}),
        }
        if status == "unchanged":
            # Same bytes, new server timestamp: keep the original download record.
            meta["downloaded_at"] = prior["downloaded_at"]
            meta["last_checked_at"] = now
        if status == "revised":
            meta["revisions"].append({k: prior.get(k) for k in (
                "sha256", "bytes", "source_listing_last_modified", "http_last_modified", "downloaded_at")})
        dest = self.staging / cand.stored_as
        dest.parent.mkdir(parents=True, exist_ok=True)
        if status != "unchanged" or not (config.DATA / cand.stored_as).exists():
            dest.write_bytes(gzip.compress(content, mtime=0) if cand.compress else content)
        else:
            dest = None
        meta["_staged_file"] = dest is not None
        meta["_status"] = status
        self.staged[cand.key] = meta
        return status

    def promote(self) -> None:
        for key, meta in sorted(self.staged.items()):
            if meta.pop("_staged_file"):
                src = self.staging / meta["stored_as"]
                dst = config.DATA / meta["stored_as"]
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(src), str(dst))
            meta.pop("_status", None)
            self.manifest["files"][key] = meta
            self.manifest["unavailable"].pop(key, None)
        self.staged.clear()
        write_json(config.MANIFEST, self.manifest)
        shutil.rmtree(self.staging, ignore_errors=True)

    def discard(self) -> None:
        self.staged.clear()
        shutil.rmtree(self.staging, ignore_errors=True)


def needs_download(cand: Candidate, manifest: dict, force: bool = False) -> bool:
    if cand.key in manifest.get("unavailable", {}):
        return True
    prior = manifest["files"].get(cand.key)
    if prior is None or force:
        return True
    if not (config.DATA / prior["stored_as"]).exists():
        return True
    return prior.get("source_listing_last_modified") != cand.listing_last_modified


def fetch_into(store: RawStore, cands: list[Candidate], workers: int = 3, log=print) -> dict[str, list[str]]:
    """Download candidates concurrently (politely) and stage them.

    Files Census refuses to serve are recorded under manifest["unavailable"] (by
    ``mark_unavailable``) so they are retried once per run without blocking it.
    """
    from concurrent.futures import ThreadPoolExecutor

    result: dict[str, list[str]] = {"new": [], "revised": [], "unchanged": [], "failed": []}
    failures: dict[str, str] = {}

    def one(c: Candidate):
        tries = 1 if c.key in store.manifest.get("unavailable", {}) else 5
        return c, get(c.url, attempts=tries, expect="data" if c.compress else "zip")

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(one, c): c for c in cands}
        for f, c in futs.items():
            try:
                _, d = f.result()
            except SourceError as e:
                failures[c.key] = str(e)
                continue
            status = store.stage(c, d.content, d.http_last_modified)
            result[status].append(c.key)
            store.recovered.add(c.key)
    result["failed"] = sorted(failures)
    store.failures = {**getattr(store, "failures", {}), **failures}
    done = len(result["new"]) + len(result["revised"]) + len(result["unchanged"])
    log(f"downloaded {done} file(s): {len(result['new'])} new, {len(result['revised'])} revised, "
        f"{len(result['unchanged'])} unchanged content, {len(failures)} failed")
    return result


def mark_unavailable(manifest: dict, cands: dict[str, Candidate], failures: dict[str, str]) -> None:
    now = utcnow()
    for key, reason in failures.items():
        c = cands[key]
        prior = manifest["unavailable"].get(key, {})
        manifest["unavailable"][key] = {
            "source_url": c.url, "dataset": c.dataset, "series": c.series, "period": c.period,
            "reason": reason, "first_failed_at": prior.get("first_failed_at", now), "last_attempt_at": now,
        }
