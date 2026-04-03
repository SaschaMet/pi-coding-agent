---
description: GAN-style generator and critic loop starter
---
Use the subagent tool with chain mode:

1. gan-generator -> implement bounded slice for: $@
2. gan-critic -> evaluate output from {previous} with PASS/REVISE/BLOCKED

If verdict is REVISE, run gan-generator once more with critic defects.

Parameters:
- agentScope: "both"
- confirmProjectAgents: false

Return the latest verdict and unresolved blockers.
