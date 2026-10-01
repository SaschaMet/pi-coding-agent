import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import cmuxStatusExtension from "../.pi/extensions/cmux-status.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

const SURFACE_ID = "TEST-SURFACE-1";
const OK_EXEC = { stdout: "", stderr: "", code: 0, killed: false };

type Fake = ReturnType<typeof createFakePi>;

/** Register the extension on a fresh fake pi. */
function register(): Fake {
    const pi = createFakePi();
    cmuxStatusExtension(asExtensionAPI(pi));
    return pi;
}

async function fire(
    pi: Fake,
    event: "agent_start" | "agent_end" | "ui_prompt_start" | "ui_prompt_end",
    mode: string,
): Promise<void> {
    const handlers = pi.handlers.get(event) ?? [];
    expect(handlers.length).toBe(1);
    await handlers[0]({ type: event }, { mode, hasUI: false });
    // exec calls may be chained onto a serial queue; let it drain
    await new Promise((resolve) => setTimeout(resolve, 0));
}

const RUNNING_ARGS = [
    "set-status",
    `pi-${SURFACE_ID}`,
    "running",
    "--icon",
    "sparkle",
    "--color",
    "#ff9500",
];
const NEEDS_INPUT_ARGS = [
    "set-status",
    `pi-${SURFACE_ID}`,
    "needs input",
    "--icon",
    "bell.fill",
    "--color",
    "#ff3b30",
];
const OPTS = { timeout: 3000 };

