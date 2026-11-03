# Verifier recipes

Load from SKILL.md step 3. Pick the recipe for the artifact type, reuse the project's own tooling inside it, and keep the contract: non-interactive, cwd = candidate directory, exit 0, last stdout line = one JSON object with one number per criterion.

## Contents

- Shape of every verifier
- Unit or integration tests (count, duration, coverage)
- Pixel diff against a reference (pages, components, images)
- End-to-end flows (Playwright)
- Web performance (Lighthouse, bundle size)
- Benchmarks and scripts (wall time, memory, throughput)
- Text (length, readability, forbidden patterns, keyword presence)
- Reverse engineering (match a reference behaviour)
- Noise and repeat
- Anti-patterns

## Shape of every verifier

```python
#!/usr/bin/env python3
import json, subprocess, sys
# Run tools with cwd = os.getcwd() (hc.py sets it to the candidate dir).
# Print diagnostics to stderr; the LAST stdout line must be the JSON object.
def main():
    scores = {}
    ...                         # fill scores[<criterion name>] = <number>
    print(json.dumps(scores))   # last line
if __name__ == "__main__":
    main()
```

Install nothing from inside the verifier. If a tool is missing, exit 1 with the install command on stderr; `hc.py` reports it as exit 3.

## Unit or integration tests

Criteria: `tests_passing` (higher, floor = baseline), `tests_failing` (lower, target 0), `test_wall_ms` (lower, repeat 3), `coverage_pct` (higher).

- Vitest: `npx vitest run --reporter=json --outputFile=/tmp/hc-vitest.json`, then read `numPassedTests`, `numFailedTests`, and the `startTime`/`endTime` span. Coverage: `--coverage --coverage.reporter=json-summary` and read `coverage/coverage-summary.json` → `total.lines.pct`.
- pytest: `pytest -q --json-report --json-report-file=/tmp/hc-pytest.json` (plugin `pytest-json-report`) or parse `pytest -q | tail -1`.
- Bun test: `bun test --reporter=junit --reporter-outfile=/tmp/hc.xml`, parse `tests`/`failures` attributes.

Always run the project's documented command from its documented directory (this repo: `bun run test` from the root, never from `web/`).

## Pixel diff against a reference

Criteria: `pixel_diff_pct` (lower, target ≤ 0.1), optionally `layout_shift` or `dom_depth`.

1. Produce the candidate image deterministically: Playwright `page.screenshot({fullPage: true, animations: 'disabled'})` at a fixed viewport and device scale, fonts loaded (`await page.evaluate(() => document.fonts.ready)`), `prefers-reduced-motion` set.
2. Compare to the reference with `pixelmatch` (Node) or `Pillow` + `ImageChops.difference` (Python): `diff_pct = changed_pixels / total_pixels * 100`.
3. Store the reference outside the worktrees (`$RUN/reference.png`); the candidate never gets to edit it.

For "match this design" tasks the reference is the mockup exported at the same viewport. For "do not regress" tasks it is the baseline screenshot taken at `init`.

## End-to-end flows

Criteria: `e2e_passing` (higher, floor), `flow_duration_ms` (lower), `a11y_violations` (lower, target 0, via `@axe-core/playwright`), `console_errors` (lower, target 0).

`npx playwright test --reporter=json > /tmp/hc-e2e.json`, read `stats.expected`, `stats.unexpected`, `stats.duration`. Give the verifier its own `PLAYWRIGHT_HTML_REPORT`/output dir under `$RUN` so parallel candidates do not collide.

## Web performance

Criteria: `lcp_ms`, `cls`, `inp_ms`, `tbt_ms` (all lower), `perf_score` (higher), `js_bytes` (lower).

- Lighthouse: `npx lighthouse <url> --output=json --output-path=/tmp/hc-lh.json --chrome-flags="--headless=new" --throttling-method=simulate`, read `audits.largest-contentful-paint.numericValue`, `audits.cumulative-layout-shift.numericValue`, `categories.performance.score * 100`. Set `repeat: 3` or `5`.
- Bundle size: sum of `dist/**/*.js` bytes after the project's build command, or `brotli -c file | wc -c` for compressed size.
- Each candidate needs its own port or a build that writes to its own `dist/`; start the server inside the verifier and stop it in `finally`.

## Benchmarks and scripts

Criteria: `wall_ms` (lower, repeat 5), `peak_rss_mb` (lower), `throughput_per_s` (higher), `output_sha_match` (higher, floor 1: the output must stay identical).

Time with `time.perf_counter()` around `subprocess.run`, memory with `/usr/bin/time -l` (macOS, "maximum resident set size") or `-v` (Linux). Hash the produced output and compare to the baseline hash stored at `init` so a "faster" candidate that changes the result is invalid.

## Text

Criteria that have numbers: `words` (within a band: two criteria, `words_min` higher and `words_max` lower), `flesch_de` or `flesch_reading_ease` (higher; `textstat` package), `sentences_over_25_words` (lower), `exclamation_marks` (lower, target 0), `em_dashes` (lower, target 0), `forbidden_phrases` (lower, target 0, list from the voice skill), `required_terms_present` (higher, floor), `links_broken` (lower, target 0), `title_chars` (band), `meta_chars` (band).

A skill with a pass/fail gate (`$helpful-content`) becomes a criterion only if its verdict is produced by a command; a judgement from the model in the loop is not a score. Readability and pattern counts are.

## Reverse engineering

Goal: a candidate implementation must behave like a reference (binary, API, legacy function).

Criteria: `cases_matching` (higher, target = total cases), `max_abs_error` (lower) for numeric outputs, `latency_ms` (lower).

Record the reference's outputs for a fixed input corpus once at `init` into `$RUN/corpus/`, then the verifier replays the corpus against the candidate and counts matches. Grow the corpus only between runs, never mid-climb.

## Noise and repeat

Timings vary by 5 to 20 % run to run on a laptop. Set `repeat` (median is scored), close other heavy processes, score timing candidates one at a time, and set targets with that noise in mind. If two consecutive baseline runs differ by more than the gain you hope for, the criterion cannot see the gain; fix the measurement before climbing.

## Anti-patterns

- A verifier that imports or executes files the candidate controls beyond the artifact itself (a planted `conftest.py` or `json.py` changes the number). Run Python with `-I`, pin the command and cwd.
- Reading the score from a file the worker wrote. The verifier computes, the worker only edits.
- A criterion whose target is "as high as possible". Every criterion needs a stop value; without it `targets_met` can never fire and the climb ends only on plateau or budget.
- A verifier that passes when the tool is missing (`try: ... except: scores = {...: 0}`). Fail loudly, exit 1.
