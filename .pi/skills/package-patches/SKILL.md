---
name: package-patches
description: Judges and repairs the local patches applied to installed Pi packages (for example pi-compact-tools) after an update. Use when a session shows a "Package patch needs review" message, when asked to check, re-apply, or regenerate package patches, or after a Pi package update. Not for patching code inside this repo.
---

# Package Patches

Local edits to installed packages live as `.patch` files in this repo's `.pi/patches/<pkg>/`, synced to `~/.pi/agent/patches/`. The `package-patches` extension applies clean ones at session start. This skill handles what it cannot: conflicts and new package versions.

## Steps

1. **Subagent or cmux worker:** report the message to your parent and stop.
2. **Not in the pi-coding-agent repo:** tell the user "Open Pi in the pi-coding-agent repo and run the package-patches skill there", and stop. Never edit the synced global copy; the next push overwrites it.
3. Run `npm run pi:package-patches -- check`. States: `applied`, `needed`, `conflict`, `absent`. A line ending in `review due` means the installed version differs from the patch's `Reviewed-Version`.
4. For each patch that is `conflict` or review due:
   - Read the patch header (`Purpose`, `Requires`, `Reviewed-Version`) and the current upstream code under `~/.pi/agent/npm/node_modules/<pkg>`.
   - Decide: **keep** (still needed and still correct), **regenerate** (still needed, lines moved), or **delete** (upstream fixed it, or `Requires` no longer holds).
   - Regenerate from a pristine copy: `npm pack <pkg>@<version>`, edit a copy, `diff -u` with `a/` and `b/` paths. Keep the header; set `Reviewed-Version` to the installed version.
   - Edit only `.pi/patches/`. Never edit `node_modules` by hand.
5. Run `npm run pi:sync-global`, then `npm run pi:package-patches -- apply`, then `check`. Expect `applied` for every kept patch.
6. Tell the user what was decided per patch and to restart Pi.

## Gotchas

- `needed` is normal after an update and needs no judgment; `apply` handles it.
- A patch that applies cleanly can still be redundant or wrong on a new version: that is what the review step is for.
- Patched modules load before `session_start`, so an apply only takes effect after a restart.
