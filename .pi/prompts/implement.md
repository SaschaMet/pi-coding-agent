---
description: Explorer + planner + worker implementation workflow
---
Use the subagent tool with chain mode:

1. explorer -> discover code and constraints for: $@
2. planner -> produce implementation plan from {previous}
3. worker -> implement plan from {previous}

Parameters:
- agentScope: "both"
- confirmProjectAgents: false

After completion, summarize changed files and verification.
