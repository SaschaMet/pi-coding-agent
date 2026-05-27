# Reference: Core Standard

Use this reference on every run. It defines profile selection and universal controls.

## Profiles

### Baseline
For small tools, internal automations, and low-risk libraries.
Required:
- formatting
- linting
- strict typing
- unit tests for core logic
- secret scanning
- dependency audit

### Standard
For production apps, APIs, services, and internal applications with business data.
Additional requirements:
- integration tests
- coverage threshold
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
- boundary validation for untrusted input
- parameterized database access
- lockfiles committed
- one canonical workflow per language
- one fast local verification command
- one full verification command
- one CI verification command
- explicit owner, profile, and data classification when relevant

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
