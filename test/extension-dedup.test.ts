import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isShadowedProjectCopy } from "../.pi/extensions/lib/extension-helpers.ts";
import readBoundaryGuardExtension from "../.pi/extensions/read-boundary-guard.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

describe("dedup direction integration", () => {
    let prevAgentDirEnv: string | undefined;

    beforeEach(() => {
        prevAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
    });

    afterEach(() => {
        if (prevAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = prevAgentDirEnv;
    });

    it("a guard loaded from the global path registers and acts, even with a project twin", async () => {
        // Setting the agent dir to this repo's `.pi` makes the real, on-disk
        // `.pi/extensions/read-boundary-guard.ts` (imported below) resolve as a
        // global-path module: it sits directly under `<agentDir>/extensions`.
        process.env.PI_CODING_AGENT_DIR = path.join(process.cwd(), ".pi");

        const pi = createFakePi();
        readBoundaryGuardExtension(asExtensionAPI(pi));

        const handlers = pi.handlers.get("tool_call") ?? [];
        expect(handlers.length).toBeGreaterThan(0);

        const result = await handlers[0](
            { toolName: "read", input: { path: "/etc/hosts" } },
            { hasUI: false, cwd: process.cwd() },
        );
        expect(result?.block).toBe(true);
    });

    it("a project copy with a global twin registers no handler and no command", () => {
        const tempAgentDir = fs.mkdtempSync(
            path.join(os.tmpdir(), "pi-dedup-ac4-"),
        );
        fs.mkdirSync(path.join(tempAgentDir, "extensions"), { recursive: true });
        fs.writeFileSync(
            path.join(tempAgentDir, "extensions", "read-boundary-guard.ts"),
            "",
        );
        process.env.PI_CODING_AGENT_DIR = tempAgentDir;

        try {
            const pi = createFakePi();
            readBoundaryGuardExtension(asExtensionAPI(pi));

            expect(pi.handlers.size).toBe(0);
            expect(pi.commands.size).toBe(0);
        } finally {
            fs.rmSync(tempAgentDir, { recursive: true, force: true });
        }
    });
});

describe("isShadowedProjectCopy", () => {
    let base: string;
    let globalAgentDir: string;
    let projectDir: string;
    let prevAgentDirEnv: string | undefined;

    const projectExtUrl = (relative: string): string =>
        pathToFileURL(path.join(projectDir, ".pi", "extensions", relative)).href;

    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dedup-project-"));
        globalAgentDir = path.join(base, "agent");
        projectDir = path.join(base, "project");
        fs.mkdirSync(path.join(globalAgentDir, "extensions", "plan-mode"), {
            recursive: true,
        });
        fs.mkdirSync(path.join(projectDir, ".pi", "extensions", "plan-mode"), {
            recursive: true,
        });
        prevAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
        process.env.PI_CODING_AGENT_DIR = globalAgentDir;
    });

    afterEach(() => {
        if (prevAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = prevAgentDirEnv;
        fs.rmSync(base, { recursive: true, force: true });
    });

    it("returns true for a project copy with a global twin", () => {
        fs.writeFileSync(path.join(globalAgentDir, "extensions", "foo.ts"), "");
        fs.writeFileSync(path.join(projectDir, ".pi", "extensions", "foo.ts"), "");

        expect(isShadowedProjectCopy(projectExtUrl("foo.ts"))).toBe(true);
    });

    it("returns true for a nested project index.ts with a global twin", () => {
        fs.writeFileSync(
            path.join(globalAgentDir, "extensions", "plan-mode", "index.ts"),
            "",
        );
        fs.writeFileSync(
            path.join(projectDir, ".pi", "extensions", "plan-mode", "index.ts"),
            "",
        );

        expect(
            isShadowedProjectCopy(projectExtUrl(path.join("plan-mode", "index.ts"))),
        ).toBe(true);
    });

    it("returns false for a project copy without a global twin", () => {
        fs.writeFileSync(path.join(projectDir, ".pi", "extensions", "bar.ts"), "");

        expect(isShadowedProjectCopy(projectExtUrl("bar.ts"))).toBe(false);
    });

    it("returns false for a global-path module even when a project twin exists", () => {
        fs.writeFileSync(path.join(globalAgentDir, "extensions", "foo.ts"), "");
        fs.writeFileSync(path.join(projectDir, ".pi", "extensions", "foo.ts"), "");
        const globalUrl = pathToFileURL(
            path.join(globalAgentDir, "extensions", "foo.ts"),
        ).href;

        expect(isShadowedProjectCopy(globalUrl)).toBe(false);
    });

    it("returns false for a module outside any .pi/extensions/ directory", () => {
        const otherFile = path.join(projectDir, "src", "index.ts");
        fs.mkdirSync(path.dirname(otherFile), { recursive: true });
        fs.writeFileSync(otherFile, "");

        expect(isShadowedProjectCopy(pathToFileURL(otherFile).href)).toBe(false);
    });

    it("returns false for an unresolvable URL (fail-open)", () => {
        expect(isShadowedProjectCopy("not-a-url")).toBe(false);
    });

    it("stands down a project copy whose .pi/extensions/ sits outside process.cwd()", () => {
        // No process.cwd()/chdir involved anywhere in this test: the result must not
        // depend on it, since `isShadowedProjectCopy` takes no cwd input.
        fs.writeFileSync(path.join(globalAgentDir, "extensions", "foo.ts"), "");
        const otherDir = path.join(base, "other-project");
        fs.mkdirSync(path.join(otherDir, ".pi", "extensions"), { recursive: true });
        fs.writeFileSync(path.join(otherDir, ".pi", "extensions", "foo.ts"), "");
        const otherUrl = pathToFileURL(
            path.join(otherDir, ".pi", "extensions", "foo.ts"),
        ).href;

        expect(isShadowedProjectCopy(otherUrl)).toBe(true);
    });

    it("fails open when PI_CODING_AGENT_DIR is unset and no global twin can be found", () => {
        delete process.env.PI_CODING_AGENT_DIR;
        fs.writeFileSync(path.join(projectDir, ".pi", "extensions", "foo.ts"), "");

        expect(isShadowedProjectCopy(projectExtUrl("foo.ts"))).toBe(false);
    });
});

