import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(".pi/skills/cmux-orchestration/scripts/wait-or-prompt.sh");

// Fake cmux: exit code and screen text come from env vars; every call is logged, nothing sleeps.
const FAKE_CMUX = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$1" in
    wait-for) exit "\${FAKE_WAIT_EXIT:-1}" ;;
    read-screen) printf '%s\\n' "\${FAKE_SCREEN:-}" ;;
esac
exit 0
`;

let tmpDir = "";
let logFile = "";

function run(args: string[], env: Record<string, string | undefined>) {
    const baseEnv: Record<string, string | undefined> = {
        ...process.env,
        PATH: `${tmpDir}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_LOG: logFile,
        WS: undefined,
        CMUX_WORKSPACE_ID: undefined,
    };
    const merged = { ...baseEnv, ...env };
    for (const key of Object.keys(merged)) {
        if (merged[key] === undefined) delete merged[key];
    }
    return spawnSync("bash", [SCRIPT, ...args], {
        env: merged as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: 20_000,
    });
}

function calls(verb: string): string[] {
    const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n") : [];
    return lines.filter((line) => line.startsWith(`${verb} `));
}

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wait-or-prompt-"));
    logFile = path.join(tmpDir, "calls.log");
    const fake = path.join(tmpDir, "cmux");
    fs.writeFileSync(fake, FAKE_CMUX, { mode: 0o755 });
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("wait-or-prompt.sh", () => {
    it("passes bash -n", () => {
        const res = spawnSync("bash", ["-n", SCRIPT], { encoding: "utf8" });
        expect(res.status).toBe(0);
    });

    it("exits 0 when wait-for signals", () => {
        const res = run(["tok", "surf"], { WS: "ws1", FAKE_WAIT_EXIT: "0" });
        expect(res.status).toBe(0);
        expect(calls("wait-for")).toHaveLength(1);
    });

    it("exits 1 after 36 slices while the worker keeps working", () => {
        const res = run(["tok", "surf"], { WS: "ws1", FAKE_WAIT_EXIT: "1", FAKE_SCREEN: "Working…" });
        expect(res.status).toBe(1);
        expect(calls("wait-for")).toHaveLength(36);
    });

    it("exits 2 on an approval prompt", () => {
        const res = run(["tok", "surf"], {
            WS: "ws1",
            FAKE_SCREEN: "Allow write outside current directory?",
        });
        expect(res.status).toBe(2);
        expect(res.stdout).toContain("PROMPT");
    });

    it("exits 3 on a NEEDS_DOMAIN line", () => {
        const res = run(["tok", "surf"], { WS: "ws1", FAKE_SCREEN: "  NEEDS_DOMAIN: example.com" });
        expect(res.status).toBe(3);
        expect(res.stdout).toContain("SANDBOX STOP");
    });

    it("exits 4 after 4 idle slices", () => {
        const res = run(["tok", "surf"], { WS: "ws1", FAKE_SCREEN: "> ready" });
        expect(res.status).toBe(4);
        expect(res.stdout).toContain("IDLE");
        expect(calls("wait-for")).toHaveLength(4);
    });

    it("exits 64 with a usage line when WS and CMUX_WORKSPACE_ID are empty", () => {
        const res = run(["tok", "surf"], { WS: "", CMUX_WORKSPACE_ID: "" });
        expect(res.status).toBe(64);
        expect(res.stderr).toContain("usage");
        expect(calls("wait-for")).toHaveLength(0);
    });

    it("exits 64 with one arg only", () => {
        const res = run(["tok"], { WS: "ws1" });
        expect(res.status).toBe(64);
        expect(res.stderr).toContain("usage");
    });

    it("falls back to CMUX_WORKSPACE_ID for read-screen", () => {
        const res = run(["tok", "surf"], { CMUX_WORKSPACE_ID: "ws-env", FAKE_SCREEN: "Allow x?" });
        expect(res.status).toBe(2);
        const reads = calls("read-screen");
        expect(reads).toHaveLength(1);
        expect(reads[0]).toContain("--workspace ws-env --surface surf");
    });
});
