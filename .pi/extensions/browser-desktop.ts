import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolUpdateCallback, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const BrowserParamsSchema = Type.Object({
  action: Type.Union([
    Type.Literal("list"),
    Type.Literal("open"),
    Type.Literal("navigate"),
    Type.Literal("screenshot"),
    Type.Literal("close"),
    Type.Literal("inspect"),
  ]),
  browser: Type.Optional(Type.Union([Type.Literal("chrome"), Type.Literal("brave")])),
  url: Type.Optional(Type.String({ description: "Required for open, navigate, and inspect. Must be http(s)." })),
  inspect: Type.Optional(Type.Union([Type.Literal("console"), Type.Literal("network"), Type.Literal("all")])),
  durationMs: Type.Optional(Type.Number({ minimum: 250, maximum: 20000 })),
  maxEntries: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
  reload: Type.Optional(Type.Boolean()),
});

type BrowserName = "chrome" | "brave";
type BrowserAction = "list" | "open" | "navigate" | "screenshot" | "close" | "inspect";
type InspectMode = "console" | "network" | "all";

interface BrowserParams {
  action: BrowserAction;
  browser?: BrowserName;
  url?: string;
  inspect?: InspectMode;
  durationMs?: number;
  maxEntries?: number;
  reload?: boolean;
}

interface ConsoleEntry {
  type: string;
  text: string;
  timestamp: number;
}

interface NetworkEntry {
  url: string;
  method: string;
  status?: number;
  resourceType?: string;
  errorText?: string;
  timestamp: number;
}

interface InspectDetails {
  action: "inspect";
  browser: BrowserName;
  url: string;
  inspect: InspectMode;
  durationMs: number;
  maxEntries: number;
  debugPort: number;
  consoleEntries: ConsoleEntry[];
  networkRequests: NetworkEntry[];
}

