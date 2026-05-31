# Repository Instructions Template

Replace bracketed values before writing this into a target repository.

This repository follows the engineering coding standard in `[docs/engineering-standard.md]`.

Assistant workflow:
1. Inspect the repository and current toolchain.
2. Summarize gaps against the engineering standard.
3. Ask only targeted clarification questions.
4. Add or update files, hooks, scripts, docs, and CI.
5. Run verification and summarize results.

Read first:
- `[docs/engineering-standard.md]`
- `[.github/hooks/quality-guard.mjs]` when present
- `[.pi/extensions/quality-guard.ts]` when present

Run standard checks with:
- Fast: `[./scripts/run-coding-standard.sh --mode fast]`
- Full: `[./scripts/run-coding-standard.sh --mode full]`
- CI: `[./scripts/run-coding-standard.sh --mode ci --strict]`

Special rules:
- Keep `[package manager]` as the canonical workflow unless explicitly changed.
- Use the strictest practical types. Avoid `any`, `unknown`, broad casts, dynamic containers, and ignored type errors unless no precise type can be expressed.
- Do not weaken lint or typecheck config to pass checks. Do not add broad disables. If a waiver is unavoidable, keep it line-local and document the concrete reason.
- Keep the universal quality guard installed. AI file changes must run the existing linter/check when one is detectable; if none exists, the hook passes silently.
- Do not read, search, list, or change `.env` when it exists. Use `.env.example` for documenting required variables.
- Use warning mode first for heuristic AI-risk scripts on legacy repos.
- Keep pre-commit fast; heavy checks belong in CI/nightly.
- Do not add competing tools when the existing formatter, linter, type checker, test runner, or CI command can be extended.
