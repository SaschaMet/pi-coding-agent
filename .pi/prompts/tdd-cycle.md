---
description: TDD red-green-refactor subagent sequence
---
Use the subagent tool with chain mode:

1. tdd-red -> create failing tests for: $@
2. tdd-green -> make minimal changes to pass using {previous}
3. tdd-refactor -> refactor while preserving behavior from {previous}

Parameters:
- agentScope: "both"
- confirmProjectAgents: false

Return test commands and final status.
