# Playwright MCP: outdated Chromium (Nov 2026)

**Status:** open on 2026-11-21. Re-check until the image is patched, then mark it closed here.

## Rule

- Do not point `MCP_DOCKER_PLAYWRIGHT` at untrusted sites until `mcp/playwright:latest` ships `chromium-1255` or higher.
- Why: the image's Chromium predates the Chrome 156 security fixes, and Playwright launches Chromium without its sandbox by default. A renderer exploit would then run as the container user, with no sandbox to escape.
- Limit the blast radius: the server runs in a Docker container, is lazy-loaded (`lifecycle: "lazy"` in `.pi/mcp-adapter.json`), and gets no host mounts or secrets from this repo. Keep it that way.

## What was found (2026-11-21)

| Item | Result |
| --- | --- |
| This repo | No `playwright`, `playwright-core` or `@playwright/test` dependency. Not affected. |
| Host cache `~/Library/Caches/ms-playwright` | Old builds (`chromium-1187`, `-1234`, `-1248`) deleted. Only `chromium-1255` (Chromium 159.0.8154.6) remains. |
| `mcp/playwright:latest` | Ships `chromium-1226`: older than Chromium 151, below the fix. Docker had no newer image. |

## The CVEs

- CVE-2026-118306, -118331, -118348, -118344: Chromium flaws reported against the build Playwright 1.64.1 pins (156.0.8078.4). Fixed in Chromium 156.0.8078.73 (Chrome Stable, 2026-10-27).
- The `playwright` npm package itself is not the flaw; it only pins the browser build.
- Sources are secondary (a post by nisten on 2026-11-02 and the `malicious-artifacts/playwright-sandbox-research` repo). Unverified against NVD.

## Check for a fix

```sh
docker pull mcp/playwright:latest
docker run --rm --entrypoint sh mcp/playwright:latest -c 'ls /ms-playwright'
```

- Fixed: the list shows `chromium-1255` or higher.
- Still open: it shows `chromium-1226` (or any lower revision).
- Revision to version: 1187 = 140, 1234 = 151, 1248 = 156.0.8078.4 (vulnerable), 1255 = 159.

The Docker commands run in a normal terminal. The agent's sandbox has no Docker socket.
