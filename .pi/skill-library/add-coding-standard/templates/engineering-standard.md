# Engineering Standard Template

Replace bracketed values before writing this into a target repository.

- Profile: [Baseline | Standard | Hardened]
- Runtime: [frontend | backend | worker | library | monorepo | mixed]
- Package manager/environment: [repo canonical manager]
- Data classification: [Public | Internal | Confidential | Restricted]
- Fast local check: `[command]`
- Full local check: `[command]`
- CI verification: `[command or workflow]`
- Duplicate-code check: `[warning command or blocking threshold command, e.g. cpd . --reporters console,threshold --threshold N]`
- Standard executor: `[./scripts/run-coding-standard.sh --mode fast|full|ci|pre-commit]`
- AI hooks: `[.github/hooks/scripts/block-env-read.sh]` blocks `.env` access before tool use; `[.github/hooks/scripts/lint-on-session-end.sh]` runs an informational linter/check at session end and no-ops when no linter exists.
- Agent adapters: `[.claude/settings.json]`, `[Codex config/plugin hook snippet]`, `[.github/hooks/Copilot hook file]`, `[.pi/extensions/quality-guard.ts]`
- Default policy: inspect -> gap analysis -> targeted questions -> implement -> verify.
- CARDS architecture policy: keep intent clear; point dependencies toward stable domain/core code; keep small changes local; prevent invalid states by design; separate domain policy, orchestration, IO, presentation, and formatting. Preserve the existing architecture unless an approved spec changes it.
- Typing policy: use the strictest practical types. Avoid `any`, `unknown`, broad casts, dynamic containers, and ignored type errors unless the repository owner/user explicitly approves a typed-boundary exception.
- Lint policy: lint and typecheck rules are quality gates. AI agents must not weaken config, add or expand lint ignore rules, add lint-disable comments, add ignored type errors, or add broad ignore patterns to pass staged checks. If the tool is wrong, request explicit repository-owner/user approval before adding a line-local documented exception narrower than a code-level fix.
- Secret policy: existing `.env` files are blocked from AI read, search, list, and mutation tools. Document required variables in `.env.example`.
- Cleanup policy: review stale tests, fixtures, snapshots, mocks, helper files, and generated artifacts after production renames, removals, or major refactors.
- Duplicate-code policy: preserve existing clone tooling; otherwise use jscpd/cpd with generated/build/vendor/dependency ignores, warning mode for legacy cleanup, and blocking thresholds only after a baseline is chosen.
- AI-risk policy: start heuristic checks in warning mode on legacy repos; promote to blocking CI after cleanup.
