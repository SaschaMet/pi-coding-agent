---
name: brave-search
description: Web search and page-content lookup for current facts and documentation. Use for internet research and source gathering.
---

# Brave Search (Project Wrapper)

Use the `web_search` tool by default.

## Preferred Usage

- `web_search` query with `provider: brave` for current information.
- Add `domains` when source constraints are required.
- Use `includeContent: true` when short snippets are insufficient.

## Provider

- Default provider is configured in `.pi/agent.config.json`.
- API key env var defaults to `BRAVE_API_KEY`.

## Fallback

If `web_search` is unavailable, use standard CLI/network workflows that are safe and reproducible.
