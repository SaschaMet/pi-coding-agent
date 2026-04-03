# Plan: Implementation Friction Remediation

> Generated on 2026-04-03
> Status: Draft
> Size: Large

## Summary
Address the recurring implementation frictions captured in `docs/plans/implementation-friction-notes.md` with a phased, minimal-risk remediation plan focused on high-ROI fixes first:

1. Make subagent/skill availability transparent and actionable.
2. Enable prerequisite capability-policy command paths needed for remediation execution.
3. Make PI docs/examples accessible locally without depending on blocked paths.
4. Restore/finish verification loop hardening (coverage + typecheck + smoke), enforce single-source capability policy, and align docs/tests.
5. Codify lightweight process guardrails for the remaining planning/execution frictions.

This plan avoids large architectural changes and keeps the runtime model intact.

## Scope

**Included**
- Subagent discoverability and mismatch handling improvements.
- Repo-local PI docs mirror workflow for read/search reliability.
- Coverage/typecheck/smoke command-path remediation.
- Capability-policy/documentation alignment.
- Focused tests and manual verification procedures.

**Excluded**
- Rewriting subagent architecture or replacing current role system.
- Relaxing security policy broadly (only narrowly scoped command/policy adjustments).
- Terminal-level cursor behavior guarantees across all terminals.
- Full overhaul of all skill documents in external/user-global directories.

## References
- Friction notes: `docs/plans/implementation-friction-notes.md`
- Runtime entrypoint: `src/main.ts`
- Subagent discovery/runtime:
  - `.pi/extensions/subagent/agents.ts`
  - `.pi/extensions/subagent/index.ts`
  - `test/subagent-discovery.test.ts`
  - `test/subagent-chain.test.ts`
- Capability policy and enforcement:
  - `.pi/extensions/capability-policy.ts`
  - `.pi/security/capabilities.json`
  - `.pi/extensions/permission-gate.ts`
  - `.pi/extensions/protected-paths.ts`
  - `test/capability-policy.test.ts`
  - `test/safety-hooks.test.ts`
- Validation workflow:
  - `package.json`
  - `vitest.config.ts`
  - `scripts/smoke.ts`
- Existing docs:
  - `README.md`
  - `docs/security/capability-matrix.md`
  - `docs/security/sandboxing.md`

## Detected Project Context
- **Language/Runtime**: TypeScript + Node.js (ESM).
- **Package manager**: npm (`package-lock.json` present).
- **Test framework**: Vitest (`test/**/*.test.ts`).
- **Current scripts**: `agent`, `dev`, `smoke`, `test`.
- **Observed gaps**:
  - `npm test -- --coverage` currently fails (coverage provider incompatibility).
  - `npm run typecheck` not available and command is blocked by capability policy.
  - `npm run smoke` exists but is blocked by current capability rules.
- **Deployment target**: local CLI runtime (no CI/CD pipeline detected).
- **Rollback model**: git revert + config/script rollback; no data migrations.

## Risks & Dependencies

| # | Risk | Severity | Mitigation | One-Way Door? |
|---|---|---|---|---|
| 1 | Skill names and available agents diverge again, causing workflow failures | High | Add runtime-level availability messaging + docs + tests for fallback hints | No |
| 2 | Local mirrored PI docs become stale vs installed package | Medium | Add sync script + version stamp + manual refresh step in verification | No |
| 3 | Expanding command allowlist increases execution surface | High | Allow only explicit repo scripts/commands; keep deny-by-default baseline | No |
| 4 | Coverage fix introduces version skew with Vitest | Medium | Pin compatible coverage package version and validate with `npm run test:coverage` | No |
| 5 | Docs and policy drift (matrix/docs not matching JSON behavior) | Medium | Update docs and add policy regression tests in same phase | No |

**Data risks**: none (no persistent schema/data changes).

**Blockers / decisions to confirm during implementation**
- Prefer docs mirroring over broad `node_modules` policy exceptions (default in this plan).
- Keep skill mismatch handling explicit (warn/suggest) rather than silent auto-substitution.

---

## Phase 1: Subagent/Skill Availability Transparency

### Goal
Eliminate ambiguity between documented skill-backed workflows and actual runtime-discovered agents.

### Tasks

#### Task 1.1 — Improve unknown-agent diagnostics and mapping hints
**Files to modify**:
- `.pi/extensions/subagent/index.ts`
- `.pi/extensions/subagent/agents.ts` (if helper(s) are needed)

**Spec**
- On unknown subagent names, return actionable guidance:
  - discovered agent list
  - likely equivalent agent(s) (e.g., planner fallback)
  - how to inspect configured skill roots/scope
