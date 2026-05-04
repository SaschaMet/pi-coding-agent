import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DefaultResourceLoader, SettingsManager, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import {
    getMissingCapabilityTools,
    loadCapabilityConfig,
    validateCapabilityConfig,
} from "../.pi/extensions/capability-policy.ts";
import { discoverAgents } from "../.pi/extensions/subagent/agents.ts";

const REQUIRED_EXTENSIONS = [
    ".pi/extensions/ask-questions.ts",
    ".pi/extensions/web-search.ts",
    ".pi/extensions/fetch-web-page.ts",
    ".pi/extensions/capability-policy.ts",
    ".pi/extensions/capability-enforcer.ts",
    ".pi/extensions/permission-gate.ts",
    ".pi/extensions/protected-paths.ts",
    ".pi/extensions/bash-sandbox.ts",
    ".pi/extensions/tools.ts",
    ".pi/extensions/plan-mode/index.ts",
    ".pi/extensions/subagent/index.ts",
    ".pi/security/capabilities.json",
    ".pi/security/capabilities.schema.json",
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
        on: noop as ExtensionAPI["on"],
        registerTool: ((tool: { name: string }) => {
            tools.push({ name: tool.name });
        }) as ExtensionAPI["registerTool"],
        registerCommand: noop as ExtensionAPI["registerCommand"],
        registerShortcut: noop as ExtensionAPI["registerShortcut"],
        registerFlag: noop as ExtensionAPI["registerFlag"],
        registerMessageRenderer: noop as ExtensionAPI["registerMessageRenderer"],
        sendMessage: noop as ExtensionAPI["sendMessage"],
        sendUserMessage: noop as ExtensionAPI["sendUserMessage"],
        appendEntry: noop as ExtensionAPI["appendEntry"],
        setSessionName: noop as ExtensionAPI["setSessionName"],
        getSessionName: (() => undefined) as ExtensionAPI["getSessionName"],
        setLabel: noop as ExtensionAPI["setLabel"],
        getCommands: (() => []) as ExtensionAPI["getCommands"],
        exec: (async () => ({ stdout: "", stderr: "", code: 0, killed: false })) as ExtensionAPI["exec"],
        getActiveTools: (() => tools.map((tool) => tool.name)) as ExtensionAPI["getActiveTools"],
        getAllTools: (() =>
            tools.map((tool) => ({
                name: tool.name,
                description: "",
                parameters: {},
            }))) as unknown as ExtensionAPI["getAllTools"],
        setActiveTools: noop as ExtensionAPI["setActiveTools"],
        setModel: (async () => true) as ExtensionAPI["setModel"],
        setThinkingLevel: noop as ExtensionAPI["setThinkingLevel"],
        getThinkingLevel: (() => "medium" as ThinkingLevel) as ExtensionAPI["getThinkingLevel"],
        getFlag: (() => undefined) as ExtensionAPI["getFlag"],
        events: { on: noop, off: noop, emit: noop },
        registerProvider: noop as ExtensionAPI["registerProvider"],
        unregisterProvider: noop as ExtensionAPI["unregisterProvider"],
    };

    return fakePi as unknown as ExtensionAPI;
}

async function main(): Promise<void> {
    const cwd = process.cwd();

    for (const required of REQUIRED_EXTENSIONS) {
        if (!fs.existsSync(path.join(cwd, required))) {
            throw new Error(`Missing required extension: ${required}`);
        }
    }

    const extensionsDir = path.join(cwd, ".pi", "extensions"); const extensionFiles = listExtensionFiles(extensionsDir);
    const fakePi = createFakePi();

    for (const extensionFile of extensionFiles) {
        const mod = await import(extensionFile);
        if (typeof mod.default === "function") {
            mod.default(fakePi);
        }
    }

    const builtInTools = ["read", "bash", "edit", "write", "grep", "find", "ls", "mcp"];
    const registeredTools = fakePi.getAllTools().map((tool) => tool.name);
    const { agents } = discoverAgents(cwd, "both");
    const subagentTools = agents.flatMap((agent) => agent.tools ?? []);
    const capabilityConfig = loadCapabilityConfig(cwd);
    const capabilityErrors = validateCapabilityConfig(capabilityConfig);
    if (capabilityErrors.length > 0) {
        throw new Error(`Capability config invalid: ${capabilityErrors.join("; ")}`);
    }
    const missingCapabilities = getMissingCapabilityTools([...builtInTools, ...registeredTools, ...subagentTools], capabilityConfig);
    if (missingCapabilities.length > 0) {
        throw new Error(`Capability coverage missing entries for: ${missingCapabilities.join(", ")}`);
    }

    const settingsManager = SettingsManager.create(cwd);
    const loader = new DefaultResourceLoader({ cwd, settingsManager });
    await loader.reload();

    const skills = loader.getSkills().skills;
    const codexSkills = skills.filter((skill) => skill.filePath.includes(`${path.sep}.codex${path.sep}skills${path.sep}`));

    console.log(`Smoke check passed.`);
    console.log(`Extensions loaded: ${extensionFiles.length}`);
    console.log(`Skills discovered: ${skills.length}`);
    console.log(`Codex skills discovered: ${codexSkills.length}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
