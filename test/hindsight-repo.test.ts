import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHindsightRepo } from "../.pi/extensions/hindsight-repo.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

type Recorder = { loads: unknown[]; calls: string[] };
const RECORDER = "__hindsightRepoFakeRuntime";

// A stand-in for the official runtime: same shape (sync default export taking the API), records what ran.
const FAKE_RUNTIME = `
export default function (pi) {
    const rec = globalThis.${RECORDER};
    rec.loads.push(pi);
    pi.on("session_start", () => { rec.calls.push("session_start"); });
    pi.on("before_agent_start", () => {
        rec.calls.push("before_agent_start");
        return { message: { customType: "hindsight", content: "memory", display: false } };
    });
    pi.on("agent_end", () => { rec.calls.push("agent_end"); });
    pi.registerTool({
        name: "hindsight_recall",
        label: "Recall",
        description: "recall",
        parameters: {},
        execute: async () => {
            rec.calls.push("tool");
            return { content: [{ type: "text", text: "recalled" }], details: null };
        },
    });
}
`;

const ENV_KEYS = ["HINDSIGHT_OPT_IN_ONLY", "HINDSIGHT_OPT_IN_PATHS", "HINDSIGHT_BANK_ID", "HINDSIGHT_API_URL", "HINDSIGHT_SERVER_MODE"];

const hindsightEnv = () => Object.keys(process.env).filter((key) => key.startsWith("HINDSIGHT_"));
const expectedBank = (mainRoot: string) =>
    `coding-agent::${basename(mainRoot)}-${createHash("sha256").update(mainRoot).digest("hex").slice(0, 8)}`;

const interactive = { mode: "tui", hasUI: true, isProjectTrusted: () => true };
const blockedSessions = [
    ["print mode", { mode: "print", hasUI: false, isProjectTrusted: () => true }],
    ["tui without a UI", { mode: "tui", hasUI: false, isProjectTrusted: () => true }],
    ["untrusted project", { mode: "tui", hasUI: true, isProjectTrusted: () => false }],
] as const;

