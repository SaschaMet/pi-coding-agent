# Review Context

What to capture in Steps 1-4, and what goes in the blocks the reviewer consumes. Read once, before Step 1.
The parent captures all of this; the reviewer never re-runs the unscoped `git status` or `git diff`. The
`Review Context` block is a manifest, not a report: it stays under 30 lines total. Details live in the files;
the reviewer reads the code itself.

## Step 1 — Capture checklist

Capture with `git status`, `git diff HEAD --stat`, and the **context diff** — `git diff HEAD -U1` under 300
changed lines, `git diff HEAD -U0` at 300 or more. `HEAD` includes staged changes; `git status` names
untracked files the diff cannot show. The one context line shows whether a changed line sits inside an `if`,
a loop, or a `try`; at `-U0` the reviewer must open the file to learn that. Read further surrounding code on
demand, only where needed to prove impact. Beyond the changed lines:

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
- **Trust boundary** — does the diff touch a new or changed entry point, authn/authz, input
  parsing/validation/deserialization, file/network/subprocess I/O, secret/credential/token handling, or a
  security-relevant config default? Also check for `THREAT_MODEL.md` at the repository root.
  **Always capture this, even when Security was not requested** — it is what decides whether the Security
  lens runs at all (SKILL.md **Lens Selection**), and it feeds Threat Context in Step 5. A negative answer
  here removes the Security lens and its verifier from the review, which is the single largest saving
  available on a diff with no security surface.

Note which of these the diff makes moot: the test-only classification and the trust-boundary answer both
gate lens selection in Step 2.

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

One block, passed whole to the reviewer. The whole thing stays under 30 lines. There are no per-pass
appendices — one agent applies every lens, so it needs one context.

- Changed files and symbols.
- Intended user-visible behavior, when inferable from the request, branch, commits, PR text, or tests.
- Public APIs, schemas, config keys, CLI flags, event names, and database migrations touched by the diff.
- **Explicit focus areas** requested by the user.
- **Graphify context** when available: relevant paths, explained nodes, god nodes, surprising connections,
  and community-boundary crossings touched by the diff.
- **Blast radius** — for changed public/exported symbols, a cheap grep-based caller/reference count,
  repo-wide, not a full call graph. Note any symbol with a wide call-site count, or that is exported/public
  API, as high blast radius. The reviewer uses this to weight severity when the diff also changes that
  symbol's signature or behavior.
- **New invariants the diff introduces** — when the diff adds a shared constant, threshold, buffer, or
  cache/memoization pattern, grep the surrounding function/module for call sites that perform the same
  conceptual check or would need the same pattern, and note any that do not adopt it. Inconsistent adoption
  is reportable even when those call sites are unchanged. Covers only invariants the diff itself introduces —
  when it introduces none, skip the clause rather than expanding into a whole-repo audit.
- **Surrounding interfaces and callers needed to verify compatibility** — name them (file plus symbol); the
  reviewer reads them. The compatibility-regression check has no input without this.
- **File size context** — changed files over 250 lines, and whether the diff pushed them over.
- **Lint/typecheck bypass scan results** from Step 1 (file, line, kind, approved or not).
- **CARDS notes** when the diff touches design: clarity of intent, dependency direction, change isolation,
  invalid-state prevention, and separation of domain/orchestration/IO concerns.

The Threat Context block (see `threat-model.md`) is built separately in Step 5 and passed alongside this one,
only when the Security lens survived selection.

When in doubt, name the file and symbol and let the reviewer read the code — do not paste long excerpts into
the block. At 30 lines you are choosing between a manifest and a report; choose the manifest.
