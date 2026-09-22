# Plan Quality Checklist

Use this gate before finalizing a plan.

## Grill Status

- [ ] A Grill Status table exists between the document header and the first numbered section.
- [ ] The latest row is `done <date>` or `overridden <date>: <reason>`; otherwise the document is not ready for implementation and the handoff must mark it blocked.

## In Plain Words

- [ ] The section exists, between the Grill Status table and section 1.
- [ ] Four lines: what we are doing, why, what could break, how we will know it worked.
- [ ] One sentence per line, 20 words maximum, no jargon.
- [ ] A reader who opens only this section knows whether to approve the plan.

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

## 7. Decisions Left Open

- [ ] Every decision left to the user carries a recommended answer.
- [ ] Each recommendation states what changes if the user picks otherwise.

## 8. Size Check

- [ ] Plan is under 150 lines, excluding the In Plain Words section.
- [ ] No BDD, CARDS, or architecture diagrams.
- [ ] If the change spans more than 3 files or multiple modules, escalated to `$create-spec`.
