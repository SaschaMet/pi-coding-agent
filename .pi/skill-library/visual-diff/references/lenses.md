# Lenses and Honesty Rules

Run the lenses before you write anything. `summary` mode uses lenses 1, 3, and 7. `deep` mode uses all seven.

## Lenses

1. **Change taxonomy.** Label each hunk: behavior change, new capability, removal, refactor, mechanical (rename, format, move), config, or test. Themes follow from these labels.
2. **Removed-behavior audit.** For every deleted check, branch, guard, or invariant: is it re-established elsewhere, removed on purpose, or unaccounted for? Record each one in `removed` with that status.
3. **Cross-file impact.** Who calls the changed code? Look for callers that break on a new precondition, a changed return shape, a new error, or a renamed field. Feed the result into `impact`.
4. **Contract delta.** What changed in signatures, data formats, error behavior, ordering, concurrency, or state transitions? Record visible before→after changes in `behavior`.
5. **Design pressure.** New special cases, duplication, new coupling between modules, state that could be derived instead of stored.
6. **Test delta.** Did tests change with the behavior? Look for weakened assertions, deleted tests, and new behavior without a test.
7. **Hidden-risk heuristics.** Off-by-one, falsy zero or empty string, missing `await`, broad `catch`, unanchored regex, timezone or locale, float equality, resource leaks, copy-paste slips.

## Honesty Rules

- Never present a suspicion as a bug. A review-focus item is a concrete failure scenario to check.
- Mark intent `stated` only when a commit message, PR body, or linked doc says it. Otherwise mark it `inferred`.
- Cite `file:line` for every behavior, removal, and focus claim.
- Never invent or retype code. The renderer shows the code from the diff.
- Order themes by importance, not by file order.
- Write "None" rather than filler when a lens finds nothing.
