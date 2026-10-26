# Test fixtures

Files named `synthetic_*` are **synthetic test fixtures**: hand-written values in the
exact Census file layouts, used only by unit tests. They never reach production data.
The integration tests in `test_pipeline_real_data.py` instead read the committed raw
Census files and compare pipeline output with values derived by hand from raw rows.
