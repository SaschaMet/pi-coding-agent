import { afterEach, describe, expect, it, vi } from "vitest";
import browserDesktopExtension from "../.pi/extensions/browser-desktop.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  private readonly listeners = new Map<string, Array<(event?: any) => void>>();
  private closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("open"));
  }

  addEventListener(type: string, handler: (event?: any) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  send(payload: string): void {
    const message = JSON.parse(payload) as { id: number; method: string; params?: Record<string, unknown> };
    queueMicrotask(() => {
      this.emit("message", { data: JSON.stringify({ id: message.id, result: {} }) });
      if (message.method === "Page.navigate") {
        this.emit("message", {
          data: JSON.stringify({
            method: "Runtime.consoleAPICalled",
            params: {
              type: "error",
              args: [{ value: "boom" }],
              timestamp: 123,
            },
          }),
        });
        this.emit("message", {
          data: JSON.stringify({
            method: "Network.requestWillBeSent",
            params: {
              requestId: "req-1",
              request: { url: "https://example.com/api/items", method: "GET" },
              type: "Fetch",
              timestamp: 456,
            },
          }),
        });
        this.emit("message", {
          data: JSON.stringify({
            method: "Network.responseReceived",
            params: {
              requestId: "req-1",
              response: { status: 200 },
            },
          }),
        });
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.emit("close"));
  }

  private emit(type: string, event?: any): void {
    const handlers = this.listeners.get(type) ?? [];
    for (const handler of handlers) handler(event);
  }
}

describe("browser tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeWebSocket.instances = [];
  });

  it("lists only chrome and brave", async () => {
    const pi = createFakePi();
    pi.exec = vi.fn(async (command: string, args: string[]) => {
      if (command !== "osascript") return { stdout: "", stderr: "", code: 0, killed: false };
      const script = args[1] ?? "";
      if (script.includes("Google Chrome")) return { stdout: "true\n", stderr: "", code: 0, killed: false };
      if (script.includes("Brave Browser")) return { stdout: "true\n", stderr: "", code: 0, killed: false };
      return { stdout: "false\n", stderr: "", code: 0, killed: false };
    });

    browserDesktopExtension(pi as any);
    const tool = pi.tools.get("browser");

    const result = await tool!.execute("call-list", { action: "list" }, undefined, undefined, { cwd: process.cwd() });

    expect(result.isError).toBeFalsy();
    expect(result.details.available).toEqual(["chrome", "brave"]);
    expect(result.content[0].text).toContain("chrome, brave");
    expect(result.content[0].text).not.toContain("safari");
  });

  it("captures console and network entries during inspect", async () => {
    vi.stubGlobal("WebSocket", FakeWebSocket as any);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/json/version")) {
          return {
            ok: true,
            json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/browser-id" }),
          };
        }
        if (url.endsWith("/json/list")) {
          return {
            ok: true,
            json: async () => [
              {
                id: "page-1",
                type: "page",
                url: "about:blank",
                webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/page-1",
              },
            ],
          };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const pi = createFakePi();
    pi.exec = vi.fn(async (command: string, args: string[]) => {
      if (command === "osascript") {
        return { stdout: "true\n", stderr: "", code: 0, killed: false };
      }
      if (command === "sh" && args[0] === "-lc") {
        return { stdout: "4321\n", stderr: "", code: 0, killed: false };
      }
      return { stdout: "", stderr: "", code: 0, killed: false };
    });

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    browserDesktopExtension(pi as any);
    const tool = pi.tools.get("browser");
    const updates: any[] = [];

    const result = await tool!.execute(
      "call-inspect",
      { action: "inspect", browser: "chrome", url: "https://example.com", durationMs: 250, maxEntries: 10 },
      undefined,
      (update) => updates.push(update),
      { cwd: process.cwd() },
    );

    expect(result.isError).toBeFalsy();
    expect(result.details.browser).toBe("chrome");
    expect(result.details.consoleEntries).toEqual([{ type: "error", text: "boom", timestamp: 123 }]);
    expect(result.details.networkRequests).toEqual([
      {
        url: "https://example.com/api/items",
        method: "GET",
        resourceType: "Fetch",
        timestamp: 456,
        status: 200,
      },
    ]);
    expect(result.content[0].text).toContain("Captured 1 console entries and 1 network requests");
    expect(updates).toHaveLength(1);
    expect(killSpy).toHaveBeenCalledWith(4321, "SIGTERM");
  });
});
