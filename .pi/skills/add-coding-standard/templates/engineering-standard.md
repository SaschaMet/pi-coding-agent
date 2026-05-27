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
- Default policy: inspect -> gap analysis -> targeted questions -> implement -> verify.
- Cleanup policy: review stale tests, fixtures, snapshots, mocks, helper files, and generated artifacts after production renames, removals, or major refactors.
- AI-risk policy: start heuristic checks in warning mode on legacy repos; promote to blocking CI after cleanup.
