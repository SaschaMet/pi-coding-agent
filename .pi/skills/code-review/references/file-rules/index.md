# File-Type Rule Docs

Rule docs add a file-type checklist to the review. The coordinator matches each reviewable file against the
table below and passes only the matched doc paths to the reviewer. The reviewer applies each doc to its
matching files inside the existing lenses and caps; a rule doc never adds a category.

| Order | Glob | Rule doc |
| --- | --- | --- |
| 1 | `.github/workflows/**/*.{yml,yaml}` | [github-workflows.md](github-workflows.md) |
| 2 | `**/package.json` | [package-json.md](package-json.md) |
| 3 | `**/*.{ts,tsx,js,jsx,mjs,cjs}` | [ts-js.md](ts-js.md) |
| 4 | `**/*.{json,json5,yml,yaml}` | [config-keys.md](config-keys.md) |

- Match paths relative to the repository root. `**/` also matches zero folders.
- First match wins: a file gets at most one rule doc.
- A file that matches no row gets no rule doc. Markdown and other types stay on the generic lenses.
- Match only reviewable files. Files removed by file selection (generated, vendored, lockfiles, secret
  files) are never matched.

## Source

- Adapted from alibaba/open-code-review, commit `ebb69835a3a2d25468b6a68ba6092b9b8fe6bcb0`, folder
  `internal/config/rules/`. Apache-2.0; see [LICENSE](LICENSE).
- adapted: curated and rewritten. Style-only items were dropped. Defect items were rewritten and tagged with
  the lens that owns them.
