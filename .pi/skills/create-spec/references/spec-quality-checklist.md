# Spec Quality Checklist

Use this gate before finalizing a spec.

## 1. Intent

- [ ] Intent states both what changes and why.
- [ ] Business/user outcome is explicit.

## 2. Scope Contract

- [ ] `modify` paths are explicit and minimal.
- [ ] `call` dependencies are explicit.
- [ ] `forbid` list blocks sensitive/unrelated areas.
- [ ] Out-of-scope items are listed.

## 3. Acceptance Criteria

- [ ] Every criterion is objectively verifiable.
- [ ] No vague words without thresholds (`fast`, `better`, `secure`).
- [ ] Negative assertions are included when needed (`must not expose ...`).

## 4. BDD Coverage

- [ ] Each acceptance criterion has at least one `Given / When / Then` scenario.
- [ ] Edge cases and error paths are covered.

## 5. Verification Mapping

- [ ] Each criterion maps to an automated or manual check.
- [ ] Commands/inputs and expected outputs are concrete.
- [ ] Regression checks for existing behavior are included.

## 6. Invariants and Compliance

- [ ] Org invariants are listed or referenced.
- [ ] Domain contracts are listed.
- [ ] Security/compliance requirements are explicit where relevant.

## 7. Risk Controls

- [ ] One-way doors are marked.
- [ ] Rollback path is documented for risky changes.
- [ ] Escalation triggers are defined for sensitive modifications.

## 8. Handoff Clarity

- [ ] Implementation steps identify exact file targets.
- [ ] Verifier can validate without hidden assumptions.
- [ ] Open questions are isolated from approved requirements.