- Do not silently remap execution unless explicitly designed and documented.

**Definition of Done**
- [ ] Unknown-agent errors include explicit next steps.
- [ ] Suggested equivalents are deterministic and test-covered.

#### Task 1.2 — Document canonical workflow-to-agent mapping
**Files to modify**:
- `README.md`
- `.pi/agents/AGENTS.md`

**Files to create**:
- `docs/reference/subagent-skill-mapping.md`

**Spec**
- Clarify distinction between:
  - built-in project agents (`planner`, `worker`, `tdd-*`)
  - skill-backed subagents discovered from `settings.json` skill roots
- Add a concise mapping table: preferred skill name, equivalent project-agent fallback, and usage notes.

**Definition of Done**
- [ ] Docs no longer imply guaranteed availability of skill-backed names.
- [ ] Fallback guidance is explicit and consistent across docs.

#### Task 1.3 — Add regression tests for availability messaging
**Files to modify**:
- `test/subagent-chain.test.ts`
- `test/subagent-discovery.test.ts`

**Files to create** (if needed):
- `test/subagent-availability-hints.test.ts`

**Spec**
- Validate unknown-agent response contains available-agent + hint text.
- Preserve existing discovery precedence behavior (project agent overrides colliding skill name).

**Definition of Done**
- [ ] Tests cover both success-path discovery and mismatch-path guidance.

### Testing
- **Automated**: `npm test`
- **Regression**: existing subagent tests remain green.
- **Manual**:
  1. Invoke subagent with a non-existent name and confirm actionable guidance appears.
  2. Invoke known fallback (`planner`) and confirm task still runs.

### Context for Implementation
- **Read first**: `.pi/extensions/subagent/index.ts`, `.pi/extensions/subagent/agents.ts`, `test/subagent-chain.test.ts`.
- **Can skip**: `src/secrets.ts`, unrelated web-search/fetch extensions.
- **Patterns to follow**:
  - deterministic discovery setup from `test/subagent-discovery.test.ts`
  - structured tool error returns in `.pi/extensions/subagent/index.ts`

### Review Checkpoint
Confirm that subagent failures now teach users what to run next (not just fail).

---

## Phase 2: Prerequisite Capability-Policy Unlock + Local Docs Mirror Setup

### Goal
First unblock the minimal command paths needed for remediation execution, then establish a committed repo-local PI docs mirror.

### Tasks

#### Task 2.1 — Allow only prerequisite remediation commands
**Files to modify**:
- `.pi/security/capabilities.json`
- `.pi/extensions/capability-policy.ts`
- `test/capability-policy.test.ts`
- `test/safety-hooks.test.ts` (if needed for enforcement-path assertions)

**Spec**
- Permit only the minimum required commands for planned remediation execution:
  - `npm run docs:sync-pi`
  - `npm run smoke`
  - `npm run typecheck`
  - `npm run test:coverage`
- Keep deny-by-default for all other command paths.
- Enforce centralized single-command validation in `.pi/extensions/capability-policy.ts` before regex rule evaluation.
- Block chained/compound payloads for allowlisted commands.

**Definition of Done**
- [ ] `npm run docs:sync-pi` is allowed.
- [ ] `npm run smoke` is allowed.
- [ ] `npm run typecheck` is allowed.
- [ ] `npm run test:coverage` is allowed.
- [ ] Chained variants of allowlisted commands are blocked.
- [ ] Existing blocked sensitive/network command tests remain green.

#### Task 2.2 — Add a docs mirroring workflow
**Files to create**:
- `scripts/sync-pi-docs.ts`
- `docs/vendor/pi-coding-agent/README.md`
- `docs/vendor/pi-coding-agent/docs/` (mirrored subset)
- `docs/vendor/pi-coding-agent/examples/` (targeted examples subset)

**Files to modify**:
- `package.json` (add script `docs:sync-pi`)

**Spec**
- Copy selected PI docs/examples from installed package into repo-local `docs/vendor/pi-coding-agent`.
- Include source package version and sync timestamp in generated index/readme.
- Commit mirrored docs to git as tracked project artifacts (not generated-only local output).
- Keep mirror content read-only for contributors; updates happen via `npm run docs:sync-pi` and are committed.

**Definition of Done**
- [ ] Repo contains readable PI docs mirror committed to version control.
- [ ] Sync command can refresh mirror deterministically.
- [ ] Running sync twice without dependency/version changes produces no diff.

