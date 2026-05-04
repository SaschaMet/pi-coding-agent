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
  ]),
  browser: Type.Optional(Type.Union([Type.Literal("chrome"), Type.Literal("brave"), Type.Literal("safari")])),
  url: Type.Optional(Type.String({ description: "Required for open and navigate. Must be http(s)." })),
});

type BrowserName = "chrome" | "brave" | "safari";

type BrowserAction = "list" | "open" | "navigate" | "screenshot" | "close";

interface BrowserParams {
  action: BrowserAction;
  browser?: BrowserName;
  url?: string;
}

const BROWSER_APPS: Record<BrowserName, string> = {
  chrome: "Google Chrome",
  brave: "Brave Browser",
  safari: "Safari",
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
  const candidates: BrowserName[] = requested ? [requested] : ["chrome", "brave", "safari"];
  for (const candidate of candidates) {
    const installed = await appInstalled(pi, BROWSER_APPS[candidate]);
    if (installed) return candidate;
  }
  throw new Error(
    requested
      ? `Requested browser not found: ${requested}`
      : "No supported browser found. Install one of: Google Chrome, Brave Browser, Safari.",
  );
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
  if (browser === "safari") {
    const script = `tell application \"Safari\"\nactivate\nif (count of windows) = 0 then\nmake new document\nend if\nset URL of front document to \"${url.replaceAll("\"", "\\\"")}\"\nend tell`;
    await runAppleScript(pi, script);
    return;
  }

  const appName = BROWSER_APPS[browser];
  const script = `tell application \"${appName}\"\nactivate\nif (count of windows) = 0 then\nmake new window\nend if\nset URL of active tab of front window to \"${url.replaceAll("\"", "\\\"")}\"\nend tell`;
  await runAppleScript(pi, script);
}

async function closeBrowser(pi: ExtensionAPI, browser: BrowserName): Promise<void> {
  const appName = BROWSER_APPS[browser];
  await runAppleScript(pi, `tell application \"${appName}\" to quit`);
}

function tempScreenshotPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-browser-desktop-"));
  return join(dir, "screenshot.png");
}

async function screenshot(pi: ExtensionAPI, browser: BrowserName): Promise<{ path: string; base64: string }> {
  const hasCapture = await commandExists(pi, "screencapture");
  if (!hasCapture) {
    throw new Error("screencapture command not available on this system.");
  }

  await runAppleScript(pi, `tell application \"${BROWSER_APPS[browser]}\" to activate`);

  const screenshotPath = tempScreenshotPath();
  const capture = await pi.exec("screencapture", ["-x", screenshotPath], { timeout: 15000 });
  if (capture.code !== 0) {
    const err = (capture.stderr || capture.stdout || "screencapture failed").trim();
    throw new Error(err);
  }

  const base64 = readFileSync(screenshotPath).toString("base64");
  return { path: screenshotPath, base64 };
}

export default function browserDesktopExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "browser",
    label: "Browser",
    description:
      "Desktop browser automation for local browsers (Chrome/Brave/Safari): open, navigate, screenshot, close.",
    parameters: BrowserParamsSchema,
    execute: async (
      _toolCallId: string,
      params: BrowserParams,
      _signal: AbortSignal | undefined,
      _onUpdate: AgentToolUpdateCallback | undefined,
      _ctx: { cwd: string },
    ) => {
      try {
        if (params.action === "list") {
          const available: BrowserName[] = [];
          for (const name of ["chrome", "brave", "safari"] as const) {
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
