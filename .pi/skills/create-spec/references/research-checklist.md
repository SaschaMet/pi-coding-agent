# Research Checklist (Spec Authoring)

Work through this before writing the spec. Skip sections that do not apply.

## 1. Repository Shape

- [ ] Primary language(s), framework(s), package manager(s)
- [ ] Monorepo vs single project
- [ ] Entry points and core modules for the requested change

## 2. Guidance and Constraints

- [ ] `AGENTS.md`, `.github/instructions`, and related policy files
- [ ] Existing architecture docs, ADRs, and contribution rules
- [ ] Any local skill or prompt conventions that affect output

## 3. Existing Plans/Specs

- [ ] `docs/specs/`, `docs/plans/`, `*.spec.md`, `*.plan.md`
- [ ] Existing spec for same feature identified
- [ ] Decide update-in-place vs new spec file

## 4. Target Implementation Surface

- [ ] Modules and files likely to be modified
- [ ] Similar implementations and reusable patterns
- [ ] External systems/services the change may call

## 5. Validation Surface

- [ ] Test framework and test command(s)
- [ ] CI checks that should gate merge
- [ ] Manual verification paths available (API, UI, CLI)

## 6. Invariants and Contracts

- [ ] Org-wide invariants (security, compliance, reliability)
- [ ] Domain-level contracts (module rules, API contracts)
- [ ] Constraints that must be encoded as acceptance criteria

## 7. Risk and Reversibility

- [ ] Auth/permission impacts
- [ ] Public API or schema changes
- [ ] Performance-sensitive path changes
- [ ] One-way doors and rollback options

## 8. Permission Boundaries

- [ ] Minimal `modify` file set identified
- [ ] Necessary `call` systems identified
- [ ] Explicit `forbid` boundaries identified
- [ ] Escalation triggers defined for risky edits