#### Task 2.3 — Wire docs usage guidance
**Files to modify**:
- `README.md`
- `docs/plans/implementation-friction-notes.md` (status/update section)

**Spec**
- Document “prefer local vendor docs first” path.
- Keep existing upstream links as fallback, but make local path primary.
- Document mirror governance: docs under `docs/vendor/pi-coding-agent/**` are committed artifacts and should only be updated through `npm run docs:sync-pi`.

**Definition of Done**
- [ ] Contributors have one obvious local docs path.
- [ ] Contributors know mirrored docs are committed and how to update them safely.
- [ ] Friction note is marked as remediated or partially remediated with caveats.

#### Task 2.4 — Add smoke verification for mirrored docs presence
**Files to modify**:
- `scripts/smoke.ts`

**Spec**
- Smoke check validates required mirrored docs paths exist.
- Fail with clear remediation instruction (`npm run docs:sync-pi`).

**Definition of Done**
- [ ] Missing docs mirror fails early with actionable message.

### Testing
- **Automated**:
  - `npm test`
  - `npm run docs:sync-pi`
  - `npm run docs:sync-pi` again (idempotence/no-diff check)
- **Manual**:
  1. Verify each newly allowlisted command is permitted.
  2. Verify `npm run smoke && printenv` is blocked.
  3. Verify `printenv` and `curl https://example.com` remain blocked.
  4. Delete one mirrored file temporarily, run smoke command, verify clear failure.
  5. Re-sync and verify smoke passes.

### Context for Implementation
- **Read first**: `.pi/extensions/capability-policy.ts`, `.pi/security/capabilities.json`, `scripts/smoke.ts`, `README.md`.
- **Can skip**: subagent discovery internals.

### Review Checkpoint
Confirm downstream phases are executable in-policy and PI docs are available locally without `node_modules` access.

---

## Phase 3: Verification Workflow Repair (Coverage, Typecheck, Policy Consistency)

### Goal
Restore a reliable verification loop and remove policy drift sources.

### Tasks

#### Task 3.1 — Fix Vitest coverage compatibility
**Files to modify**:
- `package.json`
- `vitest.config.ts`

**Spec**
- Align `@vitest/coverage-v8` with installed `vitest` major/minor.
- Add `test:coverage` script (explicit command contract).
- Add baseline coverage reporter config (text + lcov minimum).

**Definition of Done**
- [ ] `npm run test:coverage` succeeds locally.

#### Task 3.2 — Add typecheck script and allow policy
**Files to modify**:
- `package.json` (add `typecheck` script)
- `.pi/security/capabilities.json`
- `.pi/extensions/capability-policy.ts`

**Spec**
- Add `npm run typecheck` as the single supported type-check path.
- Extend bash allowlist regex narrowly for:
  - `npm run typecheck`
  - `npm run smoke`
  - `npm run test:coverage`
  - `npm run docs:sync-pi`
- Harden allowlist evaluation so approved commands cannot be chained/combined with additional shell operations.
  - Enforce this in a single authoritative runtime gate in `.pi/extensions/capability-policy.ts` before rule matching.
  - Parse/validate bash input as single-command payload only; block compound operators (`&&`, `;`, `||`, pipes, subshell/backticks, redirection-based command substitution) at this gate.
  - Keep `.pi/security/capabilities.json` declarative (allow/confirm/block rules), not a second parser for command-structure safety.
  - Treat any multi-command shell payload as blocked unless explicitly covered by a separate confirm/allow rule.
- Keep direct broad command classes blocked unless intentionally required.

**Definition of Done**
- [ ] `npm run typecheck` allowed and runnable.
- [ ] `npm run smoke` allowed and runnable.
- [ ] `npm run docs:sync-pi` allowed and runnable.
- [ ] Single-command validation is enforced centrally in `.pi/extensions/capability-policy.ts` before regex/policy rule evaluation.
- [ ] Chained payloads (e.g., `npm run smoke && <second command>`) are blocked.
- [ ] Deny-by-default posture preserved for non-approved commands.

#### Task 3.3 — Enforce one capability-policy source of truth (remove duplicate runtime default)
**Files to modify**:
- `.pi/extensions/capability-policy.ts`
- `.pi/security/capabilities.json`
- `.pi/security/capabilities.schema.json` (if schema constraints need tightening)
- `scripts/smoke.ts`
- `src/main.ts`

**Spec**
- Declare `.pi/security/capabilities.json` as the single source of truth for runtime capability policy.
- Remove the duplicated embedded capability policy definition from `.pi/extensions/capability-policy.ts` (the large in-code default config object) and replace it with fail-closed loading behavior.
- If the JSON file is missing/invalid, startup and smoke must fail with a clear remediation message instead of silently falling back to an in-code policy.
- Keep only minimal immutable boot defaults in code that are not policy definitions (e.g., file path location), to prevent policy drift.

