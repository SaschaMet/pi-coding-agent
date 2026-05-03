import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { loadProjectAgentConfig } from "../.pi/extensions/shared/agent-config.ts";

describe("loadProjectAgentConfig", () => {
    let tmpRoot: string;
    let originalHomedir: () => string;
    let originalEnvPI: string | undefined;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-config-"));
        originalHomedir = os.homedir;
        originalEnvPI = process.env.PI_CODING_AGENT_DIR;
    });

    afterEach(() => {
        if (originalHomedir) {
            (os as unknown as { homedir: () => string }).homedir = originalHomedir;
        }
        if (originalEnvPI === undefined) {
            delete process.env.PI_CODING_AGENT_DIR;
        } else {
            process.env.PI_CODING_AGENT_DIR = originalEnvPI;
        }
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("returns config when local .pi/agent.config.json exists", () => {
        const projectRoot = path.join(tmpRoot, "project-a");
        fs.mkdirSync(path.join(projectRoot, ".pi"), { recursive: true });

        fs.writeFileSync(
            path.join(projectRoot, ".pi", "agent.config.json"),
            JSON.stringify({ subagent: { strictLocalRuntime: false } }),
        );

        const result = loadProjectAgentConfig(projectRoot);
        expect(result).toEqual({ subagent: { strictLocalRuntime: false } });
    });

    it("returns undefined when no local or global config exists", () => {
        const projectRoot = path.join(tmpRoot, "project-b");
        fs.mkdirSync(path.join(projectRoot, ".pi"), { recursive: true });

        // Mock homedir to a temp dir with no config
        const fakeHome = path.join(tmpRoot, "fake-home");
        fs.mkdirSync(fakeHome, { recursive: true });
        (os as unknown as { homedir: () => string }).homedir = () => fakeHome;
        delete process.env.PI_CODING_AGENT_DIR;

        const result = loadProjectAgentConfig(projectRoot);
        expect(result).toBeUndefined();
    });

    it("returns undefined for invalid JSON without crashing", () => {
        const projectRoot = path.join(tmpRoot, "project-c");
        fs.mkdirSync(path.join(projectRoot, ".pi"), { recursive: true });

        fs.writeFileSync(
            path.join(projectRoot, ".pi", "agent.config.json"),
            "{ invalid json }}}",
        );

        const result = loadProjectAgentConfig(projectRoot);
        expect(result).toBeUndefined();
    });

    it("falls back to PI_CODING_AGENT_DIR when set and no local config exists", () => {
        const globalDir = path.join(tmpRoot, "global-agent");
        fs.mkdirSync(globalDir, { recursive: true });

        fs.writeFileSync(
            path.join(globalDir, "agent.config.json"),
            JSON.stringify({ subagent: { strictLocalRuntime: false } }),
        );

        const projectRoot = path.join(tmpRoot, "project-d");
        fs.mkdirSync(path.join(projectRoot, ".pi"), { recursive: true });
        // No agent.config.json in project

        const fakeHome = path.join(tmpRoot, "fake-home-d");
        fs.mkdirSync(fakeHome, { recursive: true });
        (os as unknown as { homedir: () => string }).homedir = () => fakeHome;

        process.env.PI_CODING_AGENT_DIR = globalDir;

        const result = loadProjectAgentConfig(projectRoot);
        expect(result).toEqual({ subagent: { strictLocalRuntime: false } });
    });

    it("prefers local config over PI_CODING_AGENT_DIR when both exist", () => {
        const globalDir = path.join(tmpRoot, "global-agent-pref");
        fs.mkdirSync(globalDir, { recursive: true });

        fs.writeFileSync(
            path.join(globalDir, "agent.config.json"),
            JSON.stringify({ subagent: { strictLocalRuntime: true } }),
        );

        const projectRoot = path.join(tmpRoot, "project-e");
        fs.mkdirSync(path.join(projectRoot, ".pi"), { recursive: true });

        fs.writeFileSync(
            path.join(projectRoot, ".pi", "agent.config.json"),
            JSON.stringify({ subagent: { strictLocalRuntime: false } }),
        );

        const fakeHome = path.join(tmpRoot, "fake-home-e");
        fs.mkdirSync(fakeHome, { recursive: true });
        (os as unknown as { homedir: () => string }).homedir = () => fakeHome;

        process.env.PI_CODING_AGENT_DIR = globalDir;

        const result = loadProjectAgentConfig(projectRoot);
        expect(result).toEqual({ subagent: { strictLocalRuntime: false } });
    });

    it("falls back to ~/.pi/agent when PI_CODING_AGENT_DIR is not set and no local config exists", () => {
        const globalDir = path.join(tmpRoot, "fallback-agent");
        const globalConfigDir = path.join(globalDir, ".pi", "agent");
        fs.mkdirSync(globalConfigDir, { recursive: true });

        fs.writeFileSync(
            path.join(globalConfigDir, "agent.config.json"),
            JSON.stringify({ subagent: { strictLocalRuntime: false } }),
        );

        // Temporarily replace homedir to point to our fake global dir
        (os as unknown as { homedir: () => string }).homedir = () => globalDir;
        delete process.env.PI_CODING_AGENT_DIR;

        const projectRoot = path.join(tmpRoot, "project-f");
        fs.mkdirSync(path.join(projectRoot, ".pi"), { recursive: true });
        // No agent.config.json in project

        const result = loadProjectAgentConfig(projectRoot);
        expect(result).toEqual({ subagent: { strictLocalRuntime: false } });
    });

    it("falls back to ~/.pi/agent when PI_CODING_AGENT_DIR config is missing", () => {
        const envGlobalDir = path.join(tmpRoot, "env-agent");
        fs.mkdirSync(envGlobalDir, { recursive: true });
        // No config in envGlobalDir

        const homeGlobalDir = path.join(tmpRoot, "home-agent");
        const homeConfigDir = path.join(homeGlobalDir, ".pi", "agent");
        fs.mkdirSync(homeConfigDir, { recursive: true });
        fs.writeFileSync(
            path.join(homeConfigDir, "agent.config.json"),
            JSON.stringify({ subagent: { strictLocalRuntime: true } }),
        );

        (os as unknown as { homedir: () => string }).homedir = () => homeGlobalDir;
        process.env.PI_CODING_AGENT_DIR = envGlobalDir;

        const projectRoot = path.join(tmpRoot, "project-g");
        fs.mkdirSync(path.join(projectRoot, ".pi"), { recursive: true });

        const result = loadProjectAgentConfig(projectRoot);
        expect(result).toEqual({ subagent: { strictLocalRuntime: true } });
    });
});
