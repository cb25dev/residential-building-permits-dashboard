# Common tasks. Python runs from .venv with the pipeline package on PYTHONPATH;
# Node runs from the project-local .tools/node (see scripts/setup-node.sh).
PY := .venv/bin/python
export PYTHONPATH := scripts
export PATH := $(CURDIR)/.tools/node/bin:$(PATH)

.PHONY: setup refresh data validate status test test-py test-web e2e dev build preview clean

setup:            ## create .venv, install Node locally, install npm packages and the Playwright browser
	test -x $(PY) || python3 -m venv .venv
	$(PY) -m pip install -q --upgrade pip
	$(PY) -m pip install -q -r requirements.txt
	./scripts/setup-node.sh
	npm ci
	npx playwright install chromium

refresh:          ## check Census for new/revised files; build, validate, publish locally
	$(PY) -m bpsdash refresh --report data/.staging/refresh-report.json

data:             ## offline rebuild of public/data from committed raw files
	$(PY) -m bpsdash build

validate:         ## build into staging and print the validation report
	$(PY) -m bpsdash validate

status:
	$(PY) -m bpsdash status

test: test-py test-web

test-py:
	$(PY) -m pytest

test-web:
	npx vitest run

e2e: build        ## end-to-end browser tests against the production build
	npx playwright test

dev: data         ## local dev server at http://localhost:5173
	npm run dev

build: data       ## production bundle in dist/
	npm run build

preview: build    ## serve dist/ at http://localhost:4173
	npm run preview

clean:
	rm -rf dist data/.staging data/processed public/data test-results playwright-report