/**
 * When both copies register, pi renames duplicate commands `scope:1`/`scope:2` (so
 * `/scope` stops matching) and every guard approval dialog appears twice. A project
 * copy whose global twin exists must register nothing; the global copy always registers.
 */
describe("dual-load registration", () => {
    const extensionsSource = path.join(import.meta.dirname, "..", ".pi", "extensions");

    let base: string;
    let agentDir: string;
    let projectDir: string;
    let noTwinAgentDir: string;
    let prevAgentDirEnv: string | undefined;
    let prevCwd: string;

    const importExtension = async (absolutePath: string): Promise<{ default: (pi: unknown) => void }> =>
        import(pathToFileURL(absolutePath).href) as Promise<{ default: (pi: unknown) => void }>;

    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dedup-load-"));
        agentDir = path.join(base, "agent");
        projectDir = path.join(base, "project");
        noTwinAgentDir = path.join(base, "no-twin-agent");
        fs.cpSync(extensionsSource, path.join(agentDir, "extensions"), { recursive: true });
        fs.cpSync(extensionsSource, path.join(projectDir, ".pi", "extensions"), { recursive: true });
        fs.mkdirSync(path.join(noTwinAgentDir, "extensions"), { recursive: true });
        prevAgentDirEnv = process.env.PI_CODING_AGENT_DIR;
        prevCwd = process.cwd();
    });

    afterEach(() => {
        if (prevAgentDirEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
        else process.env.PI_CODING_AGENT_DIR = prevAgentDirEnv;
        process.chdir(prevCwd);
        fs.rmSync(base, { recursive: true, force: true });
    });

    it("a project copy with a global twin registers nothing", async () => {
        process.env.PI_CODING_AGENT_DIR = agentDir;
        process.chdir(projectDir);
        const mod = await importExtension(
            path.join(projectDir, ".pi", "extensions", "gates.ts"),
        );
        const pi = createFakePi();

        mod.default(pi);

        expect(pi.handlers.size).toBe(0);
        expect(pi.commands.size).toBe(0);
        expect(pi.entries).toHaveLength(0);
    });

    it("the global copy registers normally, even with a project twin present", async () => {
        process.env.PI_CODING_AGENT_DIR = agentDir;
        process.chdir(projectDir);
        const mod = await importExtension(path.join(agentDir, "extensions", "gates.ts"));
        const pi = createFakePi();

        mod.default(pi);

        expect(pi.handlers.size).toBeGreaterThan(0);
        expect(pi.commands.has("gates")).toBe(true);
    });

    it("a project copy without a global twin still registers (fail-open)", async () => {
        process.env.PI_CODING_AGENT_DIR = noTwinAgentDir;
        process.chdir(projectDir);
        const mod = await importExtension(
            path.join(projectDir, ".pi", "extensions", "gates.ts"),
        );
        const pi = createFakePi();

        mod.default(pi);

        expect(pi.handlers.size).toBeGreaterThan(0);
        expect(pi.commands.has("gates")).toBe(true);
    });
});