describe("hindsight repo wrapper", () => {
    let scratch: string;
    let savedEnv: Record<string, string | undefined>;
    let recorder: Recorder;

    beforeEach(() => {
        // realpath: macOS temp dirs sit behind a /var -> /private/var symlink, and the bank hash is path-exact.
        scratch = realpathSync(mkdtempSync(join(tmpdir(), "hindsight-repo-")));
        savedEnv = Object.fromEntries(hindsightEnv().map((key) => [key, process.env[key]]));
        for (const key of hindsightEnv()) delete process.env[key];
        recorder = { loads: [], calls: [] };
        (globalThis as Record<string, unknown>)[RECORDER] = recorder;
    });

    afterEach(() => {
        for (const key of hindsightEnv()) delete process.env[key];
        for (const [key, value] of Object.entries(savedEnv)) if (value !== undefined) process.env[key] = value;
        delete (globalThis as Record<string, unknown>)[RECORDER];
        rmSync(scratch, { recursive: true, force: true });
    });

    // Each test gets its own runtime file: the module cache would otherwise return the first import.
    function runtimeFile(): string {
        const file = join(scratch, "runtime", "pi.mjs");
        mkdirSync(join(scratch, "runtime"), { recursive: true });
        writeFileSync(file, FAKE_RUNTIME);
        return file;
    }

    function repo(name: string, settings?: string): string {
        const root = join(scratch, name);
        mkdirSync(join(root, ".git"), { recursive: true });
        if (settings !== undefined) writeFileSync(join(root, "piSettings.json"), settings);
        return root;
    }

    // A linked worktree: its `.git` is a file pointing into the main checkout's `.git/worktrees/<name>`.
    function worktree(mainRoot: string, name: string, settings?: string): string {
        const root = join(scratch, name);
        mkdirSync(join(mainRoot, ".git", "worktrees", name), { recursive: true });
        mkdirSync(root, { recursive: true });
        writeFileSync(join(root, ".git"), `gitdir: ${join(mainRoot, ".git", "worktrees", name)}\n`);
        if (settings !== undefined) writeFileSync(join(root, "piSettings.json"), settings);
        return root;
    }

    async function load(cwd: string, runtimePath = runtimeFile()) {
        const pi = createFakePi();
        await createHindsightRepo(runtimePath, () => cwd)(asExtensionAPI(pi));
        return pi;
    }

    const ON = '{ "useMemory": true }';

    it("loads the runtime and sets the opt-in path to the git root when useMemory is true", async () => {
        const root = repo("proj", ON);
        const pi = await load(root);

        expect(recorder.loads).toHaveLength(1);
        expect(recorder.loads[0]).not.toBe(pi);
        // The wrapped API still carries every other method of the real one.
        expect((recorder.loads[0] as Record<string, unknown>).sendMessage).toBe(pi.sendMessage);
        expect(process.env.HINDSIGHT_OPT_IN_ONLY).toBe("true");
        expect(process.env.HINDSIGHT_OPT_IN_PATHS).toBe(root);
        expect(pi.tools.has("hindsight_recall")).toBe(true);
    });

    it("finds piSettings.json at the git root when the session starts in a subdirectory", async () => {
        const root = repo("proj", ON);
        const sub = join(root, "src", "deep");
        mkdirSync(sub, { recursive: true });
        await load(sub);

        expect(recorder.loads).toHaveLength(1);
        expect(process.env.HINDSIGHT_OPT_IN_PATHS).toBe(root);
    });

    it("loads nothing and sets no variable when the file is missing", async () => {
        await load(repo("proj"));

        expect(recorder.loads).toHaveLength(0);
        expect(hindsightEnv()).toEqual([]);
    });

    it.each([
        ["false", '{ "useMemory": false }'],
        ["a string", '{ "useMemory": "true" }'],
        ["absent", "{}"],
        ["a bare boolean", "true"],
    ])("loads nothing when useMemory is %s", async (_label, settings) => {
        await load(repo("proj", settings));

        expect(recorder.loads).toHaveLength(0);
        expect(hindsightEnv()).toEqual([]);
    });

    it("loads nothing when the file is not valid JSON", async () => {
        await load(repo("proj", "{ useMemory: true"));

        expect(recorder.loads).toHaveLength(0);
        expect(hindsightEnv()).toEqual([]);
    });

    it("loads nothing outside a git repository", async () => {
        const dir = join(scratch, "plain");
        mkdirSync(dir);
        writeFileSync(join(dir, "piSettings.json"), ON);
        await load(dir);

        expect(recorder.loads).toHaveLength(0);
        expect(hindsightEnv()).toEqual([]);
    });

    it("does not throw when the runtime file is missing", async () => {
        const root = repo("proj", ON);
        const pi = await load(root, join(scratch, "absent", "pi.js"));

        expect(recorder.loads).toHaveLength(0);
        expect(pi.tools.size).toBe(0);
    });

    it("sets HINDSIGHT_BANK_ID from the main checkout path, the same for a linked worktree", async () => {
        const main = repo("proj", ON);
        await load(main);
        const mainBank = process.env.HINDSIGHT_BANK_ID;
        expect(mainBank).toBe(expectedBank(main));

        for (const key of hindsightEnv()) delete process.env[key];
        const wt = worktree(main, "proj-feature", ON);
        await load(wt);

        expect(process.env.HINDSIGHT_BANK_ID).toBe(mainBank);
        expect(process.env.HINDSIGHT_OPT_IN_PATHS).toBe(wt);
    });

    it("gives two repos with the same folder name different banks", async () => {
        mkdirSync(join(scratch, "client-a"));
        mkdirSync(join(scratch, "client-b"));
        await load(repo(join("client-a", "api"), ON));
        const first = process.env.HINDSIGHT_BANK_ID;
        for (const key of hindsightEnv()) delete process.env[key];
        await load(repo(join("client-b", "api"), ON));

        expect(first).toMatch(/^coding-agent::api-[0-9a-f]{8}$/);
        expect(process.env.HINDSIGHT_BANK_ID).toMatch(/^coding-agent::api-[0-9a-f]{8}$/);
        expect(process.env.HINDSIGHT_BANK_ID).not.toBe(first);
    });

    it("reads piSettings.json in a linked worktree's own top folder", async () => {
        const main = repo("proj", ON);
        const offWorktree = worktree(main, "proj-off");
        await load(offWorktree);
        expect(recorder.loads).toHaveLength(0);
        expect(hindsightEnv()).toEqual([]);

        const plainMain = repo("other");
        await load(worktree(plainMain, "other-on", ON));
        expect(recorder.loads).toHaveLength(1);
    });

    it.each(blockedSessions)("skips memory injection and write-back in a non-interactive or untrusted session: %s", async (_label, ctx) => {
        const pi = await load(repo("proj", ON));
        const before = pi.handlers.get("before_agent_start") ?? [];
        const end = pi.handlers.get("agent_end") ?? [];
        expect(before).toHaveLength(1);
        expect(end).toHaveLength(1);

        expect(await before[0]({ type: "before_agent_start", prompt: "hi" }, ctx)).toBeUndefined();
        await end[0]({ type: "agent_end", messages: [] }, ctx);
        // Events outside injection and write-back pass through unchanged.
        await pi.handlers.get("session_start")?.[0]({ type: "session_start" }, ctx);

        expect(recorder.calls).toEqual(["session_start"]);
    });

    it("runs memory injection and write-back in an interactive trusted session", async () => {
        const pi = await load(repo("proj", ON));
        const result = await pi.handlers.get("before_agent_start")?.[0]({ type: "before_agent_start", prompt: "hi" }, interactive);
        await pi.handlers.get("agent_end")?.[0]({ type: "agent_end", messages: [] }, interactive);

        expect(result?.message?.content).toBe("memory");
        expect(recorder.calls).toEqual(["before_agent_start", "agent_end"]);
    });

    it.each(blockedSessions)("returns a not-available text from a runtime tool in a non-interactive or untrusted session: %s", async (_label, ctx) => {
        const pi = await load(repo("proj", ON));
        const result = await pi.tools.get("hindsight_recall")?.execute("id", {}, undefined, undefined, ctx);

        expect(recorder.calls).toEqual([]);
        expect(result.content[0].text).toMatch(/not available/i);
    });

    it("runs a runtime tool in an interactive trusted session", async () => {
        const pi = await load(repo("proj", ON));
        const result = await pi.tools.get("hindsight_recall")?.execute("id", {}, undefined, undefined, interactive);

        expect(result.content[0].text).toBe("recalled");
        expect(recorder.calls).toEqual(["tool"]);
    });

    it("sets the API URL and server mode only when they are unset", async () => {
        await load(repo("proj", ON));
        expect(process.env.HINDSIGHT_API_URL).toBe("http://127.0.0.1:8888");
        expect(process.env.HINDSIGHT_SERVER_MODE).toBe("self-hosted");

        process.env.HINDSIGHT_API_URL = "http://127.0.0.1:7777";
        process.env.HINDSIGHT_SERVER_MODE = "custom";
        await load(repo("proj2", ON));
        expect(process.env.HINDSIGHT_API_URL).toBe("http://127.0.0.1:7777");
        expect(process.env.HINDSIGHT_SERVER_MODE).toBe("custom");
    });

    it("loads nothing when piSettings.json is a symlink, not a regular file, or larger than 4 KB", async () => {
        const target = join(scratch, "elsewhere.json");
        writeFileSync(target, ON);
        const linked = repo("linked");
        symlinkSync(target, join(linked, "piSettings.json"));
        await load(linked);

        const dir = repo("dir");
        mkdirSync(join(dir, "piSettings.json"));
        await load(dir);

        const big = repo("big", JSON.stringify({ useMemory: true, pad: "x".repeat(4096) }));
        await load(big);

        expect(recorder.loads).toHaveLength(0);
        expect(hindsightEnv()).toEqual([]);
    });

    it("loads nothing when the git root contains a comma", async () => {
        await load(repo("a,b", ON));

        expect(recorder.loads).toHaveLength(0);
        expect(hindsightEnv()).toEqual([]);
    });

    it("keeps every HINDSIGHT_ variable it sets within the known set", async () => {
        await load(repo("proj", ON));

        expect(hindsightEnv().sort()).toEqual([...ENV_KEYS].sort());
    });
});
