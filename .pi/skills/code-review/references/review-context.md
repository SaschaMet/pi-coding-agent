# Review Context

What to capture in Steps 1-3, and what goes in each block the specialist passes consume. Read once, before
Step 1. The parent captures all of this; specialist passes never re-run `git status` or `git diff`.

## Step 1 — Capture checklist

Beyond `git status` and `git diff`, and reviewing only added/modified lines plus the surrounding code needed
to prove impact:

- **Change intent, touched public contracts, affected runtime paths** — establish these before judging any
  finding.
- **Test-only classification** — tests, snapshots, or fixtures changed while no implementation files changed.
- **File size** — current line counts for changed source files, and whether the diff pushes any file over
  250 lines.
- **Lint and type bypasses** — scan added/modified lines *and* config for new or expanded lint ignore rules,
  lint-disable comments, ignored type errors, weakened lint config, and broad ignore patterns. Equivalents
  to catch: `eslint-disable`, `biome-ignore`, `// @ts-ignore`, `// @ts-expect-error`, `type: ignore`,
  `# noqa`. These belong to Code Quality and are findings unless the diff shows explicit
  repository-owner/user approval.
- **Trust boundary** (only when the Security pass will run) — does the diff touch a new or changed entry
  point, authn/authz, input parsing/validation/deserialization, file/network/subprocess I/O,
  secret/credential/token handling, or a security-relevant config default? Also check for `THREAT_MODEL.md`
  at the repository root. Both feed Threat Context in Step 4.

## Step 2 — Project Validation Context

Sources: `package.json` scripts when present; top-level and near-root `*.toml`, `*.yaml`, `*.yml` and
similar for task/test/lint tool config; `README*` and the nearest docs sections describing
test/lint/typecheck/format/check workflows.

The block contains:

- **Preferred commands** — exact command strings, runnable as written, including the path convention for
  targeting a single test file.
- **Ordering constraints** — required command sequencing, if documented.
- **Tool names and config hints** — for example `vitest`, `pytest`, `cargo test`, `ruff`, `eslint`, `biome`.
- **Explicit "do not run" or environment constraints** from the docs.

## Step 3 — Review Context block

- Changed files and symbols.
- Intended user-visible behavior, when inferable from the request, branch, commits, PR text, or tests.
- Public APIs, schemas, config keys, CLI flags, event names, and database migrations touched by the diff.
- Surrounding interfaces and callers needed to verify compatibility.
- **Blast radius** — for changed public/exported symbols, a cheap grep-based caller/reference count,
  repo-wide, not a full call graph. Note any symbol with a wide call-site count, or that is exported/public
  API, as high blast radius. QA and Code Quality use this to weight severity when the diff also changes
  that symbol's signature or behavior.
- **New invariants the diff introduces** — when the diff adds a shared constant, threshold, buffer, or
  cache/memoization pattern, grep the surrounding function/module for call sites that perform the same
  conceptual check or would need the same pattern, and note any that do not adopt it. Inconsistent adoption
  is reportable even when those call sites are unchanged. This covers only invariants the diff itself
  introduces — when it introduces none, skip the clause rather than expanding into a whole-repo audit.
- **CARDS notes** when the diff touches design: clarity of intent, dependency direction, change isolation,
  invalid-state prevention, and separation of domain/orchestration/IO concerns.
- **Graphify context** when available: relevant paths, explained nodes, god nodes, surprising connections,
  and community-boundary crossings touched by the diff.
- **Explicit focus areas** requested by the user.
