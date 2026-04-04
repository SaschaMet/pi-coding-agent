---
description: Pair-programming implementation followed by reviewer gate and pair-programming fix pass
---
Use the subagent tool with chain mode:

1. pair-programming -> implement: $@
2. reviewer -> review output from {previous}
3. pair-programming -> apply required fixes from {previous}

Parameters:
- agentScope: "both"
- confirmProjectAgents: false

Return final review status and residual risks.
