# Debug Extension Usage Guide

## Overview

A systematic debugging extension is available at `.pi/extensions/debug.ts`. It enforces disciplined debugging: **find root cause before fixing**.

## Pitfall: a slash command that "starts AI generation"

If typing a `/command` sends a model turn instead of running a command, the command name was not found. pi's dispatch (`agent-session.js: _tryExecuteExtensionCommand`) treats an unknown `/command` as an ordinary prompt — there is no "unknown command" error.

Check, in order:

1. Is the command actually registered by a loaded extension? (An extension that failed to load registers nothing.)
2. Duplicate command names: when two extensions register the same name, pi's registry renames them `<name>:1` and `<name>:2` — the plain `/name` no longer matches anything. This is the signature symptom of the same extension being loaded twice (project copy + global copy): every `/command` of the duplicated extension breaks, and approval dialogs appear twice (once per copy). The global copy always runs; the project copy stands down at load time when the same file exists under the global agent's `extensions/` directory (see `isShadowedProjectCopy` in `.pi/extensions/lib/extension-helpers.ts`) — so a project edit only takes effect after `npm run pi:sync-global`. If a duplicate still loads, re-sync and restart the session — loaded copies keep running until then.

## Commands

| Command | Purpose |
|---------|---------|
| `/debug` | Start debug session (forks clean branch, injects structured methodology) |
| `/debug <problem>` | Start with specific problem description |
| `/end-debug` | End session, optionally summarize, navigate back to original position |
| `/fix-attempt` | Track fix attempts, warns at 3+ ("question the architecture") |
| `/trace` | Quick command to trace a value/error backwards through the call chain |

## When to Use

Use the debug extension when:

- A bug persists after initial investigation
- Multiple fixes have failed
- The root cause is unclear
- You need structured investigation before proposing changes

## Methodology

The extension enforces 4 phases:

### Phase 1: Root Cause Investigation (REQUIRED)

- Read error messages completely
- Reproduce consistently
- Check recent changes
- Gather evidence at component boundaries
- Trace data flow backwards

### Phase 2: Pattern Analysis

- Find working examples in the codebase
- Compare against references
- Identify differences

### Phase 3: Hypothesis and Testing

- Form ONE hypothesis
- Test minimally (one variable at a time)
- Verify before continuing

### Phase 4: Implementation

- Create failing test case
- Implement single fix
- Verify fix
- Add defense-in-depth validation

## The 3-Fix Rule

If 3+ fixes have failed, STOP and question the architecture. This indicates:

- Shared state/coupling problems
- Wrong fundamental approach
- Need for refactoring, not patches

## Red Flags — Stop and Return to Phase 1

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "I don't fully understand but this might work"
- Proposing solutions before tracing data flow
- Multiple failed fix attempts

## Integration with Coding Workflow

The debug extension supplements the standard coding workflow:

1. **Understand** → Use `/debug` if root cause is unclear
2. **Research** → Use `/trace` to follow data flow
3. **Plan** → Form hypothesis after investigation
4. **Implement** → Only after root cause is confirmed
5. **Validate** → Test the fix, use `/fix-attempt` to track
6. **Document** → Use `/end-debug` with summary

## State Persistence

Debug state persists across sessions via `pi.appendEntry()`. On session restart:

- Active debug sessions are restored
- Fix attempt counts are preserved
- Widget displays current debug status
