# Session Errors and Issues

## Date: 2026-04-04

## Overview

This document logs errors encountered during the model picker optimization session, including root causes and lessons learned.

## Resolution Status (2026-04-04)

- ✅ **Subagent extension conflicts:** mitigated by scoped extension loading in subagent subprocesses.
- ✅ **Subagent mode validation confusion:** improved with stricter validation + payload examples in error output.
- ✅ **Search path `.` for grep/find:** root-scope search now allowed without extra confirmation while protected leaf paths remain blocked.
- ℹ️ **File read limits:** expected tool/runtime behavior; continue using `offset` + `limit`.
- ℹ️ **Node modules write access:** intentionally restricted; read-only access remains expected.
- ⚠️ **Direct test execution constraints in some harnesses:** partially environment-dependent; local project runtime supports normal `npm`/`vitest` execution.

---

## 1. Subagent Tool Extension Conflicts

### Error Message

```
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/ask-questions.ts": Tool "ask_questions" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/ask-questions.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/ask-questions.ts": Tool "ask" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/ask-questions.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/bash-sandbox.ts": Tool "bash" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/bash-sandbox.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/codex-ui.ts": Tool "read" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/codex-ui.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/codex-ui.ts": Tool "write" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/codex-ui.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/codex-ui.ts": Tool "edit" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/codex-ui.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/codex-ui.ts": Tool "find" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/codex-ui.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/codex-ui.ts": Tool "grep" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/codex-ui.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/codex-ui.ts": Tool "ls" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/codex-ui.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/fetch-web-page.ts": Tool "fetch_web_page" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/fetch-web-page.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/plan-mode/index.ts": Flag "--plan" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/plan-mode/index.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/subagent/index.ts": Tool "subagent" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/subagent/index.ts
Error: Failed to load extension "/Users/saschametzger/.pi/agent/extensions/web-search.ts": Tool "web_search" conflicts with /Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/web-search.ts
```

### Root Cause

The subagent tool was trying to load extensions from both:

1. `/Users/saschametzger/.pi/agent/extensions/` (agent scope)
2. `/Users/saschametzger/Projects/pi-coding-agent/.pi/extensions/` (project scope)

When `agentScope` was set to `"both"`, both extension directories were loaded, causing conflicts for tools with the same name.

### Attempted Solutions

1. **First attempt**: Used `agentScope: "both"` with `confirmProjectAgents: false`
   - Result: Failed with extension conflicts

2. **Second attempt**: Used `agentScope: "project"` with `confirmProjectAgents: false`
   - Result: Still failed with extension conflicts

### Lesson Learned

- The subagent tool has a limitation when both agent and project extensions exist
- Extension conflicts occur when the same tool is defined in both scopes
- The `confirmProjectAgents` parameter doesn't prevent conflicts, it only asks for confirmation

---

## 2. Subagent Tool Chain Mode Error

### Error Message

```
Invalid parameters. Provide exactly one mode.
Available agents: explorer (project), gan-critic (project), gan-generator (project), planner (project), reviewer (project), tdd-green (project), tdd-red (project), tdd-refactor (project), worker (project), frontend-design (project), gan-coder (project), grill-me (project), interactive-planner (project), jupyter-notebook (project), orchestrator (project), pair-programming (project), security-best-practices (project), tdd-coding (project)
```

### Root Cause

The `chain` parameter was used incorrectly. The subagent tool expects either:

- A single `agent` parameter (for single mode)
- A `chain` array with multiple `{agent, task}` objects (for sequential execution)

However, the error suggests that when using `chain` mode, I need to provide exactly one mode, not multiple agent definitions.

### Attempted Solution

Used `chain` parameter with three tasks:

1. tdd-red: Create failing tests
2. tdd-green: Make minimal changes to pass tests
3. tdd-refactor: Refactor while preserving behavior

### Lesson Learned

- The subagent tool's chain mode may have different requirements than expected
- The error message indicates that only one mode should be provided when using chain
- This suggests the chain mode might work differently than anticipated

---

## 3. Bash Tool Limitations

### Issue

The bash tool has a single command payload limitation, which made it difficult to:

- Run complex test commands
- Execute multiple commands in sequence
- Use pipes and redirections effectively

### Example Commands That Were Difficult

```bash
npm test -- test/model-picker-optimization.test.ts 2>&1 | head -100
```

---

## 4. File Reading Limitations

### Issue

The read tool has a 2000 line limit or 50KB limit (whichever is hit first), which made it difficult to:

- Read large source files completely
- Navigate through long files with offset/limit
- See the full context of complex implementations

### Example

The `settings-manager.js` file was 702 lines, which was manageable, but larger files could have been problematic.

### Workaround

Used `offset` and `limit` parameters to read specific sections:

```typescript
read(path, { offset: 100, limit: 100 })
```

### Lesson Learned

- Use offset/limit for large files
- Combine multiple reads to get complete context
- Use grep to find specific sections first

---

## 5. No Direct Test Execution

### Issue

Unable to run the test suite directly due to:

1. Bash tool limitations
2. Subagent tool extension conflicts
3. No direct access to npm/vitest from the tool interface

---

## 6. Source Code Location Confusion

### Issue

Block working on the node_modules directory. Accept read access but not write access.

---

## 7. Allow "." searches

### Issue

"Search path '.' includes protected roots for grep"

This should be allowed, as it is common to search the current directory and subdirectories for specific patterns. The tool should be able to handle this use case without restrictions.
