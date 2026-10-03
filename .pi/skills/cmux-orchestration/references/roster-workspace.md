# Roster Workspace

Read when the user asks for a separate tab or the fleet is large, and `.cmux/cmux.json` exists in the current directory.

**Alternative: dedicated workspace** (when the user asks for a separate tab or the fleet is large). Use this recipe only when `.cmux/cmux.json` exists in the current directory (`test -f .cmux/cmux.json`). Otherwise use the split recipe in `SKILL.md`. `.cmux/cmux.json` is the single roster source (`commands[]` → named workspace layout, currently `pi Team`: 2 panes each running `npm run agent`). After editing it: `cmux config doctor` (validate, no socket needed) then `cmux reload-config`.

```bash
# 1. extract the layout from the roster and boot it (workspace create has NO --json flag)
LAYOUT=$(node -e "const c=require('./.cmux/cmux.json'); \
  console.log(JSON.stringify(c.commands.find(k=>k.name==='pi Team').workspace.layout))")
cmux workspace create --name "pi-team" --cwd "$PWD" --layout "$LAYOUT"

# 2. capture refs AFTER creation — never guess them
cmux tree --all --json    # ground truth: every workspace/pane/surface with refs (→ WS, S1, S2)
# note: `list-pane-surfaces --workspace` only lists ONE pane's surfaces — use tree --all

# 3. label the workspace (color is runtime-only, not part of the layout JSON)
cmux workspace-action --action set-color --workspace "$WS" --color Blue
```

Each roster surface auto-runs its `command` on open — the layout is the boot script.
