# Troubleshooting @raquezha/noheadroom & Headroom Proxy

This document tracks known issues and required patches when running the `@raquezha/noheadroom` extension alongside a Dockerized Headroom proxy.

## 1. HTTP 404 on `/v1/compress` (Docker Loopback Guard)

**Symptom:**
PI or `curl` calls to `http://127.0.0.1:8788/v1/compress` fail with HTTP 404, but `/health` works fine.

**Cause:**
Headroom's `/v1/compress` endpoint is protected by a `require_loopback` dependency (`headroom/proxy/loopback_guard.py`). When running Headroom via Docker Compose, traffic from the host arrives at the app as a non-loopback source address (not `127.0.0.1`) because it crosses Docker's port-forwarding/NAT boundary. The proxy detects this as non-loopback and returns a 404 — deliberately, not 403, so the guarded routes stay invisible to external scanners (same mechanism protects DNS-rebinding attacks against `/debug/*`, `/admin/*`, and `/settings`).

**Do NOT fix this by patching `loopback_guard.py`'s check to `if False:` via a container entrypoint override.** That was considered and rejected: the check function is shared by every loopback-gated route in the proxy, not just `/v1/compress` — it also guards `/admin/upstream`, `/admin/runtime-env`, `/debug/*`, `/settings` (including the POST that writes config), and the entire CCR retrieve family (`/v1/retrieve*`). Disabling it globally opens all of those to anything that can reach the container's port, not just the one endpoint we care about. It's also brittle: it sed-matches one exact line of installed site-packages source, hardcoded to a specific Python version path, and silently no-ops (not errors) the moment an image bump refactors that line.

**Actual fix, already applied in [`headroom-compose.yml`](headroom-compose.yml):**

Headroom ships a scoped, documented opt-out for exactly this case: `HEADROOM_COMPRESS_ALLOW_REMOTE=1`. It drops the loopback dependency on `/v1/compress` *only* — every other loopback-gated route, and `HEADROOM_PROXY_TOKEN` auth, are unaffected.

```yaml
services:
  headroom:
    image: ghcr.io/headroomlabs-ai/headroom:main   # see note below on why :main
    ports:
      - "127.0.0.1:8788:8787"   # explicit loopback bind — see note below
    environment:
      HEADROOM_HOST: "0.0.0.0"
      HEADROOM_COMPRESS_ALLOW_REMOTE: "1"
```

Two things this depends on that are easy to miss:

- **Image tag**: this env var doesn't exist in the tagged `v0.32.0` release (verified directly against the `v0.32.0` tag source — the route there is unconditionally loopback-gated, no override). It merged to the `main` branch on 2026-07-21 (commit `1329ed7`, PR #2458), four days after `v0.32.0` shipped, and hasn't been cut into a release yet. We're intentionally tracking `:main` to get it now; re-pin to a tagged release once one ships this, and re-verify the command/entrypoint assumptions still hold when you do.
- **Port binding**: compose publishes on all host interfaces by default. Binding explicitly to `127.0.0.1` keeps the now-more-permissive `/v1/compress` reachable only from this machine, not the whole LAN.

**Known permanent limitation, not fixed by this or any future version:** the CCR retrieve family (`/v1/retrieve`, `/v1/retrieve/stats`, `/v1/retrieve/{hash}`, `/v1/retrieve/tool_call`) has no equivalent remote-allow override — it's unconditionally loopback-only by design. A host-side caller reaching the Dockerized proxy through published-port forwarding will always get 404 on those routes, regardless of configuration. Real CCR retrieval requires the proxy to run as a native host process (genuine loopback), not behind Docker's NAT.

## 2. Warning Spam: "compression skipped by guard"

**Symptom:**
During a session, you see repeated UI warnings:
> `⚠ noheadroom: compression skipped by guard (no-applicable-message-changed); Headroom reported X tokens saved but Pi context was left unchanged`

**Cause:**
Headroom in `token` mode compresses the *entire* payload it's given (including user prompts and assistant prose in the request body). The `noheadroom` PI extension, however, is designed to only apply changes back to `toolResult` messages, to preserve PI's native text fidelity elsewhere (`bridge.js`: `applyTo = source.role === "toolResult" ? "toolResult" : null`).

If Headroom's changes only touched non-`toolResult` content (or produced a result that didn't reduce the estimated token count), the extension discards the response and reports one of two benign, expected outcomes:
- `no-applicable-message-changed` — zero `toolResult` messages had any text actually change
- `no-estimated-token-savings` — a `toolResult` changed, but the estimated token delta was zero

The extension currently logs a `"warning"`-level UI notification for *any* discard reason, including these two expected/no-op cases, which reads as a failure when nothing actually failed.

**Verified:** there are 7 possible discard reasons in `bridge.js`. The other 5 (`message-count-changed`, `target-content-unreplaceable`, `role-changed:...`, `tool-call-id-changed`, `assistant-tool-calls-changed`) represent genuine misalignment between what was sent to Headroom and what came back — those should keep warning.

**Solution (applied):**
Patch the installed extension to silence the warning only for the two expected-outcome reasons, leaving the other 5 genuine-failure reasons warning as before:

```bash
sed -i '' 's/if (mode === "silent")/if (mode === "silent" || reason === "no-applicable-message-changed" || reason === "no-estimated-token-savings")/' ~/.pi/agent/npm/node_modules/@raquezha/noheadroom/dist/index.js
```

Verified before applying: the target string `if (mode === "silent")` occurs exactly once in `index.js` (inside `announceGuardSkip`), so this can't collide with the *other* `mode === "silent"` check in `announceAppliedCompression` (that one reads `mode === "quiet" || mode === "silent"`, a different literal string). Confirmed with `node --check` that the patched file is still syntactically valid.

*(Note: if the extension is updated or reinstalled, this patch must be reapplied — it edits installed `node_modules` output, which any reinstall of `@raquezha/noheadroom` will overwrite.)*
