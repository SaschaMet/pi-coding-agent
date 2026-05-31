# Reference: Core Standard

Use this reference on every run. It defines profile selection and universal controls.

## Profiles

### Baseline
For small tools, internal automations, and low-risk libraries.
Required:
- formatting
- linting
- strict typing
- narrowest practical static types
- unit tests for core logic
- secret scanning
- dependency audit

### Standard
For production apps, APIs, services, and internal applications with business data.
Additional requirements:
- integration tests
- coverage threshold set to the current measured total first, then ratcheted upward over time
- mutation tests for critical modules
- architecture documentation
- privacy classification
- AI-risk guard scripts in warning or CI mode

### Hardened
For internet-facing or sensitive-data systems.
Additional requirements:
- stricter mutation expectations on critical modules
- changed-line coverage enforcement
- cleanup checks for tests and artifacts in CI
- stronger logging/audit requirements
- threat-model note

## Universal rules

Always require:
- no secrets in code, tests, fixtures, docs, or logs
- no AI read, search, list, or write access to an existing `.env`; document environment variables through `.env.example`
- boundary validation for untrusted input
- strongest practical types at implementation boundaries and inside core logic
- no `any`, `unknown`, dynamic maps, blanket casts, or language-equivalent escape hatches where a precise type can be expressed
- no broad lint or typecheck disables. Any waiver must be line-local, justified in code, and used only after a code-level fix was attempted.
- parameterized database access
- lockfiles committed
- one canonical workflow per language
- one fast local verification command
- one full verification command
- one CI verification command
- explicit owner, profile, and data classification when relevant
- no unapproved test-only AI diffs: changed tests or snapshots require a paired implementation change unless the user explicitly requested test-only maintenance

## Verification command shape

Prefer these script names unless the repo already has clear equivalents:

- Fast local check: format check, lint, typecheck, and narrow unit tests.
- Full local check: fast check plus coverage and integration tests.
- CI verification: full check plus audits, cleanup checks, and profile-specific heavy checks.

## Cleanup as a standard

Cleanup is part of quality.
When production modules are renamed, removed, or heavily refactored, review and clean up:
- tests
- fixtures
- snapshots
- mocks
- helper files
- contract examples

## Agent shortcut prevention

Agents must be ambitious about quality gates:
- install or preserve a universal post-change agent hook that runs an existing linter/check after AI file changes and no-ops when no linter exists
- install or preserve an agent guard that blocks AI reads, searches, listings, and writes involving existing `.env` files
- install or preserve an agent guard that blocks changed tests or snapshots when no implementation files changed
- fix typed code instead of bypassing the checker
- model data with domain types, schemas, generics, discriminated unions, typed fixtures, and type guards before considering escape hatches
- preserve or tighten lint rules unless the repository owner explicitly approves weakening them
- treat `eslint-disable`, `biome-ignore`, `// @ts-ignore`, `// @ts-expect-error`, `type: ignore`, `# noqa`, and similar comments as exceptions that need a reason and the smallest possible scope
