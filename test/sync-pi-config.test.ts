import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncManagedPiDirectory } from "../scripts/sync-pi-config.ts";

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

describe("sync-pi-config", () => {
    const tmpRoots: string[] = [];

    afterEach(() => {
        for (const root of tmpRoots) {
            fs.rmSync(root, { recursive: true, force: true });
        }
        tmpRoots.length = 0;
    });

    function setupRoots(prefix: string): { localPiDir: string; globalAgentDir: string } {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
        tmpRoots.push(root);
        const localPiDir = path.join(root, "local", ".pi");
        const globalAgentDir = path.join(root, "global", "agent");
        fs.mkdirSync(localPiDir, { recursive: true });
        fs.mkdirSync(globalAgentDir, { recursive: true });
        return { localPiDir, globalAgentDir };
    }

    it("preserves target-only npm packages during pull and push sync", () => {
        const { localPiDir, globalAgentDir } = setupRoots("pi-sync-packages-keep-");

        writeJson(path.join(localPiDir, "settings.json"), {
            defaultProvider: "local-provider",
            packages: ["npm:pi-mcp-adapter@1.0.0"],
        });
        writeJson(path.join(globalAgentDir, "settings.json"), {
            defaultProvider: "global-provider",
            packages: ["npm:pi-mcp-adapter@2.0.0", "npm:pi-task-runner@1.0.0"],
        });

        syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
        const localAfterPull = JSON.parse(fs.readFileSync(path.join(localPiDir, "settings.json"), "utf-8")) as {
            packages: string[];
        };
        expect(localAfterPull.packages).toContain("npm:pi-mcp-adapter@1.0.0");

        writeJson(path.join(globalAgentDir, "settings.json"), {
            defaultProvider: "global-provider-2",
            packages: ["npm:pi-task-runner@1.0.0"],
        });

        syncManagedPiDirectory("push", localPiDir, globalAgentDir);
        const globalAfterPush = JSON.parse(fs.readFileSync(path.join(globalAgentDir, "settings.json"), "utf-8")) as {
            packages: string[];
        };
        expect(globalAfterPush.packages).toContain("npm:pi-mcp-adapter@1.0.0");
    });

    it("keeps target version when npm package spec conflicts", () => {
        const { localPiDir, globalAgentDir } = setupRoots("pi-sync-packages-conflict-");

        writeJson(path.join(localPiDir, "settings.json"), {
            packages: ["npm:pi-mcp-adapter@1.0.0"],
        });
        writeJson(path.join(globalAgentDir, "settings.json"), {
            packages: ["npm:pi-mcp-adapter@2.0.0"],
        });

        syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

        const localSettings = JSON.parse(fs.readFileSync(path.join(localPiDir, "settings.json"), "utf-8")) as {
            packages: string[];
        };
        expect(localSettings.packages).toEqual(["npm:pi-mcp-adapter@1.0.0"]);
    });

    it("still mirrors non-package settings from source", () => {
        const { localPiDir, globalAgentDir } = setupRoots("pi-sync-non-packages-");

        writeJson(path.join(localPiDir, "settings.json"), {
            defaultProvider: "local-provider",
            theme: "light",
            packages: ["npm:pi-mcp-adapter@1.0.0"],
        });
        writeJson(path.join(globalAgentDir, "settings.json"), {
            defaultProvider: "global-provider",
            theme: "dark",
            packages: ["npm:pi-task-runner@1.0.0"],
        });

        syncManagedPiDirectory("push", localPiDir, globalAgentDir);

        const globalSettings = JSON.parse(fs.readFileSync(path.join(globalAgentDir, "settings.json"), "utf-8")) as {
            defaultProvider: string;
            theme: string;
            packages: string[];
        };

        expect(globalSettings.defaultProvider).toBe("local-provider");
        expect(globalSettings.theme).toBe("light");
        expect(globalSettings.packages).toEqual([
            "npm:pi-mcp-adapter@1.0.0",
            "npm:pi-task-runner@1.0.0",
        ]);
    });

    it("falls back to byte-copy semantics when settings JSON is invalid", () => {
        const { localPiDir, globalAgentDir } = setupRoots("pi-sync-invalid-json-");

        const sourceRaw = '{\n  "defaultProvider": "source",\n  "packages": ["npm:pi-mcp-adapter@1.0.0"]\n}\n';
        fs.writeFileSync(path.join(localPiDir, "settings.json"), sourceRaw, "utf-8");
        fs.writeFileSync(path.join(globalAgentDir, "settings.json"), "{ invalid json", "utf-8");

        syncManagedPiDirectory("push", localPiDir, globalAgentDir);

        const targetRaw = fs.readFileSync(path.join(globalAgentDir, "settings.json"), "utf-8");
        expect(targetRaw).toBe(sourceRaw);
    });

    it("merges mcp.json servers without overwriting target-only entries", () => {
        const { localPiDir, globalAgentDir } = setupRoots("pi-sync-mcp-merge-");

        writeJson(path.join(localPiDir, "mcp.json"), {
            mcpServers: {
                localOnly: { command: "local-server" },
            },
        });
        writeJson(path.join(globalAgentDir, "mcp.json"), {
            mcpServers: {
                globalOnly: { command: "global-server" },
            },
        });

        syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

        const localMcp = JSON.parse(fs.readFileSync(path.join(localPiDir, "mcp.json"), "utf-8")) as {
            mcpServers: Record<string, unknown>;
        };
        expect(localMcp.mcpServers).toEqual({
            globalOnly: { command: "global-server" },
            localOnly: { command: "local-server" },
        });
    });

    it("keeps target mcp.json server definition when names conflict", () => {
        const { localPiDir, globalAgentDir } = setupRoots("pi-sync-mcp-conflict-");

        writeJson(path.join(localPiDir, "mcp.json"), {
            mcpServers: {
                shared: { command: "local-server" },
            },
        });
        writeJson(path.join(globalAgentDir, "mcp.json"), {
            mcpServers: {
                shared: { command: "global-server" },
            },
        });

        syncManagedPiDirectory("pull", localPiDir, globalAgentDir);

        const localMcp = JSON.parse(fs.readFileSync(path.join(localPiDir, "mcp.json"), "utf-8")) as {
            mcpServers: Record<string, unknown>;
        };
        expect(localMcp.mcpServers).toEqual({
            shared: { command: "local-server" },
        });
    });

    it("skips syncing models.json for both pull and push", () => {
        const { localPiDir, globalAgentDir } = setupRoots("pi-sync-models-skip-");

        writeJson(path.join(localPiDir, "models.json"), {
            localOnly: "keep-local",
        });
        writeJson(path.join(globalAgentDir, "models.json"), {
            globalOnly: "keep-global",
        });

        const pullResult = syncManagedPiDirectory("pull", localPiDir, globalAgentDir);
        expect(pullResult.updated).toBe(0);
        expect(pullResult.deleted).toBe(0);
        expect(JSON.parse(fs.readFileSync(path.join(localPiDir, "models.json"), "utf-8"))).toEqual({
            localOnly: "keep-local",
        });
        expect(JSON.parse(fs.readFileSync(path.join(globalAgentDir, "models.json"), "utf-8"))).toEqual({
            globalOnly: "keep-global",
        });

        const pushResult = syncManagedPiDirectory("push", localPiDir, globalAgentDir);
        expect(pushResult.updated).toBe(0);
        expect(pushResult.deleted).toBe(0);
        expect(JSON.parse(fs.readFileSync(path.join(localPiDir, "models.json"), "utf-8"))).toEqual({
            localOnly: "keep-local",
        });
        expect(JSON.parse(fs.readFileSync(path.join(globalAgentDir, "models.json"), "utf-8"))).toEqual({
            globalOnly: "keep-global",
        });
    });
});
