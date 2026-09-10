# Refinement

Read this only when the first search returned no matches (exit 1) or snippets that do not answer the request.

## Decision table

| Situation | Action |
| --- | --- |
| Exit 1, no matches | Widen: drop the most specific keyword, use a shorter stem (`plan` instead of `planning`), try the other language (DE↔EN), try a related concept. |
| Too many matches, wrong notes | Narrow: combine 2-4 keywords, use an exact phrase (`--keywords "quarterly budget"`), raise `--threshold 90`. |
| Fuzzy false positives (wrong word matched) | Raise `--threshold 90` or `95`, or pass the exact word. |
| The note likely exists under a known title | Search the filename: pass the likely title word as a keyword — path matches score 130 and rank first. |
| Unsure whether the vault uses the user's term | Search the user's exact term first, then its synonym. Do not guess the vault's vocabulary. |

## Rules

- At most 2 refinement steps after the initial search (3 runs total).
- Never repeat a keyword set already tried.
- After 3 unsuccessful runs, stop and report: the keyword sets tried and the conclusion "no relevant note found". Do not keep looping.
