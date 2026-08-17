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
4. Run the scan with an LLM.
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

## Full Documentation

Visit: https://github.com/nvidia/skillspector
