import { createHash } from "node:crypto";
import { lstatSync, readFileSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";

// Loaded from here, not from a settings entry: the opt-in must be decided before the official code runs.
const RUNTIME = join(homedir(), ".hindsight", "coding-agents", "dist", "pi.js");
const SETTINGS_FILE = "piSettings.json";
// A cloned repo controls this file; a size cap and a regular-file check keep a FIFO or /dev/zero link from hanging pi.
const MAX_FILE_BYTES = 4096;
const GATED = new Set(["before_agent_start", "agent_end"]);
const NOT_AVAILABLE = "Hindsight memory is not available in this session: it needs an interactive session in a trusted project.";

type Repo = { root: string; mainRoot: string };
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type Gate = Partial<Pick<ExtensionContext, "mode" | "hasUI" | "isProjectTrusted">> | undefined;

// Subagents, print runs, and projects the user refused to trust get no memory.
const allowed = (ctx: Gate): boolean =>
    ctx?.mode === "tui" && ctx.hasUI === true && ctx.isProjectTrusted?.() === true;

const notAvailable = (): AgentToolResult<undefined> => ({
    content: [{ type: "text", text: NOT_AVAILABLE }],
    details: undefined,
});

function smallFile(path: string): Stats | undefined {
    try {
        const stat = lstatSync(path);
        return stat.isFile() && stat.size <= MAX_FILE_BYTES ? stat : undefined;
    } catch {
        return undefined;
    }
}

// A linked worktree's `.git` file names `<main>/.git/worktrees/<name>`; anything else (a submodule) is its own main checkout.
function mainCheckout(root: string): string {
    const marker = join(root, ".git");
    if (!smallFile(marker)) return root;
    try {
        const gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(marker, "utf8"))?.[1];
        if (!gitdir) return root;
        return /^(.+)[\\/]\.git[\\/]worktrees[\\/][^\\/]+[\\/]?$/.exec(resolve(root, gitdir))?.[1] ?? root;
    } catch {
        return root;
    }
}

// No `git` subprocess: the first folder upward that holds a `.git` file or folder is the top folder.
function findRepo(start: string): Repo | undefined {
    let dir = resolve(start);
    for (;;) {
        try {
            lstatSync(join(dir, ".git"));
            return { root: dir, mainRoot: mainCheckout(dir) };
        } catch {
            const parent = dirname(dir);
            if (parent === dir) return undefined;
            dir = parent;
        }
    }
}

// Only the boolean true opts in; a string, a number, or a parse error is off.
function readUseMemory(path: string): boolean {
    if (!smallFile(path)) return false;
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        return typeof parsed === "object" && parsed !== null && (parsed as { useMemory?: unknown }).useMemory === true;
    } catch {
        return false;
    }
}

// Folder names repeat across clients; the path hash keeps their banks apart.
const bankId = (mainRoot: string): string =>
    `coding-agent::${basename(mainRoot)}-${createHash("sha256").update(mainRoot).digest("hex").slice(0, 8)}`;

const gate =
    (handler: Handler): Handler =>
    (event, ctx) =>
        allowed(ctx) ? handler(event, ctx) : undefined;

function gatedApi(pi: ExtensionAPI): ExtensionAPI {
    const on = pi.on as (event: string, handler: Handler) => () => void;
    return Object.create(pi, {
        on: {
            value: (event: string, handler: Handler) => on(event, GATED.has(event) ? gate(handler) : handler),
        },
        registerTool: {
            value: (tool: ToolDefinition) =>
                pi.registerTool({
                    ...tool,
                    execute: async (id, params, signal, onUpdate, ctx) =>
                        allowed(ctx) ? tool.execute(id, params, signal, onUpdate, ctx) : notAvailable(),
                }),
        },
    }) as ExtensionAPI;
}

export function createHindsightRepo(runtimePath = RUNTIME, cwd = () => process.cwd()) {
    return async function hindsightRepo(pi: ExtensionAPI): Promise<void> {
        if (isShadowedProjectCopy(import.meta.url)) return;
        const repo = findRepo(cwd());
        // Fail closed: no repo, a comma in the path (the runtime splits its path list on it), or anything but the boolean true.
        if (!repo || repo.root.includes(",") || !readUseMemory(join(repo.root, SETTINGS_FILE))) return;
        process.env.HINDSIGHT_OPT_IN_ONLY = "true";
        process.env.HINDSIGHT_OPT_IN_PATHS = repo.root;
        process.env.HINDSIGHT_BANK_ID = bankId(repo.mainRoot);
        // Without a config file the runtime defaults to the vendor cloud.
        process.env.HINDSIGHT_API_URL ??= "http://127.0.0.1:8888";
        process.env.HINDSIGHT_SERVER_MODE ??= "self-hosted";
        try {
            const runtime = (await import(pathToFileURL(runtimePath).href)) as { default: (api: ExtensionAPI) => unknown };
            await runtime.default(gatedApi(pi));
        } catch {
            // Memory is an optimization: a missing or broken runtime must not stop a session.
        }
    };
}

export default createHindsightRepo();
