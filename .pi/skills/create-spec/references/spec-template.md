# Spec Template

Use this structure for the final spec document. Collapse optional sections for
small tasks, but keep scope, criteria, and verification explicit.

```md
# Spec: {Feature Name}

> Generated on {date}
> Status: Draft | In Review | Approved
> Size: Small | Medium | Large | Epic

> Implementation Guard: If `Open Questions / Deferred Decisions` contains any unanswered item, implementation is blocked. Any AI coding agent must stop, ask the user to answer those items, and wait before changing code, config, migrations, tests, or docs.

## 1. Intent
One paragraph for what changes and why now.

## 2. Scope

**Modify:**
- `path/to/file`

**Call:**
- `service-or-api`

**Forbid:**
- `path/or/area`

**Out of Scope:**
- ...

## 3. Acceptance Criteria

- [ ] AC1: ...
- [ ] AC2: ...
- [ ] AC3: ...

## 4. BDD Scenarios

### AC1
Given ...
When ...
Then ...

### AC2
Given ...
When ...
Then ...

## 5. Execution Steps

### Step 1: ...
- Files: `path/to/file`
- Change: ...
- Guardrails: ...

### Step 2: ...
- Files: `path/to/file`
- Change: ...
- Guardrails: ...

## 6. Invariants and Contracts

**Org invariants:**
- ...

**Domain contracts:**
- ...

## 7. CARDS Architecture Contract

- Clarity: ...
- Alignment: ...
- Resilience: ...
- Domain Integrity: ...
- Separation: ...

## 8. Verification Plan

### 8.1 Automated Verification Matrix

| Criterion | Check Type | Command / System | Expected Evidence |
| --- | --- | --- | --- |
| AC1 | Unit | `npm run test -- ...` | ... |
| AC2 | Integration | `...` | ... |

### 8.2 Manual Verification Checklist

- [ ] Step 1: command/input -> expected result
- [ ] Step 2: command/input -> expected result

### 8.3 Regression Checks

- [ ] Existing tests: `...`
- [ ] Existing flows unchanged: `...`

## 9. Risks, One-Way Doors, Rollback

| Risk | Severity | Mitigation | One-Way Door | Rollback |
| --- | --- | --- | --- | --- |
| ... | High | ... | Yes/No | ... |

## 10. Traceability and Audit

- Source ticket/PRD: ...
- Reviewer/approver: ...
- Link acceptance criteria to verification artifacts.

## 11. Definition of Done

- [ ] Scope boundaries respected (`modify/call/forbid`).
- [ ] CARDS architecture contract respected or explicitly waived.
- [ ] All acceptance criteria pass.
- [ ] Verification evidence captured.
- [ ] Risks and rollback documented.

## 12. Open Questions / Deferred Decisions

If this section has any unanswered item, implementation must not start.

- [ ] ...

## 13. Handoff

- Implementation agent should read: `...`
- Implementation blocked: Yes/No. If yes, stop and prompt the user to answer `Open Questions / Deferred Decisions` before making changes.
- Verifier should validate: `...`
- Escalation triggers: `...`
```

Use short sections for small changes. Keep criteria and checks measurable.
