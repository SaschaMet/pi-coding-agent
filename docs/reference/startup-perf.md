# `pi` / terminal startup performance — investigation notes (2026-07-22)

Findings and changes from a session investigating slow terminal and `pi` startup.
Kept here (rather than upstream) at the user's request, even though the two
biggest costs live outside this repo — see "Where the costs actually are" below.

## Changes already applied (outside this repo, in `~/.zshrc`)

1. **Duplicate `compinit`**: nvm's `bash_completion.d/nvm` script was sourced
   *before* `oh-my-zsh.sh`, so its own `command -v compinit` guard didn't see
   compinit defined yet and ran a full extra completion-dump rebuild on every
   shell start. Fix: source nvm after `oh-my-zsh.sh`. Measured `compinit`
   engine time: 688ms → ~20ms (`zprof`).
2. **`nvm alias default` pointed at the floating `"node"` meta-alias**, which
   requires enumerating all installed versions to resolve. Pinned it to a
   concrete version instead (`nvm alias default 24.18.0`). Cost of
   `nvm use default`: 3.5s → ~0.3-0.5s.
   - Global npm packages (`pi`, `pi-mcp-adapter`, etc.) don't carry over
     between nvm-managed node versions. After pinning to a new version, they
     had to be copied over with `nvm reinstall-packages <old-version>`.
3. **The lazy nvm loader (`_nvm_ensure_default`) still called the full
   `nvm use --silent default`** even though `default` is now a concrete
   pinned version — i.e. we already know the target path. Replaced it with a
   direct `PATH`/`NVM_BIN` prepend from `$NVM_DIR/alias/default`, falling
   back to real `nvm use` only if that path doesn't exist. Cost of the first
   `pi`/`node`/`npm`/`npx` call per shell: ~0.3s → near-zero.

Net effect on `pi`'s first-call-per-shell cost: ~1.2s → ~0.54s.

## Where the remaining costs actually are

`pi --version` (no extensions loaded — confirmed via `PI_TIMING=1`, see
below) still costs **~0.5s**, entirely inside the globally-installed
`@earendil-works/pi-coding-agent` package (upstream: github.com/earendil-works/pi).
Its `main.js` statically imports the entire application (`InteractiveMode`,
`builtInExtensions`, the full agent-session-runtime, RPC mode, etc.) before
checking whether the invocation even needs any of that. This is not fixable
from this repo — it needs a fast-path in upstream `main.js`/`cli.js` that
checks `--version`/`--help` before the heavy imports, or converts them to
dynamic `import()`.

**Update (2026-07-28):** this repo's own dependency was bumped from the
deprecated `@mariozechner/pi-coding-agent@^0.65.0` lineage to
`@earendil-works/pi-coding-agent@^0.82.1` (see
`docs/specs/spec-pi-earendil-works-migration.md`), so it's no longer behind
the globally-installed CLI — the 16-version gap described below is closed.
The `--version`/`--help` fast-path issue itself is still unresolved upstream
as of that version; it wasn't in scope for the dependency migration.

<details>
<summary>Original note (now historical) on the version gap</summary>

This repo's own dependency (`@mariozechner/pi-coding-agent@^0.65.0` in
`package.json`) is 16 minor versions behind the globally-installed CLI
(`0.81.1`). Skimmed the changelog between those versions for anything
touching this: nothing indicates the `--version`/`--help` fast-path issue has
been fixed (there's a "Fixed CLI help and version output" entry around
0.79.x, but it's about output formatting, not import ordering). Bumping the
dependency is likely still worthwhile for the other accumulated startup/perf
fixes in that changelog (e.g. lazy provider-SDK loading, session read-twice
fix, moving model-catalog refresh out of startup) — but is a 16-version jump
with its own compatibility risk, so it's not applied here automatically.

</details>

**The bigger, actually-actionable cost is extension loading**, and it *is*
configured in files this repo/user controls. `pi` has a built-in startup
profiler — run with `PI_TIMING=1` prefixed to any real (non `--version`)
invocation, e.g.:

```
PI_TIMING=1 pi -p "say ok" --no-tools
```

Measured breakdown for this project, one real invocation:

| Extension | Import cost | Configured in |
|---|---|---|
| `pi-mcp-adapter` | 159ms | `~/.pi/agent/settings.json` (global) |
| `@tintinweb/pi-subagents` | 128ms | global + `.pi/settings.json` (project) |
| `pi-lens` | 105ms | global |
| `@juicesharp/rpiv-todo` | 80ms | global |
| `@juicesharp/rpiv-ask-user-question` | 59ms | global |
| `pi-spark` | 59ms | global |
| `@raquezha/noheadroom` | 13ms | global + project |
| `pi-cache-optimizer` | 4ms | global |
| this project's 4 local `.pi/extensions/*.ts` | ~17ms combined | project |
| **Total** | **~795ms** | |

This dwarfs everything else above and is paid on *every* real `pi` session,
interactive or not. None of it shows up in a plain `pi --version` check,
which is why it wasn't caught by the earlier CPU-profile-based investigation.

## Recommended next step (not applied — needs a judgment call)

Review `~/.pi/agent/settings.json`'s `packages` array against what's actually
used day to day (e.g. `@tintinweb/pi-subagents` is likely load-bearing for
the `spawn-pi-agent` skill; others may not be). Disable unused ones via
`pi config -l` or by trimming the array directly. This isn't something to
apply blindly — each entry provides real functionality and only the user can
judge which are worth ~60-160ms of startup cost per session.
