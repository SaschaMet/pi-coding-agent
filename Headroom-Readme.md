# Headroom + PI

Token-saving context compression for this PI stack, via the
[`@raquezha/noheadroom`](https://pi.dev/packages/@raquezha/noheadroom) PI extension backed by a
local [Headroom](https://github.com/chopratejas/headroom) compression proxy.

## How it works

`@raquezha/noheadroom` is a **native PI extension**. On PI's `context` event it takes the
**tool-result** messages, sends their text to a local Headroom proxy (`/v1/compress` on
`http://127.0.0.1:8788`), and substitutes the compressed text back into the conversation before
PI sends it to the model. User prompts, assistant messages, tool-call IDs, and PI session
history are left intact — only `toolResult` content is rewritten.

Why this is the chosen approach (over swapping each provider's `baseUrl` to a proxy):

- **Provider-agnostic.** It compresses message *content*, not the provider call, and never
  touches auth. So it works for **every** PI provider — including the OAuth subscriptions
  (`github-copilot`, `openai-codex`) that a `baseUrl`-override proxy cannot handle.
- **One proxy total**, not one per upstream.
- **No risk to auth or request format**, because PI's normal provider path is unchanged.

## Security review (v0.2.5)

The package was scanned before adoption (source + published `dist/`). Summary:

| Check | Result |
|---|---|
| Install hooks (`pre/post/install`) | **None** — only `build`/`prepare`, which don't run when consuming the package |
| Runtime dependencies | **None** — only optional peer deps on `@earendil-works/pi-*` |
| Network egress | **localhost only** — `/health`, `/stats`, `/v1/compress`; non-local URLs blocked unless `PI_HEADROOM_ALLOW_REMOTE=1` |
| `eval` / `Function` / base64 / obfuscation | None |
| Process spawning | `spawn`/`execFile` of the `headroom` binary with fixed arg arrays (no shell) |
| File access | Reads only `~/.pi/agent/headroom/settings.json` |
| External telemetry | None (in-process PI event channel only; spawned proxy gets `HEADROOM_TELEMETRY=off`) |
| `dist/` vs source | Match (same endpoints, same proxy args) |

**Verdict: safe to use.** Residual *non-security* caveats:

1. **Compatibility.** It's written against `@earendil-works/pi-*` (an optional peer-dep fork of the
   PI API); this repo runs `@mariozechner/pi-*@0.65`. The imports are type-only and the host
   injects the real `ExtensionAPI`, but confirm it loads and that the `context` hook accepts
   returned `{messages}` — verify with `/headroom status` and `/headroom stats` after enabling.
2. **Maturity.** v0.2.5, first published 2026-06-13, single maintainer, described as "personal."
3. **What it sends.** Tool outputs + prompts go to `127.0.0.1:8788` for compression (local only).
4. **Persistent proxy.** If you let the extension auto-start a *pip* proxy, it runs detached and
   survives PI exit. We avoid this by using Docker with `autoStart: false`.

## Setup

### 1. Start the compression proxy

**Docker (recommended — no local pip install):** the proxy must run in token-compression mode so
it serves `/v1/compress`. The bundled [`headroom-compose.yml`](headroom-compose.yml) does this:

```bash
docker compose -f headroom-compose.yml up -d
docker compose -f headroom-compose.yml logs -f
```

**pip alternative:**

```bash
pip install "headroom-ai[proxy]"   # Python 3.10+
headroom proxy --host 127.0.0.1 --port 8788 --mode token --no-cache
```

(With pip installed you can instead set `autoStart: true` in the settings below and let the
extension launch the proxy on demand — it runs the same `proxy --mode token --no-cache` command.)

### 2. Install the extension

Already wired into this repo: `npm:@raquezha/noheadroom` is in `packages` in
[`.pi/settings.json`](.pi/settings.json). Install it into the runtime once:

```bash
pi install npm:@raquezha/noheadroom
```

### 3. Configure

Runtime config lives at `~/.pi/agent/headroom/settings.json` (already created):

```json
{
  "enabled": true,
  "baseUrl": "http://127.0.0.1:8788",
  "autoStart": false,
  "minContextTokens": 20000,
  "minMessageChars": 2000,
  "timeoutMs": 30000
}
```

- `autoStart: false` because Docker manages the proxy. Set `true` only for the pip path.
- `minContextTokens` — only compress once the conversation exceeds this many tokens.
- `minMessageChars` — only compress tool results at least this long.
- Every field can also be set via env (`PI_HEADROOM_*`, e.g. `PI_HEADROOM_AUTO_START=1`); settings
  file wins over env.

### 4. Verify

In a PI session:

```
/headroom health     # → "Headroom proxy online: http://127.0.0.1:8788"
/headroom stats      # proxy-side compression stats
/headroom status     # extension state, thresholds, session savings
```

The footer shows `✓ Headroom -NN% (… saved)` once compression is applied.

## Usage

`/headroom [on|off|status|health|stats]` — toggle compression for the session, check health, or
read stats. Compression then happens automatically on large contexts; an info line reports
`compressed X → Y tokens` whenever it applies.

## Privacy / safety

- Conversation context is sent **only to `localhost`** by default. Remote proxies are blocked
  unless you explicitly set `PI_HEADROOM_ALLOW_REMOTE=1` — only do that for a proxy you trust
  with full context.
- The Docker proxy does no LLM calls and needs no provider API keys; it compresses locally.

## Relationship to RTK

RTK trims **bash/CLI tool output** in Claude Code via hooks; it does not run in the PI runtime.
This extension trims **tool-result content inside PI** before the model call. Different tools,
different runtimes — no conflict. Conceptually it's "RTK-style trimming for PI, via Headroom."

## Alternative (without the extension)

If you ever want compression without this extension, you can run a Headroom proxy as an
LLM passthrough and point an API-key provider's `baseUrl` at it (e.g. LM Studio:
`headroom proxy --openai-api-url http://127.0.0.1:1234/v1`, then set `lmstudio.baseUrl` to the
proxy in [`.pi/models.json`](.pi/models.json)). This only works for API-key/local providers — not
OAuth subscriptions — which is exactly why the extension is the primary path. See Headroom's
[proxy docs](https://headroom-docs.vercel.app/docs/proxy) for the upstream flags.

## Further reading

- **Extension:** <https://pi.dev/packages/@raquezha/noheadroom> · <https://www.npmjs.com/package/@raquezha/noheadroom>
- **Headroom:** <https://github.com/chopratejas/headroom> · docs <https://headroom-docs.vercel.app/docs> · proxy <https://headroom-docs.vercel.app/docs/proxy>
