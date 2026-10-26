"""Command line: python -m bpsdash {refresh,build,validate,discover,status}."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import config


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="bpsdash", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("refresh", help="check Census for new/revised files; build, validate and publish")
    r.add_argument("--force", action="store_true", help="rebuild and re-validate even if inputs are unchanged")
    r.add_argument("--backfill-from", type=int, metavar="YEAR",
                   help="re-download and re-verify every source file from this year on")
    r.add_argument("--report", type=Path, default=Path("refresh-report.json"))

    b = sub.add_parser("build", help="offline rebuild of published artifacts from committed raw files")
    b.add_argument("--report", type=Path, default=None)

    sub.add_parser("validate", help="build into staging and print the validation report (publishes nothing)")
    sub.add_parser("discover", help="list what Census currently publishes vs what is stored")
    sub.add_parser("status", help="show the current release and raw-store summary")

    a = p.parse_args(argv)
    if a.cmd == "refresh":
        from .refresh import refresh
        return refresh(force=a.force, backfill_from=a.backfill_from, report_path=a.report)
    if a.cmd == "build":
        from .refresh import rebuild
        return rebuild(report_path=a.report)
    if a.cmd == "validate":
        import shutil
        from .refresh import build_and_validate, latest_release
        from .sources import RawStore, load_manifest
        _, out, report = build_and_validate(RawStore(load_manifest()), latest_release())
        shutil.rmtree(out, ignore_errors=True)
        for c in report["checks"]:
            print(f"[{c['status'].upper():4}] {c['id']}: {c['detail']}")
        print(report["status"].upper(), report["counts"])
        return 0 if report["status"] == "pass" else 1
    if a.cmd == "discover":
        from .sources import discover_all, load_manifest, needs_download
        m = load_manifest()
        cands = discover_all()
        todo = [c for c in cands if needs_download(c, m)]
        ys = sorted(c.period for c in cands if c.dataset == "bps_county" and c.series == "y")
        stored = sorted(v["period"] for v in m["files"].values() if v["dataset"] == "bps_county" and v["series"] == "y")
        print(f"latest county YTD file at Census: {ys[-1]}; stored: {stored[-1] if stored else None}")
        print(f"{len(cands)} files discovered, {len(todo)} new or changed:")
        for c in todo[:50]:
            print(f"  {c.key}  (listed {c.listing_last_modified})")
        return 0
    if a.cmd == "status":
        from .refresh import latest_release
        from .sources import load_manifest
        m = load_manifest()
        print(json.dumps({"latest_release": latest_release(), "raw_files": len(m["files"]),
                          "unavailable": list(m.get("unavailable", {}))}, indent=1))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
