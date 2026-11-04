# Roster Workspace

Read only when the user explicitly asks for a separate tab and `.cmux/cmux.json` exists in the current directory.

**The user runs step 1, not the agent.** A guard blocks agents from creating a workspace, because it opens outside the caller's workspace and its sidebar group. Hand the user the command below; after they confirm, the agent continues with steps 2 and 3. Use this recipe only when `.cmux/cmux.json` exists in the current directory (`test -f .cmux/cmux.json`). Otherwise use the split recipe in `SKILL.md`. `.cmux/cmux.json` is the single roster source (`commands[]` → named workspace layout, currently `pi Team`: 2 panes each running `npm run agent` on the implementation model from **Model roles** in `SYSTEM.md`). After editing it: `cmux config doctor` (validate, no socket needed) then `cmux reload-config`.

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
