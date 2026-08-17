---
name: inspect-skill
description: Use this skill when the user asks to inspect, check or analyze a skill. Apply it when the user wants to understand a skill's purpose, its inputs and outputs, its dependencies, or its internal logic. Do not use for ordinary coding docs unless the target reader is an agent.
---

# Inspect Skill

Security scanner for AI agent skills. Detect vulnerabilities, malicious patterns, and security risks before installing agent skills.

AI agent skills (used by Claude Code, Codex CLI, Gemini CLI, etc.) execute with implicit trust and minimal vetting. Research shows that 26.1% of skills contain vulnerabilities and 5.2% show likely malicious intent.
SkillSpector helps you answer: "Is this skill safe to install?"

## Workflow

1. Check for updates with `uv tool update skillspector`.
2. Must use a sub-agent for analysis (read only).
3. Run `skillspector scan <path> --no-llm` on a local skill directory, a single `SKILL.md` file, a Git repository, or a zip file.
4. Run the scan with an LLM (see LLM Analysis section below).
5. Review the report and follow the recommendations to fix any issues.

## Usage

### Scan a local skill directory

skillspector scan ./my-skill/

### Scan a single SKILL.md file

skillspector scan ./SKILL.md

### Scan a Git repository

skillspector scan https://github.com/user/my-skill

### Scan a zip file

skillspector scan ./my-skill.zip

## Output Formats

### Terminal output (default) - pretty formatted

skillspector scan ./my-skill/

### JSON output - machine readable

skillspector scan ./my-skill/ --format json --output report.json

### Markdown output - for documentation

skillspector scan ./my-skill/ --format markdown --output report.md

### SARIF output - for CI/CD integration and IDE tooling

skillspector scan ./my-skill/ --format sarif --output report.sarif

## LLM Analysis

For the best results, configure an OpenAI-compatible LLM endpoint for semantic analysis.

```bash
export SKILLSPECTOR_PROVIDER=openai
export OPENAI_BASE_URL=http://localhost:1331/v1
export SKILLSPECTOR_MODEL=Ornith-1.0-35B-4bit
skillspector scan [...]
```

or for bigger / more complex skills, use a larger model:

```bash
# Local Claude CLI — no API key; uses your existing `claude auth login` session
# Requires: claude CLI installed and authenticated (claude auth login)
export SKILLSPECTOR_PROVIDER=claude_cli
# Uses the local Claude CLI runtime fallback unless SKILLSPECTOR_MODEL is set.
export SKILLSPECTOR_MODEL=claude-sonnet-5 # or whatever model is the latest sonnet
skillspector scan ./my-skill/
```

## Full Documentation

Visit: https://github.com/nvidia/skillspector
