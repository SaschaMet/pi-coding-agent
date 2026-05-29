# Reference: TypeScript Frontend

Use this reference only for browser apps, SSR apps, component libraries, and frontend packages.

Defaults:
- package manager: pnpm
- formatter: Prettier
- linter: ESLint 9 flat config
- type checker: `tsc --noEmit`
- unit tests: Vitest
- mutation tests: Stryker
- validation: Zod
- dependency audit: `pnpm audit`

Use frontend-oriented compiler settings:
- `moduleResolution: bundler`
- DOM libs enabled
- strict mode
- `noImplicitAny`
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noEmit: true`

Typing policy:
- prefer component prop types, typed event handlers, discriminated UI state, schema-derived API types, and `satisfies` for config and fixture objects
- use `unknown` only at true browser/API/storage boundaries, then narrow immediately with validation or type guards
- do not use `any` except when a third-party type hole cannot be modeled locally; isolate it behind a tiny typed adapter
- avoid broad casts such as `as any`, double casts through `unknown`, and untyped records when a typed shape is available
- do not use `// @ts-ignore` or `// @ts-expect-error` unless the compiler is wrong or third-party types are broken; include the reason and keep it line-local

Lint policy:
- keep TypeScript-aware and framework lint rules enabled, especially unsafe assignment/member access/calls, hooks rules, accessibility rules, and unused variables
- do not add file-level or config-level rule disables to pass staged checks
- if a lint exception is unavoidable, prefer a line-local disable with a concrete reason and a follow-up issue when appropriate

Prioritize tests and mutation for:
- reducers and state transitions
- selectors
- permissions and feature flags
- validation
- serialization/parsing

Do not replace an existing Vite, Next.js, Remix, or framework-specific setup unless it blocks the standard. Extend its current scripts and config.
