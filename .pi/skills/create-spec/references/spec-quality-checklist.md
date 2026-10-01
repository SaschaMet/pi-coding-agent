# Spec Quality Checklist

Use this gate before finalizing a spec.

## Grill Status

- [ ] A Grill Status table exists between the document header and the first numbered section.
- [ ] The latest row is `done <date>` or `overridden <date>: <reason>`; otherwise the document is not ready for implementation and the handoff must mark it blocked.

## Living-Document Sections

- [ ] `## Metadata` sits between the title block and Grill Status, with only `Created`, `Commits`, and `Back refs`.
- [ ] Every Execution Step has a `Validate:` list of `[ ]` items with concrete commands.
- [ ] `## Amendments` and `## AI-Notes` exist, in that order, after Handoff; AI-Notes is the last section.
- [ ] Each of these sections keeps its rules blockquote from the template.
- [ ] No new heading contains the word `Scope`.

## In Plain Words

- [ ] The section exists, between the Grill Status table and section 1.
- [ ] Four lines: what we are doing, why, what could break, how we will know it worked.
- [ ] One sentence per line, 20 words maximum, active voice.
- [ ] No jargon, no acronym that this document defines later, no internal vocabulary.
- [ ] A reader who opens only this section knows whether to approve the spec.

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
- [ ] Each behavioral criterion is written once as `Given / When / Then`; static checks stay one line.
- [ ] Edge cases and error paths are covered.

## 4. Verification Mapping

- [ ] Each criterion maps to an automated check in a step, or to the Manual Verification Checklist.
- [ ] Commands/inputs and expected outputs are concrete.
- [ ] Existing tests that guard current behavior are run in a step.

## 4.1 Slice Integrity

- [ ] Each execution step is independently runnable and demoable.
- [ ] No step depends on a later step to be verifiable.
- [ ] Steps are not ordered by stack layer (all migrations, then all services, then API, then UI).
- [ ] The first step produces something observable end-to-end, even against mock data.

## 5. Invariants and Compliance

- [ ] Org invariants are listed or referenced.
- [ ] Domain contracts are listed.
- [ ] Security/compliance requirements are explicit where relevant.
- [ ] Invalid states are named with enforcement points.
- [ ] A `CARDS` line exists only where it adds a constraint (unclear ownership, dependency direction, a local change path, domain integrity, or a separation boundary).

## 6. Architecture Impact (Medium+)

- [ ] Data flow diagram shows before/after states.
- [ ] Changed flows are itemized with impact notes.
- [ ] Blast radius identifies direct and transitive dependents.
- [ ] New dependencies are listed with fallback behavior.
- [ ] Visuals are archify diagram references (`<doc>.assets/<id>.<type>.json`) or tables. No Mermaid blocks: the page renderer shows them as plain text.
- [ ] `plan-view render` exits 0, so every diagram reference validated.
- [ ] Section omitted for Small specs.

## 7. Risk Controls

- [ ] One-way doors are marked.
- [ ] Rollback path is documented for risky changes.
- [ ] Escalation triggers are defined for sensitive modifications.

## 8. Handoff Clarity

- [ ] Implementation steps identify exact file targets.
- [ ] Every change has a diff preview within 40 lines per file, or a one-line reason why not.
- [ ] Verifier can validate without hidden assumptions.
- [ ] Open questions are isolated from approved requirements.
- [ ] Every open question carries a recommended answer and the consequence of choosing otherwise.
- [ ] The gate block below the title exists exactly once, and the Handoff says `Blocked: see gate`.
