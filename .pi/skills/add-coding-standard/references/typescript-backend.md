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
- `noImplicitAny`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- Node types enabled

Typing policy:
- prefer inferred concrete types, explicit interfaces, discriminated unions, generics, branded IDs, `satisfies`, and schema-derived types
- use `unknown` only at true trust boundaries, then narrow immediately with validation or type guards
- do not use `any` except when a third-party type hole cannot be modeled locally; isolate it behind a tiny typed adapter
- avoid broad casts such as `as any`, double casts through `unknown`, and object maps when a typed shape is available
- do not add `// @ts-ignore` or `// @ts-expect-error`; if the compiler is wrong or third-party types are broken, stop and request explicit repository-owner/user approval for a line-local documented exception

Lint policy:
- keep TypeScript-aware lint rules enabled, especially unsafe assignment/member access/calls, floating promises, and unused variables
- do not add file-level or config-level rule disables to pass staged checks
- do not add lint exceptions; if the rule is wrong, stop and request explicit repository-owner/user approval for a line-local documented exception and a follow-up issue when appropriate

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
