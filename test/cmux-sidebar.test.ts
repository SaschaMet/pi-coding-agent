import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cmuxStatusExtension from "../.pi/extensions/cmux-status.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

const SURFACE_ID = "TEST-SURFACE-1";
const WORKSPACE_ID = "TEST-WORKSPACE-1";
const STATE_KEY = `pi-${SURFACE_ID}`;
const OK_EXEC = { stdout: "", stderr: "", code: 0, killed: false };
const OPTS = { timeout: 3000 };
const ENV_KEYS = ["CMUX_SURFACE_ID", "CMUX_SOCKET_PATH", "CMUX_WORKSPACE_ID"] as const;

const WORKING_ARGS = ["set-status", STATE_KEY, "working", "--icon", "sparkle", "--color", "#ff9500"];
const NEEDS_INPUT_ARGS = ["set-status", STATE_KEY, "needs input", "--icon", "bell.fill", "--color", "#ff3b30"];
const IDLE_ARGS = ["set-status", STATE_KEY, "idle", "--icon", "moon.zzz", "--color", "#8e8e93"];
const TREE_ARGS = ["tree", "--workspace", WORKSPACE_ID, "--json"];
const tabsArgs = (text: string): string[] => [
    "set-status",
    "pi-tabs",
    text,
    "--icon",
    "rectangle.stack",
    "--workspace",
    WORKSPACE_ID,
];

type Fake = ReturnType<typeof createFakePi>;
type EventName =
    | "session_start"
    | "agent_start"
    | "ui_prompt_start"
    | "ui_prompt_end"
    | "agent_end"
    | "session_shutdown";
const ALL_EVENTS: EventName[] = [
    "session_start",
    "agent_start",
    "ui_prompt_start",
    "ui_prompt_end",
    "agent_end",
    "session_shutdown",
];

const saved: Record<string, string | undefined> = {};
let tmpDir = "";

/** Live cmux terminal: surface and workspace ids plus an existing socket file. */
function enterCmux(): void {
    const socket = path.join(tmpDir, "sock");
    fs.writeFileSync(socket, "");
    process.env.CMUX_SOCKET_PATH = socket;
    process.env.CMUX_SURFACE_ID = SURFACE_ID;
    process.env.CMUX_WORKSPACE_ID = WORKSPACE_ID;
}

function register(): Fake {
    const pi = createFakePi();
    cmuxStatusExtension(asExtensionAPI(pi));
    return pi;
}

// Mocked execs resolve in microtasks; a few macrotask turns drain the serial queue.
const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function handlerFor(pi: Fake, event: EventName): (event: unknown, ctx: unknown) => unknown {
    const handlers = pi.handlers.get(event) ?? [];
    expect(handlers.length).toBe(1);
    return handlers[0];
}

async function fire(pi: Fake, event: EventName, mode = "tui"): Promise<void> {
    await handlerFor(pi, event)({ type: event }, { mode, hasUI: false });
    await flush();
}

/** `windows[].workspaces[].panes[].surfaces[].title`, plus a foreign workspace that must be ignored. */
const treeJson = (panes: Array<Array<string | undefined>>): string =>
    JSON.stringify({
        windows: [
            {
                workspaces: [
                    { id: "OTHER", panes: [{ surfaces: [{ title: "foreign" }] }] },
                    {
                        id: WORKSPACE_ID,
                        panes: panes.map((titles) => ({
                            surface_count: titles.length,
                            surfaces: titles.map((title) => (title === undefined ? {} : { title })),
                        })),
                    },
                ],
            },
        ],
    });

/** exec mock that answers `cmux tree` with the current value of `tree()`. */
const mockExec = (pi: Fake, tree: () => string) =>
    vi.spyOn(pi, "exec").mockImplementation(async (_cmd: any, args: any) => ({
        ...OK_EXEC,
        stdout: args[0] === "tree" ? tree() : "",
    }));

const argsOf = (spy: { mock: { calls: unknown[][] } }): string[][] =>
    spy.mock.calls.map((call) => call[1] as string[]);
const tabCalls = (spy: { mock: { calls: unknown[][] } }): string[][] =>
    argsOf(spy).filter((a) => a[0] === "set-status" && a[1] === "pi-tabs");
const stateCalls = (spy: { mock: { calls: unknown[][] } }): string[][] =>
    argsOf(spy).filter((a) => a[1] === STATE_KEY);

