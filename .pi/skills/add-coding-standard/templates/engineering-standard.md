# Engineering Standard Template

Replace bracketed values before writing this into a target repository.

- Profile: [Baseline | Standard | Hardened]
- Runtime: [frontend | backend | worker | library | monorepo | mixed]
- Package manager/environment: [repo canonical manager]
- Data classification: [Public | Internal | Confidential | Restricted]
- Fast local check: `[command]`
- Full local check: `[command]`
- CI verification: `[command or workflow]`
- Standard executor: `[./scripts/run-coding-standard.sh --mode fast|full|ci|pre-commit]`
- AI hook: `[.pi/extensions/pi-quality-guard.ts]` runs an existing linter/check after AI file changes and no-ops when no linter exists.
- Default policy: inspect -> gap analysis -> targeted questions -> implement -> verify.
- Typing policy: use the strictest practical types. Avoid `any`, `unknown`, broad casts, dynamic containers, and ignored type errors unless no precise type can be expressed; isolate unavoidable escape hatches behind typed boundaries.
- Lint policy: lint and typecheck rules are quality gates. Do not weaken config or add broad disables to pass staged checks. Any unavoidable waiver must be line-local, justified, and narrower than a code-level fix.
- Secret policy: existing `.env` files are blocked from AI read and mutation tools. Document required variables in `.env.example`.
- Cleanup policy: review stale tests, fixtures, snapshots, mocks, helper files, and generated artifacts after production renames, removals, or major refactors.
- AI-risk policy: start heuristic checks in warning mode on legacy repos; promote to blocking CI after cleanup.
