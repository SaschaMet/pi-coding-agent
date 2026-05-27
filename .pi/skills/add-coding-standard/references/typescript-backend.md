# Reference: TypeScript Backend

Use this reference only for Node services, CLIs, workers, APIs, and backend libraries.

Defaults:
- package manager: pnpm
- formatter: Prettier
- linter: ESLint 9 flat config
- type checker: `tsc --noEmit`
- unit tests: Vitest
- mutation tests: Stryker
- validation: Zod
- dependency audit: `pnpm audit`

Use backend-oriented compiler settings:
- `module: NodeNext`
- `moduleResolution: NodeNext`
- strict mode
- Node types enabled

Prefer architecture folders:
- `domain/`
- `application/`
- `infrastructure/`

Prioritize tests and mutation for:
- validation
- permissions
- money logic
- retries/idempotency
- state transitions

Do not force `domain/`, `application/`, and `infrastructure/` folders into a small library unless the repo already has domain boundaries that benefit from them.
