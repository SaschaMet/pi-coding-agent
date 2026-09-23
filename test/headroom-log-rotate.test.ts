import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts", "headroom-log-rotate.sh");

function run(dir: string): { code: number; out: string; err: string } {
    const result = spawnSync("bash", [SCRIPT, dir], { encoding: "utf8" });
    return {
        code: result.status ?? 1,
        out: result.stdout ?? "",
        err: result.stderr ?? "",
    };
}

describe("headroom-log-rotate", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "headroom-rotate-"));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("moves the live log to .1 and shifts older files", () => {
        fs.writeFileSync(path.join(dir, "proxy.log"), "live");
        fs.writeFileSync(path.join(dir, "proxy.log.1"), "old1");
        fs.writeFileSync(path.join(dir, "proxy.log.2"), "old2");

        const result = run(dir);

        expect(result.code).toBe(0);
        expect(fs.readFileSync(path.join(dir, "proxy.log.1"), "utf8")).toBe("live");
        expect(fs.readFileSync(path.join(dir, "proxy.log.2"), "utf8")).toBe("old1");
        expect(fs.readFileSync(path.join(dir, "proxy.log.3"), "utf8")).toBe("old2");
        expect(fs.existsSync(path.join(dir, "proxy.log"))).toBe(false);
    });

    it("keeps at most 4 rotated files, dropping the oldest", () => {
        for (let i = 1; i <= 4; i++) {
            fs.writeFileSync(path.join(dir, `proxy.log.${i}`), `old${i}`);
        }
        fs.writeFileSync(path.join(dir, "proxy.log"), "live");

        const result = run(dir);

        expect(result.code).toBe(0);
        expect(fs.readFileSync(path.join(dir, "proxy.log.1"), "utf8")).toBe("live");
        expect(fs.readFileSync(path.join(dir, "proxy.log.4"), "utf8")).toBe("old3");
        expect(fs.existsSync(path.join(dir, "proxy.log.5"))).toBe(false);
    });

    it("is a no-op on an empty directory", () => {
        const result = run(dir);

        expect(result.code).toBe(0);
        expect(fs.readdirSync(dir)).toHaveLength(0);
    });

    it("exits 0 with a warning when the directory is missing", () => {
        const result = run(path.join(dir, "does-not-exist"));

        expect(result.code).toBe(0);
        expect(result.err).toMatch(/nothing to rotate/);
    });
});
