# AGENTS.md — test

Local work contract for `test/`. Parent contracts above still bind; this file controls local details.

## Purpose

Vitest unit + integration suites for guards, secrets, sync, delegation policy, spec scope, trust loading, agent config, and package scripts. Uses a fake-PI harness to exercise extensions without a live runtime.

## Ownership

- `helpers/fake-pi.ts` — `createFakePi()`: the fake PI runtime (`exec`, event bus) for extension tests. Canonical test double.
- One file per feature: `gates`, `read-boundary-guard`, `write-boundary-guard`, `spec-scope`, `trust-loader`, `subagent-delegation-policy`, `sync-pi-config`, `secrets`, `agent-config`, `package-scripts`, `add-coding-standard-quality-guard`.

## Local Contracts

- Use `createFakePi` for extension tests; do not start a real PI session in unit tests.
- Fail-safe assertions: assert the guard blocks the disallowed action AND allows the allowed one. Test both paths.
- Tests are self-contained and deterministic: build a tmp dir (`fs.mkdtempSync`), clean up, and never depend on real `~/.pi/agent` state.
- Keep tests colocated by feature, mirroring the subject name (`test/<feature>.test.ts`).

## Work Guidance

- Canonical harness patterns: `test/sync-pi-config.test.ts` (`setupRoots` + `writeJson`) and `test/gates.test.ts` (`withGit` + `runAgent`).
- When you change a guard/extension, update its test in the same change (TDD per the root workflow).

## Verification

- `npm test`
- `npm run test:coverage` (v8 coverage)

## Child DOX Index

- None.
