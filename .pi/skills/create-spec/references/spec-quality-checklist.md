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

## 5.1 Slice Integrity

- [ ] Each execution step is independently runnable and demoable.
- [ ] No step depends on a later step to be verifiable.
- [ ] Steps are not ordered by stack layer (all migrations, then all services, then API, then UI).
- [ ] The first step produces something observable end-to-end, even against mock data.

## 6. Invariants and Compliance

- [ ] Org invariants are listed or referenced.
- [ ] Domain contracts are listed.
- [ ] Security/compliance requirements are explicit where relevant.
- [ ] Invalid states are named with enforcement points.

## 7. CARDS Architecture Contract

- [ ] Clarity: names, terms, and responsibilities are unambiguous.
- [ ] Alignment: dependency direction and owner modules are explicit.
- [ ] Resilience: likely follow-up changes have a local change path.
- [ ] Domain Integrity: invariants and invalid states are enforced by design.
- [ ] Separation: domain policy, orchestration, IO, presentation, and formatting boundaries are explicit.

## 8. Architecture Impact (Medium+)

- [ ] Data flow diagram shows before/after states.
- [ ] Changed flows are itemized with impact notes.
- [ ] Blast radius identifies direct and transitive dependents.
- [ ] New dependencies are listed with fallback behavior.
- [ ] Layer impact table shows which layers change and risk per layer.
- [ ] Stack view visualizes changes across layers (Medium+).
- [ ] Unchanged layers are explicitly called out.
- [ ] Visuals use mermaid, ASCII, or tables (renderable formats).
- [ ] Section omitted for Small specs.

## 9. Risk Controls

- [ ] One-way doors are marked.
- [ ] Rollback path is documented for risky changes.
- [ ] Escalation triggers are defined for sensitive modifications.

## 10. Handoff Clarity

- [ ] Implementation steps identify exact file targets.
- [ ] Verifier can validate without hidden assumptions.
- [ ] Open questions are isolated from approved requirements.
- [ ] If open questions or deferred decisions remain, the spec explicitly blocks implementation and tells AI coding agents to stop and prompt the user for answers before making changes.