**Definition of Done**
- [ ] Runtime no longer contains a second full capability policy definition.
- [ ] Missing/invalid `.pi/security/capabilities.json` fails closed at startup and smoke checks.
- [ ] Policy changes happen in exactly one place (`.pi/security/capabilities.json`).

#### Task 3.4 — Align tests and security docs with policy reality
**Files to modify**:
- `test/capability-policy.test.ts`
- `test/safety-hooks.test.ts` (if command-path assertions are added)
- `docs/security/capability-matrix.md`
- `docs/security/sandboxing.md`
- `README.md`

**Spec**
- Add regression tests for newly-allowed repo-standard commands.
- Add negative tests proving command-chaining payloads are blocked even when a leading allowlisted command is present.
- Add targeted unit tests for the centralized single-command parser/validator in `.pi/extensions/capability-policy.ts`.
- Add tests proving fail-closed behavior when capability JSON is missing/invalid (no silent fallback policy).
- Ensure docs match actual capability behavior (`confirm` vs `allow`, protected roots, approved commands, single-command-only constraints, single-source-of-truth policy loading).

**Definition of Done**
- [ ] Tests enforce command-policy contract.
- [ ] Tests enforce anti-chaining safeguards for allowlisted commands.
- [ ] Tests enforce fail-closed policy loading when JSON is missing/invalid.
- [ ] Security docs and runtime policy no longer disagree.

### Testing
- **Automated**:
  - `npm test`
  - `npm run typecheck`
  - `npm run test:coverage`
  - `npm run smoke`
  - `npm run docs:sync-pi`
- **Regression**: existing policy-block cases (e.g., `printenv`, network shell commands) remain blocked.
- **Manual**:
  1. Run all repo-standard verification commands.
  2. Attempt disallowed command (`npx vitest run`) and verify block still occurs.
  3. Temporarily point security config to a missing capability file (or corrupt JSON) and verify startup/smoke fail closed with remediation guidance.

### Context for Implementation
- **Read first**: `.pi/extensions/capability-policy.ts`, `.pi/security/capabilities.json`, `package.json`, `test/capability-policy.test.ts`.
- **Can skip**: codex UI extension files; unrelated to policy loop.
- **Patterns to follow**:
  - regex-based bash rule matching in `evaluateBashCommand`
  - policy assertions in `test/capability-policy.test.ts`

### Review Checkpoint
Confirm “verify before merge” is possible in this harness without ad-hoc command workarounds.

---

## Phase 4: Process Guardrails for Remaining Planning/Execution Friction

### Goal
Reduce repeat incidents from ambiguous requirements and stale file snapshots with lightweight process documentation.

### Tasks

#### Task 4.1 — Create a concise implementation workflow note
**Files to create**:
- `docs/reference/implementation-workflow.md`

**Files to modify**:
- `README.md` (link section)

**Spec**
- Include explicit guidance for:
  - re-read-before-edit for fast-changing files
  - screenshot-inspired vs verified requirements
  - terminal-dependent behavior caveats (cursor/blink)
  - editor affordance preservation checklist for UI work
  - harness tool-name mapping (skill docs vs actual tool names)

**Definition of Done**
- [ ] Team has a single short checklist to prevent the previously observed process failures.

#### Task 4.2 — Close the loop in friction notes
**Files to modify**:
- `docs/plans/implementation-friction-notes.md`

**Spec**
- Add per-item status tags (Open / In Progress / Resolved / Deferred).
- Link each resolved friction to implementation commit(s)/doc section.

**Definition of Done**
- [ ] Friction note becomes an actively maintained tracker, not a stale postmortem.

### Testing
- **Automated**: none required beyond docs linting if introduced.
- **Manual**:
  1. Walk through the checklist while performing a tiny edit and verify steps are practical.

### Context for Implementation
- **Read first**: `docs/plans/implementation-friction-notes.md`, `README.md`.
- **Can skip**: runtime source files once Phases 1–3 are complete.

### Review Checkpoint
Confirm docs are short, actionable, and referenced from the main entrypoint docs.

---

## Summary of Planned File Changes

