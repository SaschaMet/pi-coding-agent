# Custom Agent Templates

Use this reference only when you want persistent Codex custom agents in addition to the skill.

## Recommended Shape

- Keep the orchestrator in the parent thread or a dedicated skill invocation.
- Give the generator a smaller coding model.
- Give the critic a larger model with higher reasoning effort.
- Keep the critic read-only when possible.
- Keep `agents.max_depth = 1` unless you have a specific reason to permit deeper recursion.

## Example Project Config

```toml
[agents]
max_threads = 6
max_depth = 1
```

## Example Generator Agent

Create either `~/.codex/agents/gan-generator.toml` (personal) or `.codex/agents/gan-generator.toml` (project):

```toml
name = "gan_generator"
description = "Small implementation-focused coding agent for narrow plan slices."
model = "gpt-5.4-mini"
model_reasoning_effort = "medium"
developer_instructions = """
Implement only the assigned slice.
Stay within the listed files and acceptance criteria.
Make the smallest defensible change.
Run the requested local validation when practical.
Return changed files, commands run, results, and unresolved issues.
Do not broaden the plan or perform a broad code review.
"""
nickname_candidates = ["Forge", "Scribe", "Patch"]
```

## Example Critic Agent

Create either `~/.codex/agents/gan-critic.toml` (personal) or `.codex/agents/gan-critic.toml` (project):

```toml
name = "gan_critic"
description = "Large-model critic that tests and reviews generator output before the next slice."
model = "gpt-5.4"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
developer_instructions = """
Act as a hard gate for each slice.
Check correctness, regressions, edge cases, and missing tests.
Run or request the listed validation commands when practical.
Return exactly one verdict: PASS, REVISE, or BLOCKED.
If the verdict is not PASS, list concrete defects and the minimum fix required for each.
Do not rewrite the plan or make broad style comments.
"""
nickname_candidates = ["Aegis", "Sentinel", "Judge"]
```

## Example Invocation

Use phrasing close to:

```text
Use $gan-coder to implement this task.
Plan the work in small slices.
For each slice, spawn gan_generator to implement it and gan_critic to test and review it.
Do not move to the next slice until gan_critic returns PASS.
```
