# Gates and Write Scope

Your claims are checked mechanically after every run, and writes are checked against the active spec. Agents read and decide; code verifies.

## Commands

| Command | Effect |
|---------|--------|
| `/gates` | Show gate status and active checks |
| `/gates on` / `/gates off` | Enable or disable post-run checks |
| `/scope <spec-path>` | Arm write boundaries from that spec's `Scope` section |
| `/scope` | Show the armed scope |
| `/scope off` | Disarm |

## Checked after every run

| Gate | Fails when |
|------|------------|
| `changes_disclosed` | A file that changed during the run is not named in your final message. |
| `artifacts_exist` / `files_non_empty` | A successful `write`/`edit` left its target missing or empty. |
| `verification_actually_ran` | Your message says tests, typecheck, lint, or build passed, but no such command ran this turn. |

A `[GATE VIOLATION]` message is `git` output, not an opinion. Fix each named item; do not re-send your previous summary with different wording.

## When a write is blocked

While a scope is armed, `write`/`edit` outside it is blocked and `Forbid` always wins.

- Need a file outside the scope? Stop and ask the user to widen the spec's `Modify` list. Do not route around the block with `bash`.
- Do not arm, re-arm, or disarm scope to unblock yourself. Switching scope is the user's call.
- The armed spec plus `docs/specs/`, `docs/research/`, and `docs/plans/` stay writable.

## Details

Read `~/.pi/agent/docs/gates-and-scope-internals.md` before changing these extensions, when diagnosing a gate that fired wrongly, or when writing a spec `Scope` section — it covers pattern syntax, precedence, arming rules, and known limits.
