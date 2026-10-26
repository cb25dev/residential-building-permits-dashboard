"""Refresh orchestration: discover -> download -> build -> validate -> promote -> release.

Guarantees:
* Nothing committed (raw files, manifest, processed data, web artifacts) changes unless
  the new build passes validation. Downloads and builds happen in data/.staging.
* Idempotent: identical inputs give the same version id and byte-identical artifacts;
  a run with nothing new exits successfully without touching published files.
* Every attempt is appended to data/logs/refresh-log.jsonl and written to a JSON report
  (uploaded as a GitHub Actions artifact) and the Actions job summary.
"""
from __future__ import annotations

import gzip
import json
import os
import shutil
import traceback
from pathlib import Path

import pandas as pd

from . import PROCESSING_VERSION, build, config, validate
from .http import SourceError
from .sources import RawStore, discover_all, fetch_into, load_manifest, mark_unavailable, needs_download, utcnow, write_json

RELEASE_INDEX = config.RELEASES / "index.json"
REFRESH_LOG = config.LOGS / "refresh-log.jsonl"


def load_releases() -> list[dict]:
    if RELEASE_INDEX.exists():
        return json.loads(RELEASE_INDEX.read_text())["releases"]
    return []


def latest_release() -> dict | None:
    r = load_releases()
    return r[-1] if r else None


def _append_log(entry: dict) -> None:
    config.LOGS.mkdir(parents=True, exist_ok=True)
    with REFRESH_LOG.open("a") as f:
        f.write(json.dumps(entry, sort_keys=True) + "\n")


