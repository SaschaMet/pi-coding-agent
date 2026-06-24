# Headroom + PI

[Headroom](https://github.com/chopratejas/headroom) is a context-compression layer for AI
agents. It sits between the agent and the LLM and compresses tool outputs, files, logs, and
conversation history before they reach the model — typically 60–95% fewer tokens with
comparable answer quality. It runs as a **library**, an **OpenAI-compatible proxy**, an **MCP
server**, or an **agent wrapper**.

This repo integrates it via the **proxy** mode: PI points a provider's `baseUrl` at a local
Headroom proxy, and every request through that provider is compressed. PI's
["Overriding Built-in Providers"](https://www.npmjs.com/package/@mariozechner/pi-coding-agent)
feature makes this a one-line config change per provider.

> **Auth model — read this first.** Headroom's proxy authenticates to the upstream provider
> with **its own credentials** (e.g. `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in the proxy's
> environment), *not* by forwarding the client's token. So a plain `baseUrl` override works
> cleanly for **API-key** providers (`lmstudio`, or `anthropic`/`openai` if you give the proxy a
> key), but it does **not** reuse PI's OAuth subscription tokens. For the OAuth subscription
> providers (`github-copilot`, `openai-codex`) use Headroom's subscription-aware wrap modes
> instead — see those sections below.

## Quick setup

```bash
# Install the pip package and start the proxy on :8787
scripts/setup-headroom.sh

# Options
scripts/setup-headroom.sh --port 8788     # different port
scripts/setup-headroom.sh --no-start      # install only
scripts/setup-headroom.sh --extra all     # full feature set (default: proxy)
```

Manual equivalent:

```bash
pip install "headroom-ai[proxy]"   # Python 3.10+
headroom proxy --port 8787
```

Verify: `headroom --version` and `headroom perf` (compression savings).

## How the proxy routes upstream

The proxy detects the client's API format from the base URL it's called on, and forwards to the
matching upstream using the proxy's **own** credentials:

| Client base URL                       | Detected format     | Default upstream            |
|---------------------------------------|---------------------|-----------------------------|
| `http://127.0.0.1:PORT/v1`            | OpenAI-compatible   | `https://api.openai.com`    |
| `http://127.0.0.1:PORT`               | Anthropic Messages  | `https://api.anthropic.com` |

Each instance has **one** upstream, configured by flags:

- `--openai-api-url <URL>` (or env `OPENAI_TARGET_API_URL`) — override the OpenAI upstream;
  this is how you point at a local OpenAI-compatible server such as LM Studio.
- `--backend bedrock|vertex_ai|azure|openrouter` — use a cloud backend instead.
- Other useful flags: `--host` (default `127.0.0.1`), `--port` (default `8787`),
  `--log-file <path>`, `--budget <usd/day>`, `--no-cache`, `--no-optimize`, `--llmlingua`.

Upstream credentials the proxy reads from its own environment:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (Bedrock),
`GOOGLE_APPLICATION_CREDENTIALS` (Vertex), `OPENROUTER_API_KEY`.

The `scripts/setup-headroom.sh` helper passes anything after `--` straight to `headroom proxy`:

```bash
scripts/setup-headroom.sh --port 8787 -- --openai-api-url http://127.0.0.1:1234/v1
```

## How it plugs into PI

For **API-key / local** providers, give each provider in [`.pi/models.json`](.pi/models.json) a
`baseUrl` override pointing at its Headroom proxy. The proxy supplies the real upstream key from
its own environment, so PI only needs a placeholder `apiKey` (or none, for `lmstudio`).

For **OAuth subscription** providers (`github-copilot`, `openai-codex`) a `baseUrl` override does
**not** work — the generic proxy can't reuse PI's subscription token (see the auth note above).
Route those through Headroom's `wrap` modes instead.

> **One proxy per upstream.** A single proxy instance forwards to exactly one upstream, and each
> provider speaks a different API to a different endpoint. So run one Headroom instance per
> provider you route, each with its own upstream flag and a distinct port. The ports below
> (8787–8791) are a suggested layout.

## Providers

| PI provider id   | Auth             | Route via            | Proxy upstream flag                       | Suggested proxy |
|------------------|------------------|----------------------|-------------------------------------------|-----------------|
| `lmstudio`       | local key        | `baseUrl` override   | `--openai-api-url http://127.0.0.1:1234/v1` | `:8787`       |
| `anthropic`      | API key          | `baseUrl` override   | default (Anthropic) + `ANTHROPIC_API_KEY` | `:8790`         |
| `google-vertex`  | GCP ADC          | `baseUrl` override   | `--backend vertex_ai`                     | `:8791`         |
| `github-copilot` | OAuth (`/login`) | `headroom wrap` only | n/a                                       | n/a             |
| `openai-codex`   | OAuth (`/login`) | `headroom wrap` only | n/a                                       | n/a             |

Example `.pi/models.json` routing the proxy-able (API-key/local) providers through Headroom.
Leave `github-copilot` / `openai-codex` untouched in `models.json` and use `wrap` for them.

```json
{
  "providers": {
    "lmstudio":      { "baseUrl": "http://127.0.0.1:8787/v1/", "api": "openai-responses", "apiKey": "lmstudio" },
    "anthropic":     { "baseUrl": "http://127.0.0.1:8790" },
    "google-vertex": { "baseUrl": "http://127.0.0.1:8791" }
  }
}
```

Start a proxy per provider, each pointed at its real upstream (the proxy needs its own upstream
credentials in the environment — see the auth note above):

```bash
# lmstudio — OpenAI-compatible local server, no real key needed
scripts/setup-headroom.sh --port 8787 -- --openai-api-url http://127.0.0.1:1234/v1

# anthropic — needs ANTHROPIC_API_KEY in the proxy's environment
ANTHROPIC_API_KEY=sk-ant-... scripts/setup-headroom.sh --port 8790

# google-vertex — needs GOOGLE_APPLICATION_CREDENTIALS / ADC
scripts/setup-headroom.sh --port 8791 -- --backend vertex_ai

# github-copilot / openai-codex — do NOT proxy via baseUrl; use wrap modes (see below)
```

### LM Studio (`lmstudio`)

Cleanest case — an API-key, OpenAI-compatible provider. Override `baseUrl`, keep `api` and
`apiKey`. This is the existing default provider in this repo.

### GitHub Copilot (`github-copilot`) — OAuth subscription

The generic proxy authenticates upstream with its own key, so it can't reuse PI's Copilot OAuth
token — a `baseUrl` override won't work. Use Headroom's subscription-aware wrap, which performs
the OAuth exchange itself:

```bash
headroom copilot-auth login
headroom wrap copilot --subscription -- --model gpt-4o
```

This wraps the **standalone Copilot CLI**, not PI's in-app provider. To compress Copilot traffic
*inside PI*, you would need a Copilot OAuth-aware proxy that PI's `baseUrl` could target — not
something the generic proxy provides today.

### OpenAI Codex (`openai-codex`) — OAuth subscription

Same situation as Copilot — ChatGPT Plus/Pro subscription auth isn't reusable by the generic
proxy. Use the wrap mode against the standalone Codex CLI:

```bash
headroom wrap codex
```

### Anthropic (`anthropic`)

Give the proxy an `ANTHROPIC_API_KEY` in its environment; it forwards to `api.anthropic.com` by
default (no upstream flag needed). Set `anthropic.baseUrl` to the **bare proxy host** (no
trailing `/v1/`), since Anthropic-format clients call the host root. For Claude Code (separate
from PI), the equivalent is `headroom wrap claude` or `export ANTHROPIC_BASE_URL=http://127.0.0.1:8790`.

### Google Vertex AI (`google-vertex`)

Run the proxy with `--backend vertex_ai` and standard GCP credentials:

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=your-project
export GOOGLE_CLOUD_LOCATION=us-central1
# or: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa-key.json

scripts/setup-headroom.sh --port 8791 -- --backend vertex_ai
```

> ⚠️ **Verify before relying on it.** Vertex is supported as a Headroom `--backend`, but PI's
> `google-vertex` provider speaks Google's Generative-AI format and uses regional ADC endpoints.
> Confirm end-to-end that PI → proxy → Vertex authenticates and that the request format lines up
> before trusting this provider in production.

## Caveats to verify

1. **OAuth subscriptions can't be proxied via `baseUrl`** (`github-copilot`, `openai-codex`).
   The proxy authenticates upstream with its own key, so it cannot reuse PI's subscription token.
   Use the `wrap` / `copilot-auth` modes against the standalone CLIs instead.
2. **API-format match** — the proxy in front of `anthropic` must speak `anthropic-messages`, and
   the LM Studio proxy `openai-responses`, not just OpenAI chat-completions. If `lmstudio` errors,
   set its PI `api` to `openai-completions` (or confirm Headroom's responses support).
3. **The proxy needs its own upstream credentials** in its environment (`OPENAI_API_KEY`,
   `ANTHROPIC_API_KEY`, GCP ADC, …) — see the auth note at the top.
4. **Measure real savings** — set `HEADROOM_OUTPUT_HOLDOUT=0.1` to keep a control group, and
   check `headroom perf` / `headroom dashboard`.

## Standalone CLIs & RTK

The `github-copilot` / `openai-codex` entries above are PI's *in-app* providers. The standalone
**Copilot CLI** and **Codex CLI** (which share skills via `~/.copilot/skills` / `~/.codex/skills`)
are wrapped the same way as Claude Code — `headroom wrap copilot` / `headroom wrap codex`.

RTK already trims **bash/CLI tool output** in those CLIs via hooks. Headroom compresses the
**whole request context**. They stack at different layers, but both touch shell-output text — to
avoid double-compression, let RTK own tool-output trimming and let Headroom handle broader
context, and confirm net savings with the holdout control group.

## Further reading

- **GitHub repository:** <https://github.com/chopratejas/headroom>
- **Documentation site:** <https://headroom-docs.vercel.app/docs>
- **Proxy reference (flags, upstreams, env):** <https://headroom-docs.vercel.app/docs/proxy>
- **Installation guide:** <https://headroom-docs.vercel.app/docs/installation>
- **PI providers & models:** [`node_modules/@mariozechner/pi-coding-agent/docs/providers.md`](node_modules/@mariozechner/pi-coding-agent/docs/providers.md), [`models.md`](node_modules/@mariozechner/pi-coding-agent/docs/models.md)
