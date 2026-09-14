# Security review — `archify` skill installation

Date: 2026-09-14
Reviewer: PI coding agent (skillspector no-llm scan + adversarial read-only sub-agent)
Source: <https://github.com/tt-a1i/archify>, MIT, pinned commit `a07fa1d5b2a10cbea110c5a2be2817397a301cdc` (2026-09-13)
Installed to: `~/.pi/agent/skill-library/archify/` (65 files, 2.22 MB)

## Verdict

**Safe to install — conditions applied.** The 65-file minimum set is safe. Two conditions from the
adversarial review were both applied: (1) all 14 `examples/*.json` kept, (2) `delta/architecture-delta.mjs`
kept so `doctor` stays green. No `SKILL.md` edit was required.

## Trust model

An agent skill is high-trust: `SKILL.md` is read into the model context and its instructions are followed
implicitly; bundled scripts are executed by the agent via `node`. The review treated every shipped file as
untrusted input until verified.

## Method

1. `skillspector scan <dir> --no-llm` (v2.9.5) — static scan. Raw report: `archify-skill-scan-no-llm.md`
   (this directory; summary and disposition below).
2. LLM scan — **skipped** (no provider key in env: `SKILLSPECTOR_PROVIDER` / `OPENAI_API_KEY` /
   `ANTHROPIC_API_KEY` all unset). Accepted by the user.
3. Adversarial read-only sub-agent — independently verified/refuted the static findings, swept for
   prompt injection, and audited the planned exclusions.

## skillspector no-llm findings (disposition)

| Severity | Count | Disposition |
| --- | --- | --- |
| HIGH | 23 | All false positives (see below) |
| MEDIUM | 90 | All `RA2` — DOM-manipulation lines in the generated viewer's client-side JS (an artifact the user opens in a browser, not agent-executed code) |
| LOW | 10 | Scope-creep / informational |

HIGH findings, all confirmed false positives with file:line evidence:

- **PE3 "Credential Access"** `bin/archify.mjs:71` — `spawnSync(process.execPath, args)` spawning the same
  node binary with in-skill renderer scripts. Every call site passes only `skillRoot`-built paths. No
  user-controlled binary.
- **P2 "Hidden Instructions"** `assets/template.html` (~4978/5230), `renderers/shared/utils.mjs:12`, and the
  `examples/*.html` copies — descriptive HTML comments (keyboard-shortcut docs, SVG `<defs>`), not
  agent-directed instructions.
- **YR4** `assets/template.html:145` (and the `examples/*.html` copies) — YARA rule
  `agent_skill_mcp_tool_poisoning_metadata` fires on the base64-embedded JetBrains Mono font blob
  (OFL-licensed, covered by `THIRD_PARTY_NOTICES.md`). Not tool/metadata poisoning.
- **RA2 "Session Persistence"** (90 MEDIUM) — DOM-manipulation lines (`querySelectorAll`,
  `addEventListener`, `textContent`) in the generated viewer's client-side JS. The viewer manages its own
  in-page UI state; it is an artifact the user opens in a browser, not agent-executed code, and it holds no
  cross-session state.

## Adversarial sub-agent review

- **Prompt injection:** none found in `SKILL.md`, `references/*.md` (authoring-contract, delivery-contract,
  brand-marks, viewer-runtime), `renderers/workflow/README.md`, or `schemas/README.md`. `SKILL.md` is
  restrictive (truthful reporting, "a non-zero exit can never be described as success", never claim
  unperformed visual review). No hidden zero-width / bidi characters in any doc.
- **Network surfaces (only two, both hardened):**
  - `scripts/check-update.mjs` — **excluded from install**. Would fetch a manifest via `globalThis.fetch`,
    URL pinned to a constant (`update-contract.mjs:3`), 32KB cap, redirect disabled, JSON/UTF-8 validated,
    never downloads or executes an update.
  - `renderers/shared/brand-marks.mjs` `brands capture <url>` — user-initiated; SSRF guards (private-IP
    block, standard ports only), 256KB/1MB caps, max 3 redirects with per-hop re-validation, 4.5s timeout,
    DNS-rebinding closed by a pinned lookup.
