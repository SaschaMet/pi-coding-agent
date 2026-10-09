import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = fs.realpathSync(path.resolve(import.meta.dirname, ".."));
const SCRIPT = path.join(REPO_ROOT, "scripts", "shell", "pi-update.zsh");

// Stands in for the real pi binary: records where it ran and with which args.
const FAKE_PI = `#!/bin/bash
printf '%s\\n' "$(pwd -P)" > "$FAKE_LOG"
printf '%s\\n' "$@" >> "$FAKE_LOG"
exit "\${FAKE_EXIT:-0}"
`;

describe("piupdate", () => {
    let dir: string;
    let fakePi: string;
    let log: string;

    beforeEach(() => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-update-")));
        fakePi = path.join(dir, "fake-pi");
        log = path.join(dir, "fake.log");
        fs.writeFileSync(fakePi, FAKE_PI, { mode: 0o755 });
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function run(script: string, env: Record<string, string> = {}) {
        // Exit 99 when sourcing did not define piupdate, so no test passes vacuously.
        const body = `source ${JSON.stringify(SCRIPT)}; typeset -f piupdate >/dev/null || exit 99; ${script}`;
        const result = spawnSync("zsh", ["-fc", body], {
            cwd: dir,
            encoding: "utf8",
            env: { ...process.env, PI_REAL_BIN: fakePi, FAKE_LOG: log, ...env },
            timeout: 30_000,
        });
        return { code: result.status, out: result.stdout, err: result.stderr };
    }

    function recorded(): string[] {
        return fs.readFileSync(log, "utf8").trimEnd().split("\n");
    }

    it("runs pi update from the repo root with the caller's args", () => {
        const result = run("piupdate --extensions");

        expect(result.code).toBe(0);
        expect(recorded()).toEqual([REPO_ROOT, "update", "--extensions"]);
    });

    it("passes a failing exit code through", () => {
        const result = run("piupdate --extensions", { FAKE_EXIT: "3" });

        expect(result.code).toBe(3);
    });

    it("leaves the caller's working directory unchanged", () => {
        const result = run('piupdate --extensions; print -r -- "$PWD"');

        expect(result.code).toBe(0);
        expect(recorded()[0]).toBe(REPO_ROOT);
        expect(result.out.trim()).toBe(dir);
    });

    it("fails without running pi when the repo folder is missing", () => {
        const result = run(`PI_CODING_AGENT_REPO=${JSON.stringify(path.join(dir, "missing"))}; piupdate --extensions`);

        expect(result.code).not.toBe(0);
        expect(result.code).not.toBe(99);
        expect(fs.existsSync(log)).toBe(false);
    });
});
