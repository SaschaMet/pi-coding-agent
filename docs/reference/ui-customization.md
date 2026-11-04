# UI customization (Zentui, theme, patches)

Per-machine UI setup in `~/.pi/agent`. These files are excluded from `pi:sync-global` on purpose, so they live outside git. Copies are kept in `docs/reference/ui-config/` as a restore point.

## Files

| File | Purpose |
| --- | --- |
| `~/.pi/agent/zentui.json` | Footer, thinking, working-line settings for `pi-zentui` |
| `~/.pi/agent/themes/my-dark.json` | Theme (copy of `dark`, `thinkingText` `#7a7a7a`, `mdCode` `#66d181`); selected by `"theme": "my-dark"` in `settings.json` |

Restore: copy `docs/reference/ui-config/zentui.json` to `~/.pi/agent/` and `my-dark.json` to `~/.pi/agent/themes/`, then restart Pi. Refresh the copies after intentional changes.

## Choices

- **Footer:** Starship style, template `$cwd( on $git_branch)$fill$context$fill$tokens($sep$cost)`. Two `$fill` is the maximum, so there are three zones. cwd and branch use `muted`. No git status.
- **Context window:** `$context` in the middle zone. The Claude 5h/7d usage comes from `~/.pi/agent/extensions/claude-usage.ts` and is placed in the middle via `extensionStatuses.placements`. The extension reads the `anthropic-ratelimit-unified-*` headers that `pi-claude-bridge` forwards, so the segment appears after the first usage event of a `claude-bridge` session (Claude Code sends one when a window changes) and is empty until then. The same extension writes the `agent-usage-bar` menu-bar snapshot (`~/.claude/usage-bar/usage.json`); see `.pi/extensions/AGENTS.md`.
- **Wide vs compact footer:** `responsive` is on, so the footer reflows the wide layout first and switches to `compactFormat` (`$cwd( on $git_branch)$fill$context($sep$tokens)`) when it cannot fit, for example in a narrow split pane. The compact template has no `$cost` and no `$extensions`, so in that layout the cost, the Claude usage, and every extension status (Headroom, MCP, LSP, cache, sandbox) are hidden. That is expected, not a bug. To show them in compact mode, append `($sep$cost)$wrap_sep$extensions` to `compactFormat` (not applied: it makes narrow panes busier).
- **Cache:** the `pi-cache-stats` status is hidden. Only the hit rate shows, inside `$tokens`.
- **Thinking:** Streaming mode (`Ctrl+T` expands the full text).
- **Working line:** `#d19a66` (`high`), `#a97d52` (`mid`), `#7d5d3c` (`low`). The sweep animation cycles through the three. Tried `#DE7356` (peach) and went back.

## Package patches

`pi-compact-tools` and `pi-lens` have no setting for three things, so patches in `.pi/patches/` change them. The `package-patches` extension re-applies them after updates; see `.pi/skills/package-patches/SKILL.md`.

- `pi-compact-tools/thinking-color`: thinking headings use `thinkingText`.
- `pi-compact-tools/working-row`: drops the `Thinking…` / `Preparing tools…` label so Zentui owns the working row.
- `pi-lens/lsp-status-text`: footer shows `LSP Active`, not the server list.

Check state: `npm run pi:package-patches -- check`.
