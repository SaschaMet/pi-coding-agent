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
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noEmit: true`

Prioritize tests and mutation for:
- reducers and state transitions
- selectors
- permissions and feature flags
- validation
- serialization/parsing

Do not replace an existing Vite, Next.js, Remix, or framework-specific setup unless it blocks the standard. Extend its current scripts and config.
