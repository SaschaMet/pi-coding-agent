# Plan Quality Checklist

Use this gate before finalizing a plan.

## 1. Graphify

- [ ] Graphify queried before drafting.
- [ ] Findings cited when they affect scope or risk.

## 2. Scope Contract

- [ ] Scope is minimal (1-3 files).
- [ ] `modify` paths are explicit.
- [ ] `forbid` list blocks sensitive/unrelated areas.
- [ ] Out-of-scope items are listed.

## 3. Changes

- [ ] Each change names the exact file.
- [ ] Each change has a description.
- [ ] No vague wording (`refactor`, `cleanup`, `improve`).

## 4. Tests

- [ ] Every change has a corresponding test or verification step.
- [ ] Regression checks for existing behavior are included.
- [ ] Commands/inputs and expected outputs are concrete.

## 5. Verification

- [ ] Automated checks cover the core behavior.
- [ ] Manual steps are included when automation is insufficient.
- [ ] No unverifiable criteria.

## 6. Risk Controls

- [ ] Irreversible changes note a rollback path.
- [ ] Risks are specific, not generic.

## 7. Size Check

- [ ] Plan is under 50 lines.
- [ ] No BDD, CARDS, or architecture diagrams.
- [ ] If the change spans more than 3 files or multiple modules, escalated to `$create-spec`.
