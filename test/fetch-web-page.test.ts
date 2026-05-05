import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fetchWebPageExtension from "../.pi/extensions/fetch-web-page.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

describe("fetch_web_page tool", () => {
  const originalArgv = [...process.argv];

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    process.argv = [...originalArgv];
  });

  it("fetches html pages and extracts readability text", async () => {
    const html = `
      <!doctype html>
      <html>
        <head><title>Example Article</title></head>
        <body>
          <nav>Navigation</nav>
          <main>
            <article>
              <h1>Hello world</h1>
              <p>This is the main content.</p>
            </article>
          </main>
          <script>ignored()</script>
        </body>
      </html>
    `;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "https://example.com/article",
        headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) },
        text: async () => html,
      })),
    );

    const pi = createFakePi();
    fetchWebPageExtension(pi as any);
    const tool = pi.tools.get("fetch_web_page");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      "call-fetch",
      { url: "https://example.com/article" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );

    expect(result.isError).toBeFalsy();
    expect(result.details.url).toBe("https://example.com/article");
    expect(result.details.finalUrl).toBe("https://example.com/article");
    expect(result.details.title).toBe("Example Article");
    expect(result.details.text).toContain("Hello world");
    expect(result.details.text).toContain("This is the main content.");
    expect(result.details.text).not.toContain("Navigation");
    expect(result.content[0].text).toContain("Example Article");
  });

  it("returns text/plain pages as readable text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "https://example.com/plain",
        headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "text/plain" : null) },
        text: async () => "Plain text body\nwith multiple lines.",
      })),
    );

    const pi = createFakePi();
    fetchWebPageExtension(pi as any);
    const tool = pi.tools.get("fetch_web_page");

    const result = await tool!.execute(
      "call-fetch-plain",
      { url: "https://example.com/plain" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );

    expect(result.isError).toBeFalsy();
    expect(result.details.contentType).toBe("text/plain");
    expect(result.details.text).toBe("Plain text body\nwith multiple lines.");
  });

  it("rewrites allowlisted localhost URLs to the configured host alias", async () => {
    process.argv = [originalArgv[0] ?? "node", originalArgv[1] ?? "pi", "--container"];
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-localhost-bridge-"));
    fs.mkdirSync(path.join(tempDir, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".pi", "agent.config.json"),
      JSON.stringify({
        localhostBridge: {
          enabled: true,
          hostAlias: "host.docker.internal",
          allowedPorts: [3000],
        },
      }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        status: 200,
        url: String(input),
        headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "text/plain" : null) },
        text: async () => "ok",
      })),
    );

    const pi = createFakePi();
    fetchWebPageExtension(pi as any);
    const tool = pi.tools.get("fetch_web_page");

    const result = await tool!.execute(
      "call-fetch-localhost",
      { url: "http://localhost:3000/health" },
      undefined,
      undefined,
      { cwd: tempDir },
    );

    expect(result.isError).toBeFalsy();
    expect(result.details.url).toBe("http://host.docker.internal:3000/health");
    expect(result.details.finalUrl).toBe("http://host.docker.internal:3000/health");
  });

  it("blocks non-allowlisted localhost ports", async () => {
    process.argv = [originalArgv[0] ?? "node", originalArgv[1] ?? "pi", "--container"];
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-localhost-bridge-"));
    fs.mkdirSync(path.join(tempDir, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".pi", "agent.config.json"),
      JSON.stringify({
        localhostBridge: {
          enabled: true,
          hostAlias: "host.docker.internal",
          allowedPorts: [3000],
        },
      }),
    );

    const pi = createFakePi();
    fetchWebPageExtension(pi as any);
    const tool = pi.tools.get("fetch_web_page");

    const result = await tool!.execute(
      "call-fetch-localhost-blocked",
      { url: "http://localhost:9999/health" },
      undefined,
      undefined,
      { cwd: tempDir },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not allowlisted");
  });

  it("rejects invalid urls", async () => {
    const pi = createFakePi();
    fetchWebPageExtension(pi as any);
    const tool = pi.tools.get("fetch_web_page");

    const result = await tool!.execute(
      "call-fetch-invalid",
      { url: "ftp://example.com/file" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unsupported URL protocol");
  });

  it("times out deterministically when the request takes too long", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal | undefined;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" }));
          });
        });
      }),
    );

    const pi = createFakePi();
    fetchWebPageExtension(pi as any);
    const tool = pi.tools.get("fetch_web_page");

    const promise = tool!.execute(
      "call-fetch-timeout",
      { url: "https://example.com/slow" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );

    await vi.advanceTimersByTimeAsync(15000);
    const result = await promise;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("timed out");
  });
});
