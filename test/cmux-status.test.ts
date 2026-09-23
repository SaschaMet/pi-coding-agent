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
    event: "agent_start" | "agent_end",
    mode: string,
): Promise<void> {
    const handlers = pi.handlers.get(event) ?? [];
    expect(handlers.length).toBe(1);
    await handlers[0]({ type: event }, { mode, hasUI: false });
}

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
});
