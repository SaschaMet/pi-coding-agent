---
description: Worker implementation followed by reviewer gate and worker fix pass
---
Use the subagent tool with chain mode:

1. worker -> implement: $@
2. reviewer -> review output from {previous}
3. worker -> apply required fixes from {previous}

Parameters:
- agentScope: "both"
- confirmProjectAgents: false

Return final review status and residual risks.
