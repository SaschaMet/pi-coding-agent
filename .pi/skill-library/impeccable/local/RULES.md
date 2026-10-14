# Local rules for impeccable (this library, not upstream)

Read in full before impeccable's Setup. Where these rules and impeccable's own files disagree, these win.

## Nothing leaves this machine

The user's rule: no request from impeccable may reach a third party. The offline layer in this folder enforces it; these rules keep the agent from working around it.

1. **Check the offline layer before the first launcher call.** Run `printenv IMPECCABLE_BIN`. It must end in `local/engine-offline`, and that file must be executable (`test -x "$IMPECCABLE_BIN"`). If either check fails, do not run `scripts/impeccable` at all. Take SKILL.md's "Launcher unavailable" path and tell the user: "The impeccable offline setup is missing: add `. ~/.pi/agent/skill-library/impeccable/local/offline.sh` to `~/.zshrc` and restart the terminal."
2. **Never run** `npx impeccable`, or these launcher verbs: `install`, `update`, `check`, `help`, `skills`, `generate-image`, `telemetry on`. Never run `detect` on a URL whose host is not `localhost`, `127.0.0.1`, `saschametzger.com` or `www.saschametzger.com` (the owner's own site). Any other host needs a human override: the user names that exact host in this chat and says yes. Then set `IMPECCABLE_REMOTE_HOST=<host>` for that one command only. Never set it on your own, never reuse an earlier yes for a new host, and never use wildcards. Without an override, scan local files or a local dev server.
3. **Images.** Comps may come only from the harness's own image tool. Never through `impeccable generate-image`, and never by calling an image API yourself.
4. **Live mode.** Copy edits are applied in this chat. Never start `claude` or `codex` for them, and never change `IMPECCABLE_LIVE_COPY_AGENT`.
5. **Offline roll.** A "degraded" roll without catalog challengers is expected here. Never re-roll to try to reach the catalog, and never change `IMPECCABLE_API_URL` or any other `IMPECCABLE_*` network setting. The only exception is `IMPECCABLE_REMOTE_HOST` under rule 2.
6. **No fetching.** Don't open URLs that impeccable's references point to (for example `raw.githubusercontent.com` links). Everything needed ships in this folder.

## Carried over from the retired taste-family router

7. **The project's stack wins.** Detect the styling system and component library and build in them. Never add a second styling system or component library, and never migrate one. Restyling components inside the existing library is fine. Impeccable's "rebuilt in the form's vocabulary" means restyle, not replace the library. Two competing systems: name both and ask which one survives. The user asks for a new one: state the cost in one line (two systems, two token sources), then record the decision and its reason in `DESIGN.md`.
8. **`docs/DESIGN-SYSTEM.md`** (written by `design-foundation`) is visual authority too. When it exists, read it in full alongside `DESIGN.md`.
9. **Conversion questions go elsewhere first.** "Traffic but nobody signs up", "why do they leave", "which fix moves the most money": that is `improve-website`. Run it first, then bring its ranked visual findings back here.
10. **A supplied screenshot or mockup to reproduce** belongs to `image-to-code-skill`, Mode A. Impeccable treats images as inspiration, not a spec.
11. **Never fabricate content.** No invented testimonials, logos, prices, user counts, review scores, or performance claims. Leave a labeled slot instead, such as `<!-- TODO: 3 testimonials, ~30 words each -->`. No Lorem ipsum, "John Doe", or "Acme".
12. **Complete output.** No `// ...`, "rest follows the same pattern", or a skeleton in place of the implementation.
13. **No user to ask** (a subagent or non-interactive run): adopt the detected stack, take the safest branch, and list every assumption in the final output.
14. **Check the result** at desktop width and below 768px.