describe("cmux sidebar pills", () => {
    beforeEach(() => {
        for (const k of ENV_KEYS) saved[k] = process.env[k];
        for (const k of ENV_KEYS) delete process.env[k];
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-sidebar-"));
    });

    afterEach(async () => {
        await flush();
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    describe("state pill", () => {
        it("AC1: session_start sets the idle state", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => "");
            await fire(pi, "session_start");
            expect(execSpy).toHaveBeenCalledWith("cmux", IDLE_ARGS, OPTS);
            expect(stateCalls(execSpy)).toEqual([IDLE_ARGS]);
        });

        it("AC1: agent_start sets the working state", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => "");
            await fire(pi, "agent_start");
            expect(stateCalls(execSpy)).toEqual([WORKING_ARGS]);
        });

        it("AC1: ui_prompt_start while running sets needs input, then flashes, then notifies", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => "");
            await fire(pi, "agent_start");
            execSpy.mockClear();
            await fire(pi, "ui_prompt_start");
            expect(argsOf(execSpy)).toEqual([
                NEEDS_INPUT_ARGS,
                ["trigger-flash"],
                ["notify", "--title", "π", "--body", "Needs input"],
            ]);
        });

        it("AC1: ui_prompt_end while running restores the working state", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => "");
            await fire(pi, "agent_start");
            await fire(pi, "ui_prompt_start");
            execSpy.mockClear();
            await fire(pi, "ui_prompt_end");
            expect(argsOf(execSpy)).toEqual([WORKING_ARGS]);
        });

        it("AC1: agent_end sets idle via set-status and never clears the pill", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => "");
            await fire(pi, "agent_start");
            execSpy.mockClear();
            await fire(pi, "agent_end");
            expect(stateCalls(execSpy)).toEqual([IDLE_ARGS]);
            expect(argsOf(execSpy).some((a) => a[0] === "clear-status")).toBe(false);
        });

        it("AC1: walks idle → working → needs input → working → idle over one run", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => "");
            for (const event of ["session_start", "agent_start", "ui_prompt_start", "ui_prompt_end", "agent_end"] as const) {
                await fire(pi, event);
            }
            expect(stateCalls(execSpy).map((a) => a[2])).toEqual(["idle", "working", "needs input", "working", "idle"]);
        });
    });

    describe("shutdown", () => {
        it("AC2: session_shutdown clears the state pill and the tab pill", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => "");
            await fire(pi, "session_shutdown");
            expect(execSpy).toHaveBeenCalledWith("cmux", ["clear-status", STATE_KEY], OPTS);
            expect(execSpy).toHaveBeenCalledWith(
                "cmux",
                ["clear-status", "pi-tabs", "--workspace", WORKSPACE_ID],
                OPTS,
            );
        });

        it("AC2: the session_shutdown promise resolves only after both clear-status calls ran", async () => {
            enterCmux();
            const pi = register();
            const releases: Array<() => void> = [];
            const execSpy = vi.spyOn(pi, "exec").mockImplementation(
                () =>
                    new Promise((resolve) => {
                        releases.push(() => resolve(OK_EXEC));
                    }),
            );
            let settled = false;
            const done = Promise.resolve(handlerFor(pi, "session_shutdown")({ type: "session_shutdown" }, { mode: "tui", hasUI: false })).then(() => {
                settled = true;
            });
            try {
                await flush();
                expect(execSpy).toHaveBeenCalledTimes(1);
                expect(settled).toBe(false);
                releases[0]();
                await flush();
                expect(execSpy).toHaveBeenCalledTimes(2);
                expect(settled).toBe(false);
                releases[1]();
                await done;
                expect(settled).toBe(true);
                expect(argsOf(execSpy)).toEqual([
                    ["clear-status", STATE_KEY],
                    ["clear-status", "pi-tabs", "--workspace", WORKSPACE_ID],
                ]);
            } finally {
                // never leave the shared serial queue blocked for later tests
                for (const release of releases) release();
                execSpy.mockResolvedValue(OK_EXEC);
                await flush();
                for (const release of releases) release();
            }
        });
    });

    describe("tab-names pill", () => {
        it("AC3: session_start reads the workspace tree and sends the tab names", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => treeJson([["a", "b"], ["c"]]));
            await fire(pi, "session_start");
            expect(execSpy).toHaveBeenCalledWith("cmux", TREE_ARGS, OPTS);
            expect(tabCalls(execSpy)).toEqual([tabsArgs("a · b · c")]);
        });

        it("AC3: agent_end refreshes the tab names", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => treeJson([["a", "b"], ["c"]]));
            await fire(pi, "agent_start");
            await fire(pi, "agent_end");
            expect(execSpy).toHaveBeenCalledWith("cmux", TREE_ARGS, OPTS);
            expect(tabCalls(execSpy)).toEqual([tabsArgs("a · b · c")]);
        });

        it("AC3: session_start and set_pane_title send the tab pill only when its text changes", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => treeJson([["a", "b"], ["c"]]));
            await fire(pi, "session_start");
            await pi.tools.get("set_pane_title")!.execute("id", { title: "a" }, undefined, undefined, { mode: "tui" });
            await flush();
            expect(tabCalls(execSpy)).toEqual([tabsArgs("a · b · c")]);
        });

        it("AC3: agent_end re-sends an unchanged tab pill, restoring it after another session in the workspace cleared it", async () => {
            enterCmux();
            const pi = register();
            let tree = treeJson([["a", "b"], ["c"]]);
            const execSpy = mockExec(pi, () => tree);
            await fire(pi, "session_start");
            await fire(pi, "agent_start");
            await fire(pi, "agent_end");
            expect(tabCalls(execSpy)).toEqual([tabsArgs("a · b · c"), tabsArgs("a · b · c")]);

            tree = treeJson([["a", "renamed"], ["c"]]);
            await fire(pi, "agent_start");
            await fire(pi, "agent_end");
            expect(tabCalls(execSpy).at(-1)).toEqual(tabsArgs("a · renamed · c"));
        });

        it("AC3: set_pane_title refreshes the tab names after rename-tab", async () => {
            enterCmux();
            const pi = register();
            let tree = treeJson([["old"], ["c"]]);
            const execSpy = mockExec(pi, () => tree);
            await fire(pi, "session_start");
            const tool = pi.tools.get("set_pane_title");
            expect(tool).toBeDefined();
            tree = treeJson([["new title"], ["c"]]);
            execSpy.mockClear();
            await tool!.execute("id", { title: "new title" }, undefined, undefined, { mode: "tui" });
            await flush();
            const calls = argsOf(execSpy);
            const renameAt = calls.findIndex((a) => a[0] === "rename-tab");
            const lastTreeAt = calls.map((a) => a[0]).lastIndexOf("tree");
            const tabsAt = calls.findIndex((a) => a[0] === "set-status" && a[1] === "pi-tabs");
            expect(renameAt).toBeGreaterThanOrEqual(0);
            expect(lastTreeAt).toBeGreaterThan(renameAt);
            expect(tabsAt).toBeGreaterThan(lastTreeAt);
            expect(calls[tabsAt]).toEqual(tabsArgs("new title · c"));
        });

        it("AC3: skips empty titles, sanitizes control chars, and cuts names to 40 chars", async () => {
            enterCmux();
            const pi = register();
            const long = "z".repeat(60);
            const execSpy = mockExec(pi, () => treeJson([["a\u0007b", "", "   "], [undefined, "x\u202Ey", long]]));
            await fire(pi, "session_start");
            expect(tabCalls(execSpy)).toEqual([tabsArgs(`a b · xy · ${"z".repeat(40)}`)]);
        });

        it("AC3: a failing or unparsable tree call sends no tab pill", async () => {
            enterCmux();
            let pi = register();
            let execSpy = vi.spyOn(pi, "exec").mockImplementation(async (_cmd: any, args: any) => {
                if (args[0] === "tree") throw new Error("tree failed");
                return OK_EXEC;
            });
            await fire(pi, "session_start");
            expect(argsOf(execSpy).some((a) => a[0] === "tree")).toBe(true);
            expect(tabCalls(execSpy)).toEqual([]);

            pi = register();
            execSpy = mockExec(pi, () => "not json");
            await fire(pi, "session_start");
            expect(argsOf(execSpy).some((a) => a[0] === "tree")).toBe(true);
            expect(tabCalls(execSpy)).toEqual([]);
        });
    });

    describe("cmux gate", () => {
        const fireAll = async (pi: Fake, mode = "tui"): Promise<void> => {
            for (const event of ALL_EVENTS) await fire(pi, event, mode);
        };

        it("AC4: no CMUX_SOCKET_PATH → zero exec calls for every event", async () => {
            enterCmux();
            delete process.env.CMUX_SOCKET_PATH;
            const pi = register();
            const execSpy = mockExec(pi, () => treeJson([["a"]]));
            await fireAll(pi);
            expect(execSpy).not.toHaveBeenCalled();
        });

        it("AC4: socket file missing → zero exec calls for every event", async () => {
            enterCmux();
            process.env.CMUX_SOCKET_PATH = path.join(tmpDir, "missing-sock");
            const pi = register();
            const execSpy = mockExec(pi, () => treeJson([["a"]]));
            await fireAll(pi);
            expect(execSpy).not.toHaveBeenCalled();
        });

        it("AC4: print mode → zero exec calls for every event", async () => {
            enterCmux();
            const pi = register();
            const execSpy = mockExec(pi, () => treeJson([["a"]]));
            await fireAll(pi, "print");
            expect(execSpy).not.toHaveBeenCalled();
        });

        it("AC4: a rejecting exec never makes a handler throw", async () => {
            enterCmux();
            const pi = register();
            const execSpy = vi.spyOn(pi, "exec").mockRejectedValue(new Error("no cmux socket"));
            for (const event of ALL_EVENTS) {
                await expect(fire(pi, event)).resolves.toBeUndefined();
            }
            expect(execSpy).toHaveBeenCalled();
            expect(argsOf(execSpy).some((a) => a[0] === "clear-status")).toBe(true);
        });
    });

    describe("sidebar config doc", () => {
        it("AC5: the reference doc's json block hides the message, keeps the branch, shortens the path", () => {
            const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "reference", "cmux-sidebar.md"), "utf8");
            const match = doc.match(/```json\s*\n([\s\S]*?)```/);
            expect(match).not.toBeNull();
            const config = JSON.parse(match![1]) as { sidebar?: Record<string, unknown> };
            expect(config.sidebar?.showNotificationMessage).toBe(false);
            expect(config.sidebar?.showBranchDirectory).toBe(true);
            expect(config.sidebar?.pathLastSegmentOnly).toBe(true);
            expect(doc).toContain("showAgentActivity");
        });
    });
});
