# Plan Quality Checklist

Use this gate before finalizing a plan.

## Grill Status

- [ ] A Grill Status table exists between the document header and the first numbered section.
- [ ] The latest row is `done <date>` or `overridden <date>: <reason>`; otherwise the document is not ready for implementation and the handoff must mark it blocked.

## Living-Document Sections

- [ ] `## Metadata` sits between the header and Grill Status, with only `Created`, `Commits`, and `Back refs`.
- [ ] Every Change is a `[ ]` checklist item; the Changes section keeps the status-marker rules blockquote.
- [ ] `## Amendments` and `## AI-Notes` exist, in that order, after Done When; AI-Notes is the last section.
- [ ] No new heading contains the word `Scope`.

## TLDR

- [ ] A plan that still has `## In Plain Words` keeps its layout: skip the TLDR and Changes at a Glance checks for it.
- [ ] The section exists, between the Grill Status table and Changes at a Glance.
- [ ] Written at high-school level: real terms defined once, reasons kept, no internal vocabulary.
- [ ] It holds what and why, how it works, steps, what could break, how we will know it worked, and decisions for you. A one-behavior plan may merge the first two; empty parts say "None." with a reason.
- [ ] One step line per Change in section 3, same number, each with what happens, why, and how we check it.
- [ ] One line per open decision, each with a recommended answer.
- [ ] Step lines and decision lines match section 3 and the open decisions one to one.
- [ ] No sentence or word counts in the TLDR.
- [ ] A reader of TLDR and Changes at a Glance alone knows whether to approve the plan.

## Changes at a Glance

- [ ] The section exists, between TLDR and section 1.
- [ ] Every diff preview in the plan sits here, none in section 3.
- [ ] Each diff has a caption line: `Change N — path — what changes`. A file changed by two Changes gets one diff per Change.
- [ ] A diagram appears only when a flow changes, and only here.

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
- [ ] Every change has a diff preview in Changes at a Glance within 40 lines per file, or a one-line reason why not.

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

- [ ] Plan is under 150 lines, excluding the TLDR, Metadata, Amendments, and AI-Notes sections.
- [ ] No BDD or CARDS.
- [ ] If the change spans more than 3 files or multiple modules, escalated to `$create-spec`.
