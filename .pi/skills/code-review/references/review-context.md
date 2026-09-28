# Review Context

What to capture in Steps 1-4, and what goes in the blocks the reviewer consumes. Read once, before Step 1.
The parent captures all of this; the reviewer never re-runs the unscoped `git status` or `git diff`. The
`Review Context` block is a manifest, not a report: it stays under 30 lines total. Details live in the files;
the reviewer reads the code itself.

## Step 1 — Capture checklist

Capture in this order. The order keeps secret-file contents out of every command output.

1. `git diff HEAD --name-only` and `git ls-files --others --exclude-standard` — the changed names, tracked
   (staged included) and untracked. `git status` adds each name's git state. None of these prints contents.
2. Sort the names per **File selection** below. What is left are the *reviewable files*.
3. `git diff HEAD --numstat -- <reviewable files>`, plus `wc -l` of untracked reviewable files — the
   changed lines. Binary files count 0.
4. The **context diff** — `git diff HEAD -U1 -- <reviewable files>` under 300 changed lines, `-U0` at 300 or
   more. Never run an unscoped `git diff`, `git diff HEAD`, or `git diff HEAD --stat`.

`HEAD` includes staged changes. The one context line shows whether a changed line sits inside an `if`, a
loop, or a `try`; at `-U0` the reviewer must open the file to learn that. Read further surrounding code on
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
  security-relevant config default? Also check for `THREAT_MODEL.md` at the repository root. A lockfile-only
  change or any secret-file finding answers yes.
  **Always capture this, even when Security was not requested** — it is what decides whether the Security
  lens runs at all (SKILL.md **Lens Selection**), and it feeds Threat Context in Step 5. A negative answer
  here removes the Security lens and its verifier from the review, which is the single largest saving
  available on a diff with no security surface.
- **Rule-doc match** — match each reviewable file against the ordered table in `file-rules/index.md`;
  first match wins, and an unmatched file gets no doc. Keep the list of matched doc paths, each once, for the
  Step 6 spawn prompt. A diff that touches only Markdown matches none.

Note which of these the diff makes moot: the test-only classification and the trust-boundary answer both
gate lens selection in Step 2.

### File selection

Sort every changed name into one class. First match wins, top to bottom. A bare file name matches in any
folder. Tests are never excluded.

| Class | Paths | Handling |
| --- | --- | --- |
| secret file | `.env`, `.env.*` except `.env.{example,sample,template,dist,defaults,vault}`, `.{npmrc,netrc,pypirc,dockercfg}`, `_netrc`, `**/.ssh/**`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519` | Secret files, below |
| minified/build output | `**/*.min.{js,css}`, `**/dist/**`, `**/build/**`, `**/.next/**`, `**/coverage/**` | excluded |
| generated | `**/*.generated.*` | excluded |
| vendored | `**/vendor/**`, `**/node_modules/**` | excluded |
| lockfile | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `npm-shrinkwrap.json`, `bun.lock`, `bun.lockb` | Lockfiles, below |
| reviewable | everything else, tests included | dispatched to the reviewer |

- **Excluded:** never read the file, never pass it to the reviewer, never match it to a rule doc. Add one
  scope note per class: `excluded: <class>: <files>`.
- **Lockfiles:** never reviewed line by line, never in the reviewer's file list, never matched to a rule doc.
  The matching manifest is the `package.json` in the same folder.
  - Manifest unchanged: Review Context records `lockfile-only change: <lockfile>`, and the trust-boundary
    answer is yes, because the change can swap what gets installed. The note tells the Security lens to
    check only added registry or tarball URLs and new package names, with one scoped
    `git diff HEAD -U0 -- <lockfile> | grep -nE '^\+.*(https?://|"resolved"|tarball)'`.
  - Manifest also changed: the manifest is reviewed as usual. Review Context records
    `lockfile follows manifest change: <lockfile>`.
- **Secret files:** their contents never enter any context — the parent's, the reviewer's, or the verifier's.
  Only the step 1 name commands touch them, and the context diff lists reviewable files only. Never pass a
  secret file to a reviewer or a verifier.
  - `.env` or `.env.*`: a HIGH `security` finding by path alone. It shows up here only when it is tracked,
    staged, or not gitignored. Evidence: the path and its `git status` state. Run no command that names it.
  - Every other secret file: one count-only check,
    `grep -ciE '(_authtoken|_auth|password|passwd|secret|token|api[_-]?key)[[:space:]]*[=:]|BEGIN [A-Z ]*PRIVATE KEY' <file>`.
    It prints a number, never a line. Exit 1 with `0` is a clean result; exit 2 or no number is a failure.
    - count > 0: a HIGH `security` finding in any git state. Evidence: path, git status, and count.
    - count = 0: scope note `secret file checked by pattern: none found: <file>`.
    - check blocked or failed: scope note `secret file not checked: <file>`. The verdict cannot be `PASS`.
  - Recommendation for every secret-file finding: remove the file or add it to `.gitignore`, and rotate its
    secrets if it was ever committed.
  - The parent writes these findings itself, in the full schema, because no agent may see the file. They
    make the Security lens run, and they never go to the verifier.

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
  repo-wide, not a full call graph. Every repo-wide grep here uses the include list below. Note any symbol with a wide call-site count, or that is exported/public
  API, as high blast radius. The reviewer uses this to weight severity when the diff also changes that
  symbol's signature or behavior.
- **New invariants the diff introduces** — when the diff adds a shared constant, threshold, buffer, or
  cache/memoization pattern, grep the surrounding function/module for call sites that perform the same
  conceptual check or would need the same pattern, and note any that do not adopt it. Inconsistent adoption
  is reportable even when those call sites are unchanged. Covers only invariants the diff itself introduces —
  when it introduces none, skip the clause rather than expanding into a whole-repo audit. Use the include
  list below.
- **Include list** — repo-wide greps name source, type, schema, test, and doc extensions, so dotfiles and
  secret files never match:
  `grep -rn --exclude-dir=node_modules --exclude-dir=.git --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --include='*.mjs' --include='*.cjs' --include='*.json' --include='*.yml' --include='*.yaml' --include='*.md' --include='*.py' --include='*.go' --include='*.rs' --include='*.java' --include='*.proto' --include='*.graphql' --include='*.sql' '<symbol>' .`
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
