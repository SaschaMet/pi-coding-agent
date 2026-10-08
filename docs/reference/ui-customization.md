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
- **Context window:** `$context` in the middle zone. The Claude 5h/7d usage comes from `~/.pi/agent/extensions/claude-usage.ts` and is placed in the middle via `extensionStatuses.placements`. It appears only after a `claude-bridge` turn.
- **Cache:** the `pi-cache-stats` status is hidden. Only the hit rate shows, inside `$tokens`.
- **Thinking:** Streaming mode (`Ctrl+T` expands the full text).
- **Working line:** `#DE7356` for `high` and `mid`, `#C4694F` for `low`. A darker `low` makes the sweep look brown.

## Package patches

`pi-compact-tools` and `pi-lens` have no setting for three things, so patches in `.pi/patches/` change them. The `package-patches` extension re-applies them after updates; see `.pi/skills/package-patches/SKILL.md`.

- `pi-compact-tools/thinking-color`: thinking headings use `thinkingText`.
- `pi-compact-tools/working-row`: drops the `Thinking…` / `Preparing tools…` label so Zentui owns the working row.
- `pi-lens/lsp-status-text`: footer shows `LSP Active`, not the server list.

Check state: `npm run pi:package-patches -- check`.
