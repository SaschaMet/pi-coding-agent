# GitHub Actions snippets

Use these as fragments only. Adapt package manager, cache, branch base, and script names to the target repo.

## TypeScript quality job

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm run check:fast
- run: pnpm run test:coverage
- run: python3 scripts/check_changed_lines_coverage_lcov.py origin/main coverage/lcov.info
- run: python3 scripts/detect_test_reward_hacking.py origin/main
```

## Python quality job

```yaml
- run: uv sync --dev
- run: make check-fast
- run: make test-cov
- run: python3 scripts/find_tests_with_no_prod_coverage_coveragepy.py
- run: python3 scripts/detect_test_reward_hacking.py origin/main
```