interface DevToolsTargetInfo {
  id: string;
  type: string;
  title?: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

interface DevToolsVersionInfo {
  webSocketDebuggerUrl?: string;
}

interface DebugBrowserSession {
  pid: number;
  port: number;
}

const DEFAULT_INSPECT_DURATION_MS = 3000;
const DEFAULT_MAX_ENTRIES = 50;
const DEVTOOLS_READY_TIMEOUT_MS = 10000;
const POLL_INTERVAL_MS = 100;

const BROWSER_APPS: Record<BrowserName, string> = {
  chrome: "Google Chrome",
  brave: "Brave Browser",
};

const BROWSER_BINARIES: Record<BrowserName, string> = {
  chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  brave: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
};

function validateUrl(raw: string | undefined): string {
  if (!raw || raw.trim().length === 0) {
    throw new Error("url is required for this action.");
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  return parsed.toString();
}

function normalizeDurationMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_INSPECT_DURATION_MS;
  if (!Number.isFinite(value) || value < 250 || value > 20000) {
    throw new Error("durationMs must be between 250 and 20000.");
  }
  return Math.round(value);
}

function normalizeMaxEntries(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ENTRIES;
  if (!Number.isFinite(value) || value < 1 || value > 200) {
    throw new Error("maxEntries must be between 1 and 200.");
  }
  return Math.round(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function commandExists(pi: ExtensionAPI, command: string): Promise<boolean> {
  const result = await pi.exec("which", [command], { timeout: 5000 });
  return result.code === 0 && result.stdout.trim().length > 0;
}

async function appInstalled(pi: ExtensionAPI, appName: string): Promise<boolean> {
  const escaped = appName.replaceAll("\"", "\\\"");
  const script =
    `set appPath to "/Applications/${escaped}.app"\n` +
    `tell application "System Events"\n` +
    `return exists disk item appPath\n` +
    `end tell`;
  const result = await pi.exec("osascript", ["-e", script], { timeout: 5000 });
  if (result.code !== 0) return false;
  return result.stdout.toLowerCase().includes("true");
}

async function resolveBrowser(pi: ExtensionAPI, requested?: BrowserName): Promise<BrowserName> {
  const candidates: BrowserName[] = requested ? [requested] : ["brave", "chrome"];
  for (const candidate of candidates) {
    const installed = await appInstalled(pi, BROWSER_APPS[candidate]);
    if (installed) return candidate;
  }
  throw new Error(requested ? `Requested browser not found: ${requested}` : "No supported browser found. Install one of: Brave Browser, Google Chrome.");
}

async function runAppleScript(pi: ExtensionAPI, script: string): Promise<void> {
  const result = await pi.exec("osascript", ["-e", script], { timeout: 15000 });
  if (result.code !== 0) {
    const err = (result.stderr || result.stdout || "osascript failed").trim();
    throw new Error(err);
  }
}

async function openUrl(pi: ExtensionAPI, browser: BrowserName, url: string): Promise<void> {
  const appName = BROWSER_APPS[browser];
  const result = await pi.exec("open", ["-a", appName, url], { timeout: 15000 });
  if (result.code !== 0) {
    const err = (result.stderr || result.stdout || "open failed").trim();
    throw new Error(err);
  }
}

async function navigateUrl(pi: ExtensionAPI, browser: BrowserName, url: string): Promise<void> {
  const appName = BROWSER_APPS[browser];
  const script = `tell application "${appName}"\nactivate\nif (count of windows) = 0 then\nmake new window\nend if\nset URL of active tab of front window to "${url.replaceAll("\"", "\\\"")}"\nend tell`;
  await runAppleScript(pi, script);
}

async function closeBrowser(pi: ExtensionAPI, browser: BrowserName): Promise<void> {
  const appName = BROWSER_APPS[browser];
  await runAppleScript(pi, `tell application "${appName}" to quit`);
}

function tempScreenshotPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-browser-desktop-"));
  return join(dir, "screenshot.png");
}

function tempProfileDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-browser-debug-profile-"));
}

async function screenshot(pi: ExtensionAPI, browser: BrowserName): Promise<{ path: string; base64: string }> {
  const hasCapture = await commandExists(pi, "screencapture");
  if (!hasCapture) {
    throw new Error("screencapture command not available on this system.");
  }

  await runAppleScript(pi, `tell application "${BROWSER_APPS[browser]}" to activate`);

  const screenshotPath = tempScreenshotPath();
  const capture = await pi.exec("screencapture", ["-x", screenshotPath], { timeout: 15000 });
  if (capture.code !== 0) {
    const err = (capture.stderr || capture.stdout || "screencapture failed").trim();
    throw new Error(err);
  }

  const base64 = readFileSync(screenshotPath).toString("base64");
  return { path: screenshotPath, base64 };
}

function pickDebugPort(): number {
  return 40000 + Math.floor(Math.random() * 20000);
}

async function launchDebugBrowser(pi: ExtensionAPI, browser: BrowserName): Promise<DebugBrowserSession> {
  const port = pickDebugPort();
  const userDataDir = tempProfileDir();
  const binary = BROWSER_BINARIES[browser];
  const command =
    `${quoteForShell(binary)} ` +
    `--remote-debugging-port=${port} ` +
    `--user-data-dir=${quoteForShell(userDataDir)} ` +
    `--no-first-run --no-default-browser-check about:blank >/dev/null 2>&1 & echo $!`;

  const result = await pi.exec("sh", ["-lc", command], { timeout: 5000 });
  if (result.code !== 0) {
    const err = (result.stderr || result.stdout || "Failed to launch debug browser").trim();
    throw new Error(err);
  }
  const pid = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) {
    throw new Error(`Failed to parse browser pid from: ${result.stdout.trim()}`);
  }
  return { pid, port };
}

