# Subagent Skill Mapping

Skill-backed subagent names are not guaranteed to be available in every runtime.
When a canonical skill name is unavailable, route to the listed fallback agent(s).

| Canonical subagent (skill) | Fallback subagent(s) | Notes |
| --- | --- | --- |
| `interactive-planner` | `planner` | Use for planning, design, and scoped implementation plans. |
| `tdd-coding` | `tdd-red` -> `tdd-green` -> `tdd-refactor` | Run the explicit staged TDD cycle when the skill is unavailable. |
