import { describe, expect, it, vi } from "vitest";
import toolGuards from "../.pi/extensions/tool-guards.ts";
import { asExtensionAPI, createFakePi } from "./helpers/fake-pi.ts";

function setup() {
    const pi = createFakePi();
    toolGuards(asExtensionAPI(pi));
    const ctx = { cwd: process.cwd(), hasUI: false, abort: vi.fn() };

    async function fire(event: string, payload: unknown) {
        for (const handler of pi.handlers.get(event) ?? []) {
            const result = await handler(payload, ctx);
            if (result) return result;
        }
        return undefined;
    }

    /** Runs one call: the tool_call verdict, then (if it ran) its tool_result. */
    async function run(toolName: string, input: Record<string, unknown>, resultText: string, isError = false) {
        const verdict = await fire("tool_call", { toolCallId: "c", toolName, input });
        if (verdict?.block) return verdict;
        await fire("tool_result", { toolCallId: "c", toolName, input, content: [{ type: "text", text: resultText }], isError });
        return undefined;
    }

    return { ctx, fire, run };
}

// Real dispatch from a saved session: a heredoc script next to cmux send-key with plain variables.
const HEREDOC_DISPATCH = `WS=workspace:1000000003; W1=surface:1000000022
cmux send-key --workspace $WS --surface $W1 ctrl+c; sleep 1; cmux send-key --workspace $WS --surface $W1 ctrl+c; sleep 2
python3 - <<'E'
import os,re
s=open(os.environ['TMPDIR']+'/pi-raw-grunt.txt','rb').read().decode('utf8','replace')
i=s.find('The user is asking')
print(repr(s[i-200:i+120]))
E`;

// Real loop from a saved session: one grep script, re-run 34 times with the same output.
const GREP_LOOP_COMMAND =
    "cd /Users/saschametzger/Projects/UQ/EON/zam/application\necho \"=== AC3: Documented filter params vs backoffice-sent (research \u00a75) ===\"\necho \"\"\necho \"--- /internal/contracts (backoffice sends 17 keys) ---\"\ngrep -o \"filters\\[[a-zA-Z]*\\]\" src/Infrastructure/Controller/Internal/GetAllContractsController.php | sort -u\necho \"\"\necho \"--- /internal/xml-files (backoffice sends 8 keys) ---\"\ngrep -o \"filters\\[[a-zA-Z]*\\]\" src/Infrastructure/Controller/Internal/GetXmlExportedFilesController.php | sort -u";
const GREP_LOOP_RESULT =
    "=== AC3: Documented filter params vs backoffice-sent (research \u00a75) ===\n\n--- /internal/contracts (backoffice sends 17 keys) ---\nfilters[buyer]\nfilters[end]\n\n--- /internal/xml-files (backoffice sends 8 keys) ---\nfilters[from]\nfilters[partnerSlug]\nfilters[to]\n";

// Real loop from the same session: a wrong flag, re-run 22 times with the same error.
const SPLIT_LOOP_COMMAND = "cmux new-split --direction right --workspace workspace:1000110016 --label verify-internal-openapi-r2 2>&1";
const SPLIT_LOOP_RESULT = "Error: new-split requires a direction\n\n\nCommand exited with code 1";

describe("tool-guards: repeat guard", () => {
    it("blocks the third identical call after two identical results, without aborting", async () => {
        const { ctx, run } = setup();
        expect(await run("bash", { command: "ls" }, "a")).toBeUndefined();
        expect(await run("bash", { command: "ls" }, "a")).toBeUndefined();

        const third = await run("bash", { command: "ls" }, "a");

        expect(third?.block).toBe(true);
        expect(third?.reason).toMatch(/^\[LOOP\]/);
        expect(third?.terminate).toBe(false);
        expect(ctx.abort).not.toHaveBeenCalled();
    });

    it("tells the user why the run was aborted", async () => {
        const { ctx, run } = setup();
        const notify = vi.fn();
        Object.assign(ctx, { hasUI: true, ui: { notify } });
        for (let i = 0; i < 4; i++) await run("bash", { command: "ls" }, "a");

        expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^\[LOOP\]/), "error");
    });

    it("aborts the run when the blocked call is issued again", async () => {
        const { ctx, run } = setup();
        await run("bash", { command: "ls" }, "a");
        await run("bash", { command: "ls" }, "a");
        await run("bash", { command: "ls" }, "a");

        const fourth = await run("bash", { command: "ls" }, "a");

        expect(fourth?.block).toBe(true);
        expect(fourth?.terminate).toBe(true);
        expect(ctx.abort).toHaveBeenCalledTimes(1);
    });

    it("never blocks a poll whose result changes", async () => {
        const { run } = setup();
        for (let i = 0; i < 6; i++) {
            expect(await run("bash", { command: "sleep 60; cmux read-screen --surface surface:1" }, `screen ${i}`)).toBeUndefined();
        }
    });

    it("treats a different error flag as a different result", async () => {
        const { run } = setup();
        await run("bash", { command: "make" }, "out", false);
        await run("bash", { command: "make" }, "out", true);
        expect(await run("bash", { command: "make" }, "out", true)).toBeUndefined();
    });

    it("matches input regardless of key order", async () => {
        const { run } = setup();
        await run("read", { path: "a.ts", offset: 1 }, "x");
        await run("read", { offset: 1, path: "a.ts" }, "x");
        expect((await run("read", { path: "a.ts", offset: 1 }, "x"))?.block).toBe(true);
    });

    it("starts the streak again after a different call", async () => {
        const { run } = setup();
        await run("bash", { command: "ls" }, "a");
        await run("bash", { command: "ls" }, "a");
        await run("bash", { command: "pwd" }, "/x");
        expect(await run("bash", { command: "ls" }, "a")).toBeUndefined();
        expect(await run("bash", { command: "ls" }, "a")).toBeUndefined();
    });

    it("resets when the run settles, not when a new agent turn starts", async () => {
        const { fire, run } = setup();
        await run("bash", { command: "ls" }, "a");
        await run("bash", { command: "ls" }, "a");
        await fire("agent_start", { type: "agent_start" });
        expect((await run("bash", { command: "ls" }, "a"))?.block).toBe(true);

        await fire("agent_settled", { type: "agent_settled", aborted: true });
        expect(await run("bash", { command: "ls" }, "a")).toBeUndefined();
    });

    it.each([
        ["grep loop", GREP_LOOP_COMMAND, GREP_LOOP_RESULT, false],
        ["new-split loop", SPLIT_LOOP_COMMAND, SPLIT_LOOP_RESULT, true],
    ])("stops the real %s at call four", async (_name, command, result, isError) => {
        const { ctx, run } = setup();
        const verdicts = [];
        for (let i = 0; i < 6 && !ctx.abort.mock.calls.length; i++) {
            verdicts.push(await run("bash", { command }, result, isError));
        }

        expect(verdicts.slice(0, 2)).toEqual([undefined, undefined]);
        expect(verdicts[2]?.block).toBe(true);
        expect(verdicts[3]?.terminate).toBe(true);
        expect(verdicts).toHaveLength(4);
    });
});

