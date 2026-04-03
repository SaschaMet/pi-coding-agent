import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import webSearchExtension, {
  loadSearchConfig,
  normalizeBraveResults,
  normalizeSerperResults,
  normalizeTavilyResults,
} from "../.pi/extensions/web-search.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

describe("web_search tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BRAVE_API_KEY;
    delete process.env.SERPER_API_KEY;
    delete process.env.TAVILY_API_KEY;
    delete process.env.PI_CODING_AGENT_DIR;
    delete process.env.PI_CODER_REPO;
  });

  it("normalizes provider payloads", () => {
    expect(
      normalizeBraveResults(
        { web: { results: [{ title: "A", url: "https://a.test", description: "desc", extra_snippets: ["x"] }] } },
        true,
      ),
    ).toEqual([{ title: "A", url: "https://a.test", snippet: "desc", content: "x" }]);

    expect(
      normalizeTavilyResults({ results: [{ title: "B", url: "https://b.test", content: "c", raw_content: "raw" }] }, true),
    ).toEqual([{ title: "B", url: "https://b.test", snippet: "c", content: "raw" }]);

    expect(normalizeSerperResults({ organic: [{ title: "C", link: "https://c.test", snippet: "sn" }] }, false)).toEqual([
      { title: "C", url: "https://c.test", snippet: "sn", content: undefined },
    ]);
  });

  it("uses configurable default provider from project config", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-search-test-"));
    fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".pi", "agent.config.json"),
      JSON.stringify({ search: { defaultProvider: "serper" } }, null, 2),
      "utf-8",
    );

    const config = loadSearchConfig(tmp);
    expect(config.defaultProvider).toBe("serper");

    process.env.SERPER_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          organic: [{ title: "Result", link: "https://example.com", snippet: "snippet" }],
        }),
      })),
    );

    const pi = createFakePi();
    webSearchExtension(pi as any);
    const tool = pi.tools.get("web_search");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      "call-search",
      { query: "test query" },
      undefined,
      undefined,
      { cwd: tmp },
    );

    expect(result.details.provider).toBe("serper");
    expect(result.details.results[0].url).toBe("https://example.com");
  });

  it("loads the Brave API key from a local .env file", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-search-dotenv-test-"));
    fs.writeFileSync(path.join(tmp, ".env"), "BRAVE_API_KEY=dotenv-key\n", "utf-8");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        web: { results: [{ title: "Result", url: "https://example.com", description: "snippet" }] },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const pi = createFakePi();
    webSearchExtension(pi as any);
    const tool = pi.tools.get("web_search");
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      "call-search-dotenv",
      { query: "test query" },
      undefined,
      undefined,
      { cwd: tmp },
    );

    expect(result.isError).toBeFalsy();
    expect(result.details.provider).toBe("brave");
    expect(result.details.results[0].url).toBe("https://example.com");
    expect(process.env.BRAVE_API_KEY).toBeUndefined();
  });

  it("loads API key from configured envService file in global settings", async () => {
    const tmpGlobal = fs.mkdtempSync(path.join(os.tmpdir(), "pi-global-config-"));
    process.env.PI_CODING_AGENT_DIR = tmpGlobal;

    const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-coder-repo-"));
    process.env.PI_CODER_REPO = tmpRepo;
    fs.writeFileSync(path.join(tmpRepo, ".env"), "BRAVE_API_KEY=repo-env-key\n", "utf-8");

    fs.writeFileSync(
      path.join(tmpGlobal, "settings.json"),
      JSON.stringify(
        {
          envService: {
            envFile: "${PI_CODER_REPO}/.env",
            useProjectEnv: true,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-random-project-"));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          web: { results: [{ title: "Result", url: "https://example.com", description: "snippet" }] },
        }),
      })),
    );

    const pi = createFakePi();
    webSearchExtension(pi as any);
    const tool = pi.tools.get("web_search");

    const result = await tool!.execute(
      "call-search-global-env-service",
      { query: "test query", provider: "brave" },
      undefined,
      undefined,
      { cwd: tmpCwd },
    );

    expect(result.isError).toBeFalsy();
    expect(result.details.provider).toBe("brave");
    expect(result.details.results[0].url).toBe("https://example.com");
  });

  it("returns deterministic error payload when provider call fails", async () => {
    process.env.BRAVE_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        json: async () => ({}),
      })),
    );

    const pi = createFakePi();
    webSearchExtension(pi as any);
    const tool = pi.tools.get("web_search");
    const result = await tool!.execute(
      "call-search-error",
      { query: "test query", provider: "brave" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );

    expect(result.isError).toBe(true);
    expect(result.details.provider).toBe("brave");
    expect(result.details.results).toEqual([]);
    expect(result.content[0].text).toContain("Web search failed");
  });
});