| File | Change Type | Phase |
|---|---|---|
| `docs/plans/plan-implementation-friction-remediation.md` | Create | 0 |
| `.pi/extensions/subagent/index.ts` | Modify | 1 |
| `.pi/extensions/subagent/agents.ts` | Modify (optional helper extraction) | 1 |
| `test/subagent-chain.test.ts` | Modify | 1 |
| `test/subagent-discovery.test.ts` | Modify | 1 |
| `test/subagent-availability-hints.test.ts` | Create (optional) | 1 |
| `docs/reference/subagent-skill-mapping.md` | Create | 1 |
| `README.md` | Modify | 1-4 |
| `.pi/agents/AGENTS.md` | Modify | 1 |
| `scripts/sync-pi-docs.ts` | Create | 2 |
| `docs/vendor/pi-coding-agent/**` | Create/refresh | 2 |
| `scripts/smoke.ts` | Modify | 2-3 |
| `package.json` | Modify | 2-3 |
| `vitest.config.ts` | Modify | 3 |
| `.pi/security/capabilities.json` | Modify | 2-3 |
| `.pi/security/capabilities.schema.json` | Modify (if needed) | 3 |
| `.pi/extensions/capability-policy.ts` | Modify (remove embedded default policy, fail-closed loader) | 2-3 |
| `src/main.ts` | Modify (fail-closed startup messaging hook if needed) | 3 |
| `test/capability-policy.test.ts` | Modify | 3 |
| `test/safety-hooks.test.ts` | Modify (if needed) | 3 |
| `docs/security/capability-matrix.md` | Modify | 3 |
| `docs/security/sandboxing.md` | Modify | 3 |
| `docs/reference/implementation-workflow.md` | Create | 4 |
| `docs/plans/implementation-friction-notes.md` | Modify | 2,4 |

## Open Questions / Deferred Decisions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| 1 | Should unknown skill names be auto-remapped to fallback agents, or remain explicit with suggestions only? | Maintainer | Yes (Phase 1 behavior) |
| 2 | How much PI vendor content should be mirrored (minimal required subset vs broad mirror)? | Maintainer | Yes (Phase 2 scope) |
| 3 | Should coverage thresholds be enforced now, or just make reporting runnable first? | Maintainer | No |
| 4 | Should command allowlist include `npx vitest` parity, or enforce npm-script-only policy? | Maintainer | No |

## Manual Test Checklist

- [ ] Run `npm test` and confirm all existing tests pass before remediation work.

### Phase 1 checks
- [ ] Trigger subagent with an unknown name (example: `agent: "interactive-planner"` in a setup where that skill is absent) and confirm the error includes: available agents, suggested fallback(s), and next-step guidance.
- [ ] Trigger subagent with a valid fallback agent (`planner`) and confirm successful completion.
- [ ] Verify `README.md` and `.pi/agents/AGENTS.md` mapping guidance is consistent with actual runtime behavior.

### Phase 2 checks
- [ ] Run `npm run docs:sync-pi` and confirm `docs/vendor/pi-coding-agent/` is populated.
- [ ] Open a mirrored file (for example `docs/vendor/pi-coding-agent/docs/tui.md`) and confirm it is readable inside the repo.
- [ ] Temporarily remove one required mirrored doc, run smoke verification, and confirm a clear failure message points to `npm run docs:sync-pi`.
- [ ] Re-run `npm run docs:sync-pi` and confirm smoke verification succeeds afterward.

### Phase 3 checks
- [ ] Run `npm run typecheck` and confirm command is allowed and exits successfully.
- [ ] Run `npm run test:coverage` and confirm coverage executes successfully (no provider import error).
- [ ] Run `npm run smoke` and confirm command is allowed and passes.
- [ ] Run `npm run docs:sync-pi` and confirm command is allowed and completes.
- [ ] Run `npm test` and confirm policy + runtime tests remain green.
- [ ] Execute a disallowed command (example: `npx vitest run`) and confirm capability policy still blocks it.
- [ ] Execute a chaining payload (example: `npm run smoke && printenv`) and confirm capability policy blocks it.
- [ ] Execute a known sensitive blocked command (`printenv`) through bash tool path and confirm it remains blocked.

### Phase 4 checks
- [ ] Read `docs/reference/implementation-workflow.md` and verify it includes re-read-before-edit, requirement validation, terminal caveats, and tool-name mapping guidance.
- [ ] Confirm `docs/plans/implementation-friction-notes.md` now has per-item status labels and links to remediation artifacts.

## Handoff
- **Implementation**: Use `$tdd-coding` to implement each phase in TDD order.
- **Review**: Use `$grill-me` to stress-test this plan before implementation (recommended due policy/security implications).
- **Integration tests**: During implementation, the TDD skill will ask for integration test input/output pairs when needed.
