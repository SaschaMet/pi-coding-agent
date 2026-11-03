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
// The recorded literal workspace ref is now stopped by the cmux guard at call one, so the replay uses the caller's own.
const SPLIT_LOOP_RECORDED = "cmux new-split --direction right --workspace workspace:1000110016 --label verify-internal-openapi-r2 2>&1";
const SPLIT_LOOP_COMMAND = SPLIT_LOOP_RECORDED.replace("workspace:1000110016", '"$CMUX_WORKSPACE_ID"');
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
        ['cmux paste --surface "$W" x'],
        ["cmux paste x"],
        ["cmux paste-buffer --name b"],
        ['cmux send-panel --panel "$P" x'],
        ["cmux send-key-panel enter"],
        ['cmux paste --surface surface:1 --window "$WIN" x'],
        ['printf x | cmux paste --surface "$W" -'],
        ["cmux --id-format refs paste x"],
        ["cmux --json send x"],
        ['cmux --socket /s send --surface "$W" x'],
        ["cmux paste -- --surface surface:2"],
        ['echo "$(cmux paste x)"'],
        ['X="$(cmux send x)"'],
        ['cmux send --surface surface:2 "$(cmux paste x)"'],
        ['"cmux" paste x'],
        ["'cmux' paste x"],
        ["c\\mux paste x"],
        ["cmux $(echo send) x"],
        ['cmux "$VERB" --surface surface:1 x'],
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
        ['cmux paste --surface "${W:?}" --submit x'],
        ['cmux send-panel --panel surface:2 "echo hi\\n"'],
        ["printf x | cmux paste --surface surface:3 -"],
        ["cmux --id-format refs send --surface surface:3 x"],
        ['cmux paste --surface surface:2 -- --surface "$W"'],
        ['cmux send --surface surface:2 "built on $(date)"'],
        ['echo "$(cmux send --surface surface:2 x)"'],
        ["timeout 10 cmux send --help 2>&1 | head -40"],
        ["cmux paste --help"],
        ["for v in paste paste-buffer send-panel; do cmux $v --help | head -5; done"],
    ])("allows a safe target: %s", async (command) => {
        expect(await bash(command)).toBeUndefined();
    });

    it.each([["ls -la"], ["echo cmux send x"], ['cmux read-screen --surface "$W" --lines 20'], ["cmux new-split right --surface surface:1"]])(
        "ignores a command that does not type into a pane: %s",
        async (command) => {
            expect(await bash(command)).toBeUndefined();
        },
    );

    it.each([
        ['cmux new-split --workspace "$WS" right --surface "$LAST" --json'],
        ['W1=$(cmux new-split right --json | jq -r .surface_ref); cmux new-split --workspace "${WS:?}" down --surface "$W1"'],
        ['cmux new-pane --workspace "$WS" --type terminal --direction right --focus false'],
        ['cmux new-surface --pane "$P" --type terminal'],
        ['cmux new-split right --window "$WIN"'],
        ['cmux new-split --workspace "" right'],
        ['cmux new-workspace --name "grill" --cwd "$PWD" --command "pi --no-session" --focus false'],
        ['cmux workspace create --name "pi-team" --cwd "$PWD" --layout "$LAYOUT"'],
        ['timeout 5 cmux --id-format refs new-workspace'],
        ['cmux new-split --workspace "${WS:?}" right --surface "${LAST:?}" --json'],
        ['cmux new-pane --workspace "${WS:?}" --type browser --url https://example.com --focus false'],
        ["cmux new-split right --workspace workspace:2"],
        ["cmux new-split right --window window:1"],
        ['cmux new-split --workspace "$CMUX_WORKSPACE_IDX" right'],
        ["cmux workspace --window window:1 create"],
        ["cmux workspace --json create"],
        ["cmux new-workspace --name --help"],
        ['bash -lc "cmux new-workspace"'],
        ['eval "cmux new-workspace"'],
        ["cmux move-tab-to-new-workspace --surface surface:3"],
        ["cmux new-window"],
        ["cmux ssh host"],
        ["cmux mosh host"],
        ["cmux ."],
        ["cmux /tmp"],
        ["cmux move-surface --surface surface:1 --pane pane:9"],
        ["cmux split-off --surface surface:3 right --workspace workspace:2"],
        ["cmux drag-surface-to-split --surface surface:3 right --workspace workspace:2"],
        ["cmux browser open https://example.com --workspace workspace:2"],
        ["cmux markdown open notes.md --workspace workspace:2"],
        ["cmux open notes.md --workspace workspace:2"],
        ["cmux diff --staged --workspace workspace:2"],
        ["cmux ssh-session-attach --session-id 1 --workspace workspace:2"],
        ["cmux tab-action --action move-to-new-workspace --surface surface:3"],
        ["cmux tab-action --action new-terminal-right --workspace workspace:3"],
        ["cmux browser open-split https://example.com --workspace workspace:2"],
        ["cmux browser new https://example.com --window window:2"],
        ["cmux join-pane --target-pane pane:9 --surface surface:4"],
        ["cmux swap-pane --pane pane:1 --target-pane pane:9"],
        ["cmux break-pane --surface surface:4"],
        ["cmux rpc workspace.create {}"],
        ["cmux vm open dev"],
        ["cmux tmux attach foo"],
        ["cmux local-tmux attach foo"],
        ["cmux recover --session abc"],
        ["cmux restore-session"],
        ["cmux vault fork --agent a --session s --turn 3 --open"],
        ["cmux session move id --to host"],
        ["cmux move-workspace-to-window --workspace workspace:2 --window window:2"],
        ["timeout 5 cmux ."],
        ["env FOO=1 cmux ~/projects/app"],
    ])("blocks a pane that may open outside the caller's workspace: %s", async (command) => {
        const verdict = await bash(command);
        expect(verdict?.block).toBe(true);
        expect(verdict?.reason).toMatch(/^\[CMUX\]/);
    });

    it.each([
        ["cmux new-split right"],
        ['cmux new-split right --surface "$CMUX_SURFACE_ID" --json'],
        ['cmux new-split --workspace "$CMUX_WORKSPACE_ID" right --surface "${LAST:?}" --json'],
        ['cmux new-split --workspace "$CMUX_WORKSPACE_ID" down --surface surface:12'],
        ['cmux new-pane --workspace "${CMUX_WORKSPACE_ID}" --type browser --url https://example.com --focus false'],
        ["cmux new-surface --pane pane:3 --type terminal"],
        ["cmux split-off --surface surface:3 right"],
        ["cmux open notes.md"],
        ["cmux markdown open notes.md"],
        ["cmux browser open https://example.com"],
        ["cmux diff --staged"],
        ["cmux workspace list --json"],
        ["cmux tree --workspace workspace:2"],
        ["cmux send --workspace workspace:2 --surface surface:5 x"],
        ['cmux send --surface "$CMUX_PANEL_ID" x'],
        ['grep -rln "cmux" .pi/extensions .pi/local-packages'],
        ["cmux tab-action --action rename --tab tab:3 --title review"],
        ["cmux browser snapshot --surface surface:3"],
        ["cmux vault fork --agent a --session s --turn 3"],
        ["cmux session list"],
        ["timeout 5 grep cmux ./notes.md"],
        ['grep -n "cmux" ./SKILL.md | head -20'],
        ["cmux new-workspace --help"],
        ["cmux workspace list"],
        ['cmux workspace close --workspace "$WS"'],
    ])("allows a pane that stays in the caller's workspace: %s", async (command) => {
        expect(await bash(command)).toBeUndefined();
    });

    it("names the split recipe when a new workspace is blocked", async () => {
        const verdict = await bash("cmux new-workspace --name x");
        expect(verdict?.reason).toContain('cmux new-split right --surface "$CMUX_SURFACE_ID"');
    });

    it("stops the recorded new-split loop at its first call", async () => {
        expect((await bash(SPLIT_LOOP_RECORDED))?.block).toBe(true);
    });

    it("names the caller's workspace when a split targets another one", async () => {
        const verdict = await bash("cmux new-split right --workspace workspace:2");
        expect(verdict?.reason).toContain('--workspace "$CMUX_WORKSPACE_ID"');
    });
});