async function waitForJson<T>(url: string, validate: (data: unknown) => T | undefined, signal?: AbortSignal): Promise<T> {
  const deadline = Date.now() + DEVTOOLS_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Browser inspection aborted.");
    try {
      const response = await fetch(url, { signal });
      if (response.ok) {
        const data = await response.json();
        const validated = validate(data);
        if (validated !== undefined) return validated;
      }
    } catch {
      // Browser may still be starting.
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for DevTools endpoint: ${url}`);
}

function summarizeConsoleEntries(entries: ConsoleEntry[]): string {
  if (entries.length === 0) return "none";
  return entries
    .slice(0, 3)
    .map((entry) => `${entry.type}: ${entry.text}`)
    .join(" | ");
}

function summarizeNetworkEntries(entries: NetworkEntry[]): string {
  if (entries.length === 0) return "none";
  return entries
    .slice(0, 3)
    .map((entry) => `${entry.method} ${entry.url}${entry.status !== undefined ? ` -> ${entry.status}` : ""}`)
    .join(" | ");
}

async function inspectBrowser(
  pi: ExtensionAPI,
  browser: BrowserName,
  url: string,
  inspect: InspectMode,
  durationMs: number,
  maxEntries: number,
  reload: boolean,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<InspectDetails>,
): Promise<InspectDetails> {
  const { pid, port } = await launchDebugBrowser(pi, browser);
  try {
    const versionInfo = await waitForJson<DevToolsVersionInfo>(
      `http://127.0.0.1:${port}/json/version`,
      (data) => {
        if (!data || typeof data !== "object") return undefined;
        const value = data as DevToolsVersionInfo;
        return typeof value.webSocketDebuggerUrl === "string" ? value : undefined;
      },
      signal,
    );

    const target = await waitForJson<DevToolsTargetInfo>(
      `http://127.0.0.1:${port}/json/list`,
      (data) => {
        if (!Array.isArray(data)) return undefined;
        return data.find(
          (entry): entry is DevToolsTargetInfo =>
            !!entry &&
            typeof entry === "object" &&
            (entry as DevToolsTargetInfo).type === "page" &&
            typeof (entry as DevToolsTargetInfo).webSocketDebuggerUrl === "string",
        );
      },
      signal,
    );

    const pageSocketUrl = target.webSocketDebuggerUrl;
    if (!pageSocketUrl) {
      throw new Error("DevTools page target missing webSocketDebuggerUrl.");
    }

    const consoleEntries: ConsoleEntry[] = [];
    const networkMap = new Map<string, NetworkEntry>();
    const networkRequests: NetworkEntry[] = [];
    const details = (): InspectDetails => ({
      action: "inspect",
      browser,
      url,
      inspect,
      durationMs,
      maxEntries,
      debugPort: port,
      consoleEntries: [...consoleEntries],
      networkRequests: [...networkRequests],
    });

    await withDevToolsSocket(pageSocketUrl, async (client) => {
      if (inspect === "console" || inspect === "all") {
        await client.send("Runtime.enable");
        await client.send("Console.enable");
      }
      if (inspect === "network" || inspect === "all") {
        await client.send("Network.enable");
      }
      await client.send("Page.enable");

      client.on("Runtime.consoleAPICalled", (params) => {
        if (consoleEntries.length >= maxEntries) return;
        const args = Array.isArray(params?.args) ? params.args : [];
        const text = args
          .map((arg: { value?: unknown; description?: string; type?: string }) => {
            if (arg.value !== undefined) return String(arg.value);
            if (arg.description) return arg.description;
            return arg.type ?? "unknown";
          })
          .join(" ");
        consoleEntries.push({
          type: typeof params?.type === "string" ? params.type : "log",
          text,
          timestamp: Number.isFinite(params?.timestamp) ? Number(params.timestamp) : Date.now(),
        });
      });

      client.on("Runtime.exceptionThrown", (params) => {
        if (consoleEntries.length >= maxEntries) return;
        const exceptionText =
          typeof params?.exceptionDetails?.text === "string"
            ? params.exceptionDetails.text
            : typeof params?.exceptionDetails?.exception?.description === "string"
              ? params.exceptionDetails.exception.description
              : "Unhandled exception";
        consoleEntries.push({
          type: "exception",
          text: exceptionText,
          timestamp: Number.isFinite(params?.timestamp) ? Number(params.timestamp) : Date.now(),
        });
      });

      client.on("Network.requestWillBeSent", (params) => {
        const requestId = typeof params?.requestId === "string" ? params.requestId : "";
        const request = params?.request;
        if (!requestId || !request || networkMap.has(requestId) || networkRequests.length >= maxEntries) return;
        const entry: NetworkEntry = {
          url: typeof request.url === "string" ? request.url : "",
          method: typeof request.method === "string" ? request.method : "GET",
          resourceType: typeof params?.type === "string" ? params.type : undefined,
          timestamp: Number.isFinite(params?.timestamp) ? Number(params.timestamp) : Date.now(),
        };
        networkMap.set(requestId, entry);
        networkRequests.push(entry);
      });

      client.on("Network.responseReceived", (params) => {
        const requestId = typeof params?.requestId === "string" ? params.requestId : "";
        const entry = networkMap.get(requestId);
        if (!entry) return;
        const response = params?.response;
        if (response && Number.isFinite(response.status)) {
          entry.status = Number(response.status);
        }
      });

      client.on("Network.loadingFailed", (params) => {
        const requestId = typeof params?.requestId === "string" ? params.requestId : "";
        const entry = networkMap.get(requestId);
        if (!entry) return;
        if (typeof params?.errorText === "string") {
          entry.errorText = params.errorText;
        }
      });

      await client.send("Page.navigate", { url });
      if (reload) {
        await client.send("Page.reload", { ignoreCache: false });
      }

      await delay(durationMs);
    });

    onUpdate?.({
      content: [
        {
          type: "text",
          text: `Captured ${consoleEntries.length} console entries and ${networkRequests.length} network requests in ${browser}.`,
        },
      ],
      details: details(),
    });

    return details();
  } finally {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Browser may have already exited.
    }
  }
}

class DevToolsClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
  private readonly listeners = new Map<string, Array<(params: any) => void>>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : "";
      if (!data) return;
      const message = JSON.parse(data) as { id?: number; method?: string; params?: any; error?: { message?: string } };
      if (typeof message.id === "number") {
        const handler = this.pending.get(message.id);
        if (!handler) return;
        this.pending.delete(message.id);
        if (message.error?.message) {
          handler.reject(new Error(message.error.message));
        } else {
          handler.resolve(message);
        }
        return;
      }
      if (!message.method) return;
      const handlers = this.listeners.get(message.method) ?? [];
      for (const handler of handlers) handler(message.params);
    });

    socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("DevTools socket closed."));
      }
      this.pending.clear();
    });

    socket.addEventListener("error", () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("DevTools socket error."));
      }
      this.pending.clear();
    });
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    const result = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(payload);
    });
    return result as T;
  }

  on(method: string, handler: (params: any) => void): void {
    const existing = this.listeners.get(method) ?? [];
    existing.push(handler);
    this.listeners.set(method, existing);
  }
}

async function withDevToolsSocket<T>(url: string, fn: (client: DevToolsClient) => Promise<T>): Promise<T> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Failed to connect to DevTools WebSocket.")), { once: true });
  });

  const client = new DevToolsClient(socket);
  try {
    return await fn(client);
  } finally {
    socket.close();
  }
}

export default function browserDesktopExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browser",
    label: "Browser",
    description:
      "Desktop browser automation for local Chrome/Brave: open, navigate, screenshot, close, and inspect console/network activity.",
    parameters: BrowserParamsSchema,
    execute: async (
      _toolCallId: string,
      params: BrowserParams,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback | undefined,
      _ctx: { cwd: string },
    ) => {
      try {
        if (params.action === "list") {
          const available: BrowserName[] = [];
          for (const name of ["chrome", "brave"] as const) {
            if (await appInstalled(pi, BROWSER_APPS[name])) available.push(name);
          }
          return {
            content: [{ type: "text" as const, text: available.length ? `Available browsers: ${available.join(", ")}` : "No supported browser found." }],
            details: { action: "list", available },
          };
        }

        const browser = await resolveBrowser(pi, params.browser);

        if (params.action === "open") {
          const url = validateUrl(params.url);
          await openUrl(pi, browser, url);
          return {
            content: [{ type: "text" as const, text: `Opened ${url} in ${browser}.` }],
            details: { action: "open", browser, url },
          };
        }

        if (params.action === "navigate") {
          const url = validateUrl(params.url);
          await navigateUrl(pi, browser, url);
          return {
            content: [{ type: "text" as const, text: `Navigated ${browser} to ${url}.` }],
            details: { action: "navigate", browser, url },
          };
        }

        if (params.action === "screenshot") {
          const shot = await screenshot(pi, browser);
          return {
            content: [
              { type: "text" as const, text: `Screenshot saved: ${shot.path}` },
              { type: "image" as const, data: shot.base64, mimeType: "image/png" },
            ],
            details: { action: "screenshot", browser, screenshotPath: shot.path },
          };
        }

        if (params.action === "inspect") {
          const url = validateUrl(params.url);
          const inspect = params.inspect ?? "all";
          const durationMs = normalizeDurationMs(params.durationMs);
          const maxEntries = normalizeMaxEntries(params.maxEntries);
          const details = await inspectBrowser(pi, browser, url, inspect, durationMs, maxEntries, params.reload ?? false, signal, onUpdate);
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Captured ${details.consoleEntries.length} console entries and ${details.networkRequests.length} network requests in ${browser}. ` +
                  `Console: ${summarizeConsoleEntries(details.consoleEntries)}. ` +
                  `Network: ${summarizeNetworkEntries(details.networkRequests)}.`,
              },
            ],
            details,
          };
        }

        if (params.action === "close") {
          await closeBrowser(pi, browser);
          return {
            content: [{ type: "text" as const, text: `Closed ${browser}.` }],
            details: { action: "close", browser },
          };
        }

        return {
          content: [{ type: "text" as const, text: `Unsupported action: ${params.action}` }],
          details: { action: params.action, browser: params.browser },
          isError: true,
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Browser tool failed: ${error instanceof Error ? error.message : String(error)}` }],
          details: { action: params.action, browser: params.browser, url: params.url },
          isError: true,
        };
      }
    },
  });
}