def _swap(src: Path, dst: Path, keep: tuple[str, ...] = ()) -> None:
    """Replace dst with src, preserving named children of dst (e.g. a parse cache)."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    old = dst.with_name(dst.name + ".old")
    shutil.rmtree(old, ignore_errors=True)
    if dst.exists():
        dst.rename(old)
    src.rename(dst)
    if old.exists():
        for k in keep:
            if (old / k).exists() and not (dst / k).exists():
                (old / k).rename(dst / k)
        shutil.rmtree(old, ignore_errors=True)


def finalize_meta(meta: dict, report: dict, releases: list[dict]) -> dict:
    """Attach release history and validation results to the build metadata."""
    rel = next((r for r in reversed(releases) if r["version"] == meta["version"]), None)
    meta = dict(meta)
    meta["release"] = rel
    meta["last_successful_update"] = rel["created_at"] if rel else None
    meta["releases"] = [{k: r[k] for k in ("version", "data_through", "created_at", "population_vintage", "summary")}
                        for r in releases[-24:]][::-1]
    meta["validation"] = report
    return meta


def build_and_validate(store: RawStore, previous: dict | None, log=print, allow_regress=False):
    out = config.STAGING / "build"
    shutil.rmtree(out, ignore_errors=True)
    b = build.run(store, out, cache=config.PARSE_CACHE, log=log)
    report = validate.run(b, out, previous_release=previous, allow_regress=allow_regress)
    return b, out, report


def promote_outputs(out: Path, meta: dict) -> None:
    build.write_meta(out, meta)
    (out / "web" / "validation.json").write_text(json.dumps(meta["validation"], indent=1, sort_keys=True))
    _swap(out / "processed", config.PROCESSED)
    _swap(out / "web", config.WEB_DATA)
    shutil.rmtree(out, ignore_errors=True)


def write_release(meta: dict, report: dict, changes: dict) -> dict:
    releases = load_releases()
    if releases and releases[-1]["version"] == meta["version"]:
        return releases[-1]
    prev = releases[-1] if releases else None
    cov = meta["coverage"]
    parts = [f"Data through {meta['data_through']}"]
    if prev and prev["data_through"] != meta["data_through"]:
        parts.append(f"new reporting month (was {prev['data_through']})")
    if prev and prev["population_vintage"] != meta["population"]["vintage"]:
        parts.append(f"population vintage {prev['population_vintage']} -> {meta['population']['vintage']}")
    if changes.get("revised"):
        parts.append(f"{len(changes['revised'])} revised source file(s)")
    rec = {
        "version": meta["version"], "data_through": meta["data_through"], "created_at": utcnow(),
        "processing_version": PROCESSING_VERSION, "inputs_sha256": meta["inputs_sha256"],
        "population_vintage": meta["population"]["vintage"], "geography_vintage": meta["geography"]["vintage"],
        "ttm_complete_counties": cov["ttm_classes"]["complete"], "us_ttm_official": cov["us_ttm_official"],
        "validation": report["counts"], "changes": changes, "summary": "; ".join(parts),
        "git_commit": os.environ.get("GITHUB_SHA"),
    }
    releases.append(rec)
    write_json(RELEASE_INDEX, {"releases": releases})
    snap = config.RELEASES / meta["version"]
    snap.mkdir(parents=True, exist_ok=True)
    for name in ("county_ttm_current", "county_annual_current"):
        df = pd.read_parquet(config.STAGING / "build" / "processed" / f"{name}.parquet")
        (snap / f"{name}.csv.gz").write_bytes(gzip.compress(df.to_csv(index=False).encode(), mtime=0))
    write_json(snap / "release.json", {**rec, "validation_report": report})
    return rec


def _summary_markdown(entry: dict) -> str:
    lines = [f"## Building permits refresh: **{entry['outcome']}**", ""]
    for k in ("stored_through", "discovered_latest_county_month", "version", "data_through"):
        if entry.get(k):
            lines.append(f"- {k.replace('_', ' ')}: `{entry[k]}`")
    for k in ("new_files", "revised_files", "failed_downloads"):
        if entry.get(k):
            lines.append(f"- {k.replace('_', ' ')}: {len(entry[k])} ({', '.join(x.rsplit('/', 1)[-1] for x in entry[k][:10])})")
    if entry.get("error"):
        lines += ["", "### Error", "```", entry["error"][-3000:], "```"]
    v = entry.get("validation")
    if v:
        lines += ["", f"### Validation: {v['status']} ({v['counts']})", "", "| check | status | detail |", "|---|---|---|"]
        lines += [f"| {c['id']} | {c['status']} | {c['detail'][:180]} |" for c in v["checks"]]
    return "\n".join(lines) + "\n"


def _emit(entry: dict, report_path: Path | None) -> None:
    _append_log({k: v for k, v in entry.items() if k != "validation"} |
                {"validation_status": (entry.get("validation") or {}).get("status")})
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(entry, indent=1, sort_keys=True))
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(_summary_markdown(entry))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"outcome={entry['outcome']}\n")
            f.write(f"changed={'true' if entry['outcome'] in ('published', 'metadata_only') else 'false'}\n")
            f.write(f"publish={'true' if entry['outcome'] == 'published' else 'false'}\n")
            f.write(f"version={entry.get('version') or ''}\n")
            f.write(f"data_through={entry.get('data_through') or ''}\n")


def refresh(force: bool = False, backfill_from: int | None = None, report_path: Path | None = None,
            log=print) -> int:
    entry = {"started_at": utcnow(), "processing_version": PROCESSING_VERSION, "outcome": "failed"}
    store = None
    try:
        manifest = load_manifest()
        previous = latest_release()
        entry["stored_through"] = previous["data_through"] if previous else None
        known_unavailable = set(manifest.get("unavailable", {}))
        store = RawStore(manifest)

        cands = discover_all()
        bymonth = [c.period for c in cands if c.dataset == "bps_county" and c.series == "y"]
        entry["discovered_latest_county_month"] = max(bymonth)
        todo = [c for c in cands if needs_download(c, manifest) or
                (backfill_from is not None and c.period and int(c.period[:4]) >= backfill_from)]
        log(f"discovered {len(cands)} source files; {len(todo)} new or changed on the server")
        res = fetch_into(store, todo, log=log) if todo else {"new": [], "revised": [], "unchanged": [], "failed": []}
        entry["new_files"], entry["revised_files"] = res["new"], res["revised"]
        failures = dict(store.failures)
        entry["failed_downloads"] = sorted(failures)
        mark_unavailable(manifest, {c.key: c for c in cands}, failures)
        new_failures = sorted(set(failures) - known_unavailable)
        if new_failures:
            raise SourceError("Download failed for: " + "; ".join(f"{k}: {failures[k]}" for k in new_failures))

        digest = build.inputs_digest(store)
        if previous and previous["inputs_sha256"] == digest and not force:
            if store.staged:  # same bytes under a new server timestamp: record the metadata only
                store.promote()
                entry["outcome"] = "metadata_only"
            else:
                entry["outcome"] = "no_change"
            log("no new or revised Census data; published dataset unchanged")
            return 0

        b, out, report = build_and_validate(store, previous, log=log)
        entry["validation"] = report
        entry["version"] = b.notes["meta"]["version"]
        entry["data_through"] = b.notes["meta"]["data_through"]
        if report["status"] != "pass":
            failed = [c for c in report["checks"] if c["status"] == "fail"]
            raise RuntimeError("Validation failed: " + "; ".join(f"{c['id']}: {c['detail']}" for c in failed))

        changes = {"new": res["new"], "revised": res["revised"]}
        store.promote()
        write_release(b.notes["meta"], report, changes)
        promote_outputs(out, finalize_meta(b.notes["meta"], report, load_releases()))
        entry["outcome"] = "published"
        log(f"published {entry['version']} (data through {entry['data_through']})")
        return 0
    except Exception as e:  # noqa: BLE001 - every failure must be logged and reported
        entry["error"] = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
        log(f"REFRESH FAILED: {type(e).__name__}: {e}")
        if store is not None:
            store.discard()
        shutil.rmtree(config.STAGING / "build", ignore_errors=True)
        return 1
    finally:
        entry["finished_at"] = utcnow()
        _emit(entry, report_path)


def rebuild(log=print, report_path: Path | None = None) -> int:
    """Offline rebuild of the published artifacts from committed raw files (CI deploys)."""
    store = RawStore(load_manifest())
    releases = load_releases()
    b, out, report = build_and_validate(store, None, log=log)
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=1))
    if report["status"] != "pass":
        for c in report["checks"]:
            if c["status"] == "fail":
                log(f"FAIL {c['id']}: {c['detail']}")
        shutil.rmtree(out, ignore_errors=True)
        return 1
    meta = finalize_meta(b.notes["meta"], report, releases)
    if meta["release"] is None:
        log(f"warning: build {meta['version']} does not match a recorded release; run `refresh` to record one")
    promote_outputs(out, meta)
    log(f"built {meta['version']} (data through {meta['data_through']}); validation {report['counts']}")
    return 0
