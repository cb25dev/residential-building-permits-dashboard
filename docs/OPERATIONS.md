# Operations runbook

## How the automatic refresh works

`.github/workflows/refresh-data.yml` runs daily at 13:23 UTC and can also be started by hand.

1. **Discover**: read the live Census directory listings for county files, state files,
   PEP dataset vintages and the configured boundary vintage
   ([`sources.py`](../scripts/bpsdash/sources.py)). No release date is assumed.
2. **Compare**: a file needs downloading if it is not in `data/raw/manifest.json`, if its
   server timestamp changed, or if it was previously unavailable.
3. **Download** into `data/.staging/raw`. Each file is content-checked (no HTML error
   pages) and hashed. Same bytes under a new timestamp count as metadata only. Different
   bytes count as a **revision**, and the prior hash is kept in the manifest.
4. **Decide**: the version id is the latest data month plus a SHA-256 over all input hashes
   and the processing version. If it equals the last release, the run exits successfully
   and nothing changes.
5. **Build** every artifact from raw files into `data/.staging/build`. All periods are
   recomputed, so a revised historical file automatically flows through every affected
   window.
6. **Validate** with 23 checks. Any failure stops here: staged files are discarded, the job
   fails, GitHub emails the repository owner, and the live site keeps the last good dataset.
7. **Promote**: move raw files into place, write `data/releases/index.json` plus a snapshot
   (`data/releases/<version>/`), append to `data/logs/refresh-log.jsonl`, commit, and push.
8. **Deploy**: `deploy.yml` rebuilds from the committed raw files (offline), re-validates,
   runs all tests including browser smoke tests, and publishes to GitHub Pages.

Every attempt is logged in three places:
* the Actions run, whose job summary has a table of all checks;
* a `refresh-report-<run id>` artifact, kept 90 days;
* `data/logs/refresh-log.jsonl` in the repository, for attempts that changed data.

Every published dataset version is recorded in `data/releases/index.json`.

New PEP vintages are detected the same way: the newest `popest/datasets/YYYY-YYYY/`
directory whose county file exists. Earlier vintages stay in `data/raw/population/` for
reproducibility, and the release notes record the change.

## Manual refresh

GitHub → **Actions** → **Refresh Census data** → **Run workflow**. The options are:

* `force`: rebuild and re-validate even if nothing changed (e.g. after a code fix).
* `backfill_from`: re-download and re-verify every file from that year on.

Locally: `make refresh`. This uses the same code path. It publishes into `public/data`
and records a release; commit the results to make them permanent.

There is deliberately no "refresh" button in the website. The site is static; refreshes
happen only server-side in GitHub Actions.

## Diagnosing a failed update

1. Open the failed run. The job summary lists every validation check with its status and
   detail, and the error block shows the exception.
2. Download the `refresh-report` artifact for the full JSON (new, revised and failed
   files, validation detail).
3. Reproduce locally: `make refresh`, or `make validate` to see the checks without publishing.

| Symptom | Likely cause | Action |
|---|---|---|
| `SchemaError: header row ... changed` | Census changed the file layout | Inspect the new file, update `permits.py` (header constants and column mapping), add a fixture test, and bump `PROCESSING_VERSION` |
| `Download failed ... HTML page instead of a data file` | Census firewall or outage | Usually transient; the next daily run retries. Files that stay unavailable are recorded and only warned about |
| `national_recon` failed | County files no longer sum to the U.S. total | Possible methodology change; read the Census announcements before loosening any tolerance |
| `coverage_regime` failed | The latest month's county files are partial | Same as above; the dashboard keeps the previous month |
| `geo_join` failed | New county codes not in the boundary vintage | Update `GEO_VINTAGE` in `config.py` (next section) |
| County files newer than state files | State files used for verification aren't posted yet | Not a failure: the build holds at the last verifiable month and warns |
| Push rejected | Branch protection on `main` | Allow `github-actions[bot]` to push, or change the workflow to open a pull request |

## Backfilling history

* Re-verify everything: run the workflow with `backfill_from = 2000` (or `make refresh`
  after `python -m bpsdash refresh --backfill-from 2000`).
* Extend history earlier: lower `HISTORY_START_YEAR` in `config.py` and run a refresh;
  missing files are discovered and downloaded. Monthly files before 2022 are labeled
  partial automatically.

## When Census changes its files

* **Layout**: the parser fails loudly. Update the header constants and the
  `NUMERIC`/`UNIT_COLS` mapping in `permits.py`, add a synthetic fixture with the new
  layout to `tests/python/fixtures/`, and run `make test`.
* **Location or naming**: update the URLs and regexes in `config.py` and
  `sources.classify_bps_name` (covered by `tests/python/test_sources.py`).
* **New county geography** (e.g. a new borough): set `GEO_VINTAGE` to the boundary year
  that contains it and run a refresh. Codes that disappear become legacy history.
* **Population program rebasing** (e.g. a `2030-2031` directory after the next census):
  discovery picks the newest end year automatically. Confirm the column names
  (`POPESTIMATEYYYY`) still match `population.py`.

## Local environment notes

* Python: `.venv` (`python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`).
  Run modules with `PYTHONPATH=scripts`; the Makefile does this. On macOS, Python 3.13+
  ignores `.pth` files carrying the Finder "hidden" flag, which iCloud-synced folders
  can set, so editable installs are not relied on.
* Node: `./scripts/setup-node.sh` installs Node 22 LTS into `.tools/node`, verified
  against the published checksums.
* Keep the working copy **outside** iCloud-synced folders (Desktop and Documents when
  "Desktop & Documents" sync is on). Syncing `node_modules`, `.venv` and the data
  directories makes builds far slower and can create conflict copies such as
  `data/processed 3`.