- **Child-process surfaces:** `visual-check.mjs` launches system Chrome headless via CDP with hardened flags
  (`--no-sandbox` only if root or `ARCHIFY_CHROME_NO_SANDBOX=1`); `preview.mjs` binds `127.0.0.1` only with
  host-header validation; `open-artifact.mjs` spawns the OS file opener on a fixed argument array;
  `repository-evidence.mjs` runs read-only `git` (`rev-parse`, `remote get-url`, `cat-file`);
  `bin/archify.mjs` spawns node for in-skill scripts only.
- **Generated data files are inert:** `generated-validators.mjs` = minified ajv standalone (5 validator
  exports, 0 dangerous constructs); `generated-brand-marks.mjs` = frozen Simple Icons data array.
- **Viewer JS (in `template.html`):** zero `fetch`/XHR/WebSocket/`eval`/`new Function`; only external refs
  are the w3.org SVG namespace and the JetBrains license URL.

## Exclusion check (all pass)

| Excluded | Result |
| --- | --- |
| `scripts/check-update.mjs` + `update-contract.mjs` + `skill-release.json` | Pass — no static/dynamic import from `bin/archify.mjs`; `SKILL.md` degrades gracefully ("If the command cannot run, continue without mentioning the check") |
| `delta/architecture-delta.mjs` | **Kept** (inert, pure SVG string ops) so `doctor` exits 0 |
| `scripts/generate-*.mjs` | Pass — dev-only; generated outputs committed |
| `brand-marks/` | Pass — runtime uses self-contained `renderers/shared/generated-brand-marks.mjs` |
| `package.json` + lockfile | Pass — zero runtime npm deps (all imports are `node:` builtins or relative) |
| `examples/*.html` | Pass — inert rendered artifacts; not required by `doctor` or any kept code path |

## Installed minimum set (65 files)

Root: `SKILL.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`. `assets/`: `template.html`,
`JetBrainsMono-OFL.txt`. `bin/`: `archify`, `open-artifact`, `preview`, `visual-check` (.mjs).
`examples/`: 14 `.json` (no `.html`). `migrations/workflow-v2.mjs`, `recipes/scenarios.mjs`,
`delta/architecture-delta.mjs`. `references/`: 4 `.md`. `renderers/`: 26 files (17 shared + 5 per-type
renderers + workflow compiler + `workflow/README.md`). `schemas/`: 6 `.json` + `README.md`.
`scripts/`: `check-render-output.mjs`, `render-examples.mjs`.

## Verification results (2026-09-14)

- Library link check: all `archify` relative links resolve (the stock check command reports 3 false
  positives because it does not strip `#fragment`; a fragment-aware re-check confirms all resolve).
  Pre-existing `init-project` dangling links are unrelated.
- `node bin/archify.mjs doctor` → exit 0, all 16 checks green (Node v24.18.0).
- Smoke (temp dir): `demo` rendered `web-app.architecture.json` → 811KB HTML (exit 0);
  `validate architecture … --quality showcase --json` → 0 issues (exit 0);
  `deliver … --quality showcase --json` → `ok:true`, 9/9 checks, SHA-256 receipts for spec (3793 B) and
  artifact (811157 B) (exit 0); `visual-check` → no overflow, readability OK, screenshot + contact-sheet
  sidecars (exit 0).

## Residual notes

- `visual-check` requires a system Chrome/Chromium (present on this host). Without it, `visual-check`
  reports an environmental failure — not a skill defect.
- The skill's only agent-driven network action is `brands capture <url>` on a user-provided URL
  (SSRF-hardened). No routine/automatic network calls remain after excluding the update notifier.
