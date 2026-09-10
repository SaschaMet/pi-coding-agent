# Reference: Python

Use this reference only for Python applications, services, CLIs, and libraries.

Defaults:
- environment/package manager: uv
- formatter: Ruff format
- linter: Ruff
- type checker: Pyright
- unit tests: pytest
- coverage: pytest-cov
- mutation tests: mutmut
- validation: Pydantic v2
- dependency audit: pip-audit

Core rules:
- use `pyproject.toml`
- annotate parameters and return types
- use the narrowest practical types for collections, callables, protocols, literals, typed dicts, dataclasses, and Pydantic models
- avoid `Any`, `object`, untyped `dict`, untyped `list`, broad casts, and `type: ignore` when a precise type can be expressed
- use `Any` only at unavoidable third-party or dynamic boundaries; isolate it behind a typed adapter and narrow immediately
- do not add `# noqa`, Ruff ignores, Pyright ignores, or broad ignore patterns to pass staged checks; if the tool is wrong, stop and request explicit repository-owner/user approval for a line-local documented exception narrower than a code-level fix
- use timezone-aware datetimes
- use `Decimal` for money
- use `yaml.safe_load`
- use `secrets` for secure randomness

Prioritize tests and mutation for:
- domain rules
- validation
- permissions
- calculations
- serialization/parsing

Preserve the existing environment manager when the lockfile and scripts clearly identify one. Use `uv` as the default only when the repo does not answer.
