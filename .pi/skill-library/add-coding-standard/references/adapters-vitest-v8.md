# Adapter: Vitest + V8

Use when the target repository uses Vitest with V8 coverage.

Recommended artifact:
- `coverage/lcov.info`

Useful scripts:
- `scripts/check_changed_lines_coverage_lcov.py`
- `scripts/guard_no_test_only_success.sh`
- `scripts/find_orphaned_tests.py`
- `scripts/find_stale_test_artifacts.py`
- `scripts/detect_test_reward_hacking.py`

If these scripts do not exist, add only the ones required by the selected profile and repo risk. Keep them deterministic and non-interactive.
