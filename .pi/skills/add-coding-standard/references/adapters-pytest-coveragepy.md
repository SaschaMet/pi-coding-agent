# Adapter: pytest + coverage.py

Use when the target repository uses pytest and coverage.py.

Recommended coverage command:

```bash
pytest --cov=src --cov-context=test --cov-report=xml --cov-report=term-missing
```

Useful scripts:
- `scripts/find_tests_with_no_prod_coverage_coveragepy.py`
- `scripts/guard_no_test_only_success.sh`
- `scripts/find_orphaned_tests.py`
- `scripts/find_stale_test_artifacts.py`
- `scripts/detect_test_reward_hacking.py`

If coverage contexts are unavailable or too expensive for the repo, document the limitation and keep dead-test detection as a manual or warning-mode check.
