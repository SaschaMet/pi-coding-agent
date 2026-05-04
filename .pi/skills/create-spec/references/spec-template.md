# Spec Template

Use this structure for the final spec document. Collapse optional sections for
small tasks, but keep scope, criteria, and verification explicit.

```md
# Spec: {Feature Name}

> Generated on {date}
> Status: Draft | In Review | Approved
> Size: Small | Medium | Large | Epic

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

## 7. Verification Plan

### 7.1 Automated Verification Matrix

| Criterion | Check Type | Command / System | Expected Evidence |
| --- | --- | --- | --- |
| AC1 | Unit | `npm run test -- ...` | ... |
| AC2 | Integration | `...` | ... |

### 7.2 Manual Verification Checklist

- [ ] Step 1: command/input -> expected result
- [ ] Step 2: command/input -> expected result

### 7.3 Regression Checks

- [ ] Existing tests: `...`
- [ ] Existing flows unchanged: `...`

## 8. Risks, One-Way Doors, Rollback

| Risk | Severity | Mitigation | One-Way Door | Rollback |
| --- | --- | --- | --- | --- |
| ... | High | ... | Yes/No | ... |

## 9. Traceability and Audit

- Source ticket/PRD: ...
- Reviewer/approver: ...
- Link acceptance criteria to verification artifacts.

## 10. Definition of Done

- [ ] Scope boundaries respected (`modify/call/forbid`).
- [ ] All acceptance criteria pass.
- [ ] Verification evidence captured.
- [ ] Risks and rollback documented.

## 11. Open Questions / Deferred Decisions

- [ ] ...

## 12. Handoff

- Implementation agent should read: `...`
- Verifier should validate: `...`
- Escalation triggers: `...`
```

Use short sections for small changes. Keep criteria and checks measurable.