describe("tool-guards: cmux target guard", () => {
    async function bash(command: string) {
        const { fire } = setup();
        return fire("tool_call", { toolCallId: "c", toolName: "bash", input: { command } });
    }

    it("blocks the real misfire: variables from an earlier bash call", async () => {
        const verdict = await bash('cmux send --workspace "$WS" --surface "$W" "task"');

        expect(verdict?.block).toBe(true);
        expect(verdict?.reason).toMatch(/^\[CMUX\]/);
        expect(verdict?.reason).toMatch(/fresh shell/);
        expect(verdict?.reason).toContain("${W:?}");
    });

    it("blocks a missing surface and names the caller's own pane as the default", async () => {
        const verdict = await bash('cmux send "hello"');

        expect(verdict?.block).toBe(true);
        expect(verdict?.reason).toContain("$CMUX_SURFACE_ID");
    });

    it.each([
        ['cmux send --surface "" hi'],
        ['cmux send-key --surface surface:3 --workspace "" enter'],
        ['W=$(cmux new-split right --json | jq -r .surface_ref); cmux send --surface "$W" hi'],
        ['cmux send --surface "$1" hi'],
        ['cmux send --surface "$(cmux identify)" hi'],
        ['cmux send --workspace "$WS" --surface surface:3 hi'],
        ['cmux send --surface=$W hi'],
        [HEREDOC_DISPATCH],
        ["cat > t.md <<'EOF'\nno end tag\ncmux send --surface surface:3 go"],
        ["cat > t.md <<'EOF'\ncmux send --surface $W go\nEOF\ncmux send --surface surface:3 go"],
        ['timeout 5 cmux send --surface "$W" hi'],
        ['sudo cmux send --surface "$W" hi'],
        ['command cmux send --surface "$W" hi'],
        ['\\cmux send --surface "$W" hi'],
        ['(cmux send --surface "$W" hi)'],
        ['OUT=$(cmux send --surface "$W" hi)'],
        ['FOO=1 cmux send --surface "$W" hi'],
        ['xargs cmux send --surface "$W"'],
        ['if cmux send --surface "$W" hi; then :; fi'],
        ['bash -c "cmux send --surface $W hi"'],
        ['cmux send --surface surface:1 a & cmux send --surface "$W" b'],
        ['echo hi & cmux send --surface "$W" b'],
        ['cmux send --surface `cat ref.txt` hi'],
        ['cmux send --surface surface:1 --surface "$W" hi'],
        ['cmux \\\n  send --surface "$W" hi'],
    ])("blocks an untraceable target: %s", async (command) => {
        expect((await bash(command))?.block).toBe(true);
    });

    it.each([
        ["cmux send --surface surface:12 hi"],
        ['cmux send --surface "${W:?}" hi'],
        ['cmux send --surface "${W:?worker surface missing}" hi'],
        ['cmux send --surface "$CMUX_SURFACE_ID" hi'],
        ['cmux send --surface "${1:?}" hi'],
        ['cmux send --workspace "${WS:?}" --surface "${W1:?}" hi'],
        ['for S in $S1 $S2; do cmux send --surface "${S:?}" "task"; cmux send-key --surface "${S:?}" enter; done'],
        [HEREDOC_DISPATCH.replaceAll("$WS", "workspace:1000000003").replaceAll("$W1", "surface:1000000022")],
        ["/Applications/cmux.app/Contents/Resources/bin/cmux send --surface surface:4 hi"],
        ['timeout 5 cmux send --surface "${W:?}" hi'],
        ['cmux send --workspace "${WS:?}" \\\n  --surface "${W1:?}" "task"'],
        ['cmux send --surface surface:3 "later run: cmux send --surface $W"'],
    ])("allows a safe target: %s", async (command) => {
        expect(await bash(command)).toBeUndefined();
    });

    it.each([["ls -la"], ["echo cmux send x"], ['cmux read-screen --surface "$W" --lines 20'], ["cmux new-split right --surface surface:1"]])(
        "ignores a command that does not type into a pane: %s",
        async (command) => {
            expect(await bash(command)).toBeUndefined();
        },
    );
});