describe("cmux-status extension", () => {
    afterEach(() => {
        delete process.env.CMUX_SURFACE_ID;
        vi.restoreAllMocks();
    });

    it("sets the per-pane running badge on agent_start in tui mode", async () => {
        process.env.CMUX_SURFACE_ID = SURFACE_ID;
        const pi = register();
        const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
        await fire(pi, "agent_start", "tui");
        expect(execSpy).toHaveBeenCalledTimes(1);
        expect(execSpy).toHaveBeenCalledWith(
            "cmux",
            [
                "set-status",
                `pi-${SURFACE_ID}`,
                "running",
                "--icon",
                "sparkle",
                "--color",
                "#ff9500",
            ],
            { timeout: 3000 },
        );
    });

    it("clears the per-pane badge on agent_end in tui mode", async () => {
        process.env.CMUX_SURFACE_ID = SURFACE_ID;
        const pi = register();
        const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
        await fire(pi, "agent_end", "tui");
        expect(execSpy).toHaveBeenCalledTimes(1);
        expect(execSpy).toHaveBeenCalledWith(
            "cmux",
            ["clear-status", `pi-${SURFACE_ID}`],
            { timeout: 3000 },
        );
    });

    it("falls back to the shared key when CMUX_SURFACE_ID is missing", async () => {
        delete process.env.CMUX_SURFACE_ID;
        const pi = register();
        const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
        await fire(pi, "agent_start", "tui");
        expect(execSpy).toHaveBeenCalledWith(
            "cmux",
            ["set-status", "pi", "running", "--icon", "sparkle", "--color", "#ff9500"],
            { timeout: 3000 },
        );
    });

    it("stays silent in print mode (subagent sessions)", async () => {
        process.env.CMUX_SURFACE_ID = SURFACE_ID;
        const pi = register();
        const execSpy = vi.spyOn(pi, "exec");
        await fire(pi, "agent_start", "print");
        await fire(pi, "agent_end", "print");
        expect(execSpy).not.toHaveBeenCalled();
    });

    it("survives a failing cmux exec without throwing", async () => {
        process.env.CMUX_SURFACE_ID = SURFACE_ID;
        const pi = register();
        vi.spyOn(pi, "exec").mockRejectedValue(new Error("no cmux socket"));
        await expect(fire(pi, "agent_start", "tui")).resolves.toBeUndefined();
        await expect(fire(pi, "agent_end", "tui")).resolves.toBeUndefined();
    });

    it("registers the handlers only once per pi instance", () => {
        const pi = register();
        cmuxStatusExtension(asExtensionAPI(pi));
        expect(pi.handlers.get("agent_start")?.length).toBe(1);
        expect(pi.handlers.get("agent_end")?.length).toBe(1);
    });

    describe("needs-input indicator", () => {
        it("runs set-status, trigger-flash, notify in order on ui_prompt_start", async () => {
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
            await fire(pi, "agent_start", "tui");
            execSpy.mockClear();
            await fire(pi, "ui_prompt_start", "tui");
            expect(execSpy).toHaveBeenCalledTimes(3);
            expect(execSpy).toHaveBeenNthCalledWith(1, "cmux", NEEDS_INPUT_ARGS, OPTS);
            expect(execSpy).toHaveBeenNthCalledWith(2, "cmux", ["trigger-flash"], OPTS);
            expect(execSpy).toHaveBeenNthCalledWith(
                3,
                "cmux",
                ["notify", "--title", "π", "--body", "Needs input"],
                OPTS,
            );
        });

        it("alerts on every prompt in one run", async () => {
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
            await fire(pi, "agent_start", "tui");
            await fire(pi, "ui_prompt_start", "tui");
            await fire(pi, "ui_prompt_end", "tui");
            await fire(pi, "ui_prompt_start", "tui");
            const cmds = execSpy.mock.calls.map((c) => (c[1] as string[])[0]);
            expect(cmds.filter((c) => c === "trigger-flash").length).toBe(2);
            expect(cmds.filter((c) => c === "notify").length).toBe(2);
        });

        it("ignores a late ui_prompt_start after agent_end", async () => {
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
            await fire(pi, "agent_start", "tui");
            await fire(pi, "agent_end", "tui");
            execSpy.mockClear();
            await fire(pi, "ui_prompt_start", "tui");
            expect(execSpy).not.toHaveBeenCalled();
        });

        it("keeps the running state on a repeated agent_start", async () => {
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
            await fire(pi, "agent_start", "tui");
            await fire(pi, "agent_start", "tui");
            execSpy.mockClear();
            await fire(pi, "ui_prompt_start", "tui");
            expect(execSpy).toHaveBeenCalledTimes(3);
        });

        it("skips flash and notify when CMUX_SURFACE_ID is unset", async () => {
            delete process.env.CMUX_SURFACE_ID;
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
            await fire(pi, "agent_start", "tui");
            execSpy.mockClear();
            await fire(pi, "ui_prompt_start", "tui");
            expect(execSpy).toHaveBeenCalledTimes(1);
            expect(execSpy).toHaveBeenCalledWith(
                "cmux",
                ["set-status", "pi", "needs input", "--icon", "bell.fill", "--color", "#ff3b30"],
                OPTS,
            );
        });

        it("survives a failing exec on the prompt events", async () => {
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
            await fire(pi, "agent_start", "tui");
            execSpy.mockClear();
            execSpy.mockRejectedValue(new Error("no cmux socket"));
            await expect(fire(pi, "ui_prompt_start", "tui")).resolves.toBeUndefined();
            await expect(fire(pi, "ui_prompt_end", "tui")).resolves.toBeUndefined();
            // behavior must exist, not just not throw
            expect(execSpy).toHaveBeenCalled();
        });

        it("runs execs serially: the second waits for the first", async () => {
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            const pi = register();
            let release: (v: typeof OK_EXEC) => void = () => {};
            const execSpy = vi
                .spyOn(pi, "exec")
                .mockImplementationOnce(
                    () => new Promise<typeof OK_EXEC>((resolve) => (release = resolve)),
                )
                .mockResolvedValue(OK_EXEC);
            await fire(pi, "agent_start", "tui");
            await fire(pi, "agent_end", "tui");
            expect(execSpy).toHaveBeenCalledTimes(1);
            release(OK_EXEC);
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(execSpy).toHaveBeenCalledTimes(2);
        });

        it("restores the running badge on ui_prompt_end", async () => {
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
            await fire(pi, "agent_start", "tui");
            await fire(pi, "ui_prompt_start", "tui");
            execSpy.mockClear();
            await fire(pi, "ui_prompt_end", "tui");
            expect(execSpy).toHaveBeenCalledTimes(1);
            expect(execSpy).toHaveBeenCalledWith("cmux", RUNNING_ARGS, OPTS);
        });

        it("does nothing for prompt events while the agent is idle", async () => {
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
            await fire(pi, "ui_prompt_start", "tui");
            await fire(pi, "ui_prompt_end", "tui");
            expect(execSpy).not.toHaveBeenCalled();
        });

        it("ends with clear-status when agent_end precedes ui_prompt_end", async () => {
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
            await fire(pi, "agent_start", "tui");
            await fire(pi, "ui_prompt_start", "tui");
            await fire(pi, "agent_end", "tui");
            await fire(pi, "ui_prompt_end", "tui");
            expect(execSpy).toHaveBeenLastCalledWith(
                "cmux",
                ["clear-status", `pi-${SURFACE_ID}`],
                OPTS,
            );
        });

        it("stays silent for prompt events in print mode", async () => {
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockResolvedValue(OK_EXEC);
            await fire(pi, "agent_start", "print");
            await fire(pi, "ui_prompt_start", "print");
            await fire(pi, "ui_prompt_end", "print");
            expect(execSpy).not.toHaveBeenCalled();
        });

        it("registers the prompt handlers only once per pi instance", () => {
            const pi = register();
            cmuxStatusExtension(asExtensionAPI(pi));
            expect(pi.handlers.get("ui_prompt_start")?.length).toBe(1);
            expect(pi.handlers.get("ui_prompt_end")?.length).toBe(1);
        });
    });

    describe("set_pane_title tool", () => {
        const WORKSPACE_ID = "TEST-WORKSPACE-1";
        const ENV_KEYS = ["CMUX_SURFACE_ID", "CMUX_SOCKET_PATH", "CMUX_WORKSPACE_ID"] as const;
        const saved: Record<string, string | undefined> = {};
        let tmpDir = "";

        const treeJson = (surfaceCounts: number[]): string =>
            JSON.stringify({
                windows: [
                    {
                        workspaces: [
                            { id: "OTHER", panes: [{ surface_count: 5 }] },
                            { id: WORKSPACE_ID, panes: surfaceCounts.map((n) => ({ surface_count: n })) },
                        ],
                    },
                ],
            });

        const setupEnv = (): void => {
            for (const k of ENV_KEYS) saved[k] = process.env[k];
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-title-"));
            const socket = path.join(tmpDir, "sock");
            fs.writeFileSync(socket, "");
            process.env.CMUX_SOCKET_PATH = socket;
            process.env.CMUX_SURFACE_ID = SURFACE_ID;
            process.env.CMUX_WORKSPACE_ID = WORKSPACE_ID;
        };

        afterEach(() => {
            for (const k of ENV_KEYS) {
                if (saved[k] === undefined) delete process.env[k];
                else process.env[k] = saved[k];
            }
            if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
            tmpDir = "";
        });

        /** Start a session and return the registered tool (or undefined). */
        const start = async (pi: Fake, mode = "tui") => {
            await pi.handlers.get("session_start")?.[0]({ type: "session_start" }, { mode, hasUI: false });
            return pi.tools.get("set_pane_title");
        };
        const call = async (tool: NonNullable<Awaited<ReturnType<typeof start>>>, title: string) => {
            const result = await tool.execute("id", { title }, undefined, undefined, { mode: "tui" });
            await new Promise((resolve) => setTimeout(resolve, 0));
            return result;
        };
        const mockExec = (pi: Fake, treeStdout: string) =>
            vi.spyOn(pi, "exec").mockImplementation(async (_cmd: any, args: any) => ({
                ...OK_EXEC,
                stdout: args[0] === "tree" ? treeStdout : "",
            }));

        it("registers no tool in print mode", async () => {
            setupEnv();
            const pi = register();
            expect(await start(pi, "print")).toBeUndefined();
        });

        it("registers no tool outside cmux", async () => {
            setupEnv();
            delete process.env.CMUX_SOCKET_PATH;
            const pi = register();
            expect(await start(pi)).toBeUndefined();
        });

        it("renames the tab via --title and the workspace when it is the only surface", async () => {
            setupEnv();
            const pi = register();
            const execSpy = mockExec(pi, treeJson([1]));
            const tool = await start(pi);
            await call(tool!, "fix sync push");
            expect(execSpy).toHaveBeenCalledWith(
                "cmux",
                ["rename-tab", "--surface", SURFACE_ID, "--title", "fix sync push"],
                OPTS,
            );
            expect(execSpy).toHaveBeenCalledWith(
                "cmux",
                ["workspace", "rename", WORKSPACE_ID, "--title", "fix sync push"],
                OPTS,
            );
        });

        it("skips the workspace rename when other surfaces share the workspace", async () => {
            setupEnv();
            const pi = register();
            const execSpy = mockExec(pi, treeJson([1, 1]));
            await call((await start(pi))!, "title");
            expect(execSpy.mock.calls.some(([, a]) => (a as string[])[0] === "workspace")).toBe(false);
            expect(execSpy.mock.calls.some(([, a]) => (a as string[])[0] === "rename-tab")).toBe(true);
        });

        it("skips the workspace rename without a workspace id or when the tree call fails", async () => {
            setupEnv();
            delete process.env.CMUX_WORKSPACE_ID;
            let pi = register();
            let execSpy = mockExec(pi, treeJson([1]));
            await call((await start(pi))!, "title");
            expect(execSpy.mock.calls.some(([, a]) => (a as string[])[0] === "workspace")).toBe(false);

            process.env.CMUX_WORKSPACE_ID = WORKSPACE_ID;
            pi = register();
            execSpy = mockExec(pi, "not json");
            await call((await start(pi))!, "title");
            expect(execSpy.mock.calls.some(([, a]) => (a as string[])[0] === "workspace")).toBe(false);
        });

        it("sanitizes the title", async () => {
            setupEnv();
            const pi = register();
            const execSpy = mockExec(pi, treeJson([2]));
            const tool = (await start(pi))!;
            const tabTitle = (): string => {
                const args = execSpy.mock.calls.map(([, a]) => a as string[]).filter((a) => a[0] === "rename-tab").pop()!;
                return args[args.length - 1];
            };
            await call(tool, "--surface surface:3 x");
            expect(tabTitle()).toBe("surface surface:3 x");
            await call(tool, "a\u202Eb\u0007c\n  d");
            expect(tabTitle()).toBe("ab c d");
            await call(tool, "😀".repeat(60));
            expect(Array.from(tabTitle())).toHaveLength(40);
        });

        it("throws on an empty title and makes no call", async () => {
            setupEnv();
            const pi = register();
            const execSpy = mockExec(pi, treeJson([1]));
            const tool = (await start(pi))!;
            await expect(call(tool, " \u202E-- ")).rejects.toThrow();
            expect(execSpy).not.toHaveBeenCalled();
        });
    });
});
