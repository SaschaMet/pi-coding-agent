import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
    DefaultResourceLoader,
    getAgentDir,
    SettingsManager,
    type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { checkExtensionCompat, compareExtensionTrees } from "./check-extension-compat.ts";

const REQUIRED_EXTENSIONS = [
    ".pi/extensions/read-boundary-guard.ts",
    ".pi/extensions/write-boundary-guard.ts",
    ".pi/extensions/gates.ts",
    ".pi/extensions/tools.ts",
];

function listExtensionFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && full.endsWith(".ts")) {
                out.push(full);
            }
        }
    };
    walk(root);
    return out.sort();
}

function createFakePi(): ExtensionAPI {
    const noop = () => undefined;
    const tools: Array<{ name: string }> = [];

    const fakePi = {
        // SAFETY: 0.87 SDK overloads `on` per event; the fake is a universal noop handler
        on: noop as unknown as ExtensionAPI["on"],
        registerTool: ((tool: { name: string }) => {
            tools.push({ name: tool.name });
        }) as ExtensionAPI["registerTool"],
        registerCommand: noop as ExtensionAPI["registerCommand"],
        registerShortcut: noop as ExtensionAPI["registerShortcut"],
        registerFlag: noop as ExtensionAPI["registerFlag"],
        registerMessageRenderer:
            noop as ExtensionAPI["registerMessageRenderer"],
        sendMessage: noop as ExtensionAPI["sendMessage"],
        sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
        appendEntry: noop as ExtensionAPI["appendEntry"],
        setSessionName: noop as ExtensionAPI["setSessionName"],
        getSessionName: (() => undefined) as ExtensionAPI["getSessionName"],
        setLabel: noop as ExtensionAPI["setLabel"],
        getCommands: (() => []) as ExtensionAPI["getCommands"],
        exec: (async () => ({
            stdout: "",
            stderr: "",
            code: 0,
            killed: false,
        })) as ExtensionAPI["exec"],
        getActiveTools: (() =>
            tools.map((tool) => tool.name)) as ExtensionAPI["getActiveTools"],
        // SAFETY: smoke stub — tools carry only the fields this script reads
        getAllTools: (() =>
            tools.map((tool) => ({
                name: tool.name,
                description: "",
                parameters: {},
            }))) as unknown as ExtensionAPI["getAllTools"],

        setActiveTools: noop as ExtensionAPI["setActiveTools"],
        setModel: (async () => true) as ExtensionAPI["setModel"],
        setThinkingLevel: noop as ExtensionAPI["setThinkingLevel"],
        getThinkingLevel: (() =>
            "medium" as ThinkingLevel) as ExtensionAPI["getThinkingLevel"],
        getFlag: (() => undefined) as ExtensionAPI["getFlag"],
        events: { on: noop, off: noop, emit: noop },
        registerProvider: noop as ExtensionAPI["registerProvider"],
        unregisterProvider: noop as ExtensionAPI["unregisterProvider"],
    };

    // SAFETY: smoke stub — implements every member of ExtensionAPI used by the loaded extensions
    return fakePi as unknown as ExtensionAPI;
}

async function main(): Promise<void> {
    const cwd = process.cwd();

    for (const required of REQUIRED_EXTENSIONS) {
        if (!fs.existsSync(path.join(cwd, required))) {
            throw new Error(`Missing required extension: ${required}`);
        }
    }

    const extensionsDir = path.join(cwd, ".pi", "extensions");
    const extensionFiles = listExtensionFiles(extensionsDir);
    const fakePi = createFakePi();

    for (const extensionFile of extensionFiles) {
        const mod = await import(extensionFile);
        if (typeof mod.default === "function") {
            mod.default(fakePi);
        }
    }

    const registeredTools = fakePi.getAllTools().map((tool) => tool.name);
    void registeredTools;

    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd);
    const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
    });
    await loader.reload();

    // Verify the required package is actually installed in the project-local npm root
    // (the real runtime state), so the local .pi/settings.json does not need to mirror
    // the global settings' package list.
    const requiredPackageDir = path.join(
        cwd,
        ".pi",
        "npm",
        "node_modules",
        "@tintinweb",
        "pi-subagents",
    );
    if (!fs.existsSync(requiredPackageDir)) {
        throw new Error(
            "Missing required package: npm:@tintinweb/pi-subagents is not installed under .pi/npm/node_modules.",
        );
    }

    const skills = loader.getSkills().skills;

    // A5 drift guard: every extension/package declaring a peer dependency on the
    // pi host must be compatible with the installed SDK version. Host-range only.
    // The SDK's exports map hides ./package.json, so read it from the install path directly.
    const hostPkgPath = path.join(
        cwd,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
        "package.json",
    );
    let hostPackage: { version: string };
    try {
        // SAFETY: own install tree's package.json — always present when the SDK is imported
        hostPackage = JSON.parse(fs.readFileSync(hostPkgPath, "utf8")) as {
            version: string;
        };
    } catch (error) {
        throw new Error(
            `Cannot read installed pi SDK version from ${hostPkgPath}: ${(error as Error).message}`,
        );
    }
    const violations = checkExtensionCompat({
        dirs: [
            path.join(agentDir, "npm", "node_modules"),
            path.join(agentDir, "extensions"),
            path.join(cwd, ".pi", "extensions"),
            path.join(cwd, ".pi", "npm", "node_modules"),
        ],
        installedVersion: hostPackage.version,
    });
    if (violations.length > 0) {
        for (const v of violations) {
            console.error(
                `Extension compat violation: ${v.name} at ${v.location} requires @earendil-works/pi-coding-agent ${v.range}, installed ${v.installedVersion}`,
            );
        }
        throw new Error(
            `${violations.length} extension(s) incompatible with pi SDK ${hostPackage.version} — align the SDK or update the extension(s).`,
        );
    }

    // Extension-copy drift guard: the project tree is the source of truth and the
    // global tree a synced copy. pi loads both, and the global copy stays inert
    // only while it matches the project twin — drift reactivates stale handlers.
    const drift = compareExtensionTrees(
        path.join(cwd, ".pi", "extensions"),
        path.join(agentDir, "extensions"),
    );
    if (drift.length > 0) {
        for (const d of drift) {
            console.error(
                `Extension copy drift: ${d.path} ${d.status === "differ" ? "differs from" : "is missing in"} the global copy at ${path.join(agentDir, "extensions")}`,
            );
        }
        throw new Error(
            `${drift.length} extension file(s) out of sync with the global copy — run npm run pi:sync-global.`,
        );
    }

    const codexSkills = skills.filter((skill) =>
        skill.filePath.includes(
            `${path.sep}.codex${path.sep}skills${path.sep}`,
        ),
    );

    console.log(`Smoke check passed.`);
    console.log(`Extensions loaded: ${extensionFiles.length}`);
    console.log(`Skills discovered: ${skills.length}`);
    console.log(`Codex skills discovered: ${codexSkills.length}`);
}

main().catch((error) => {
    console.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exit(1);
});
