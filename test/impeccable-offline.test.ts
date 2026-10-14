import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const localDir = path.join(process.cwd(), ".pi", "skill-library", "impeccable", "local");
const DEAD = "http://127.0.0.1:9";
const VERSION = "0.1.14";

const tmpRoots: string[] = [];

afterEach(() => {
    for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// Mirrors the installed layout: <skill>/local/* next to <skill>/scripts/VERSION.
function makeSkill(): { root: string; home: string; local: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "impeccable-offline-"));
    tmpRoots.push(root);
    const skill = path.join(root, "skill");
    const local = path.join(skill, "local");
    fs.mkdirSync(local, { recursive: true });
    fs.mkdirSync(path.join(skill, "scripts"));
    fs.writeFileSync(path.join(skill, "scripts", "VERSION"), `${VERSION}\n`);
    for (const f of ["offline.sh", "engine-offline", "chrome-offline"]) {
        fs.copyFileSync(path.join(localDir, f), path.join(local, f));
    }
    const home = path.join(root, "home");
    fs.mkdirSync(home);
    return { root, home, local };
}

// A stand-in binary that prints its args and env, so the test sees exactly what the wrapper passed on.
function writeFake(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '#!/bin/sh\nfor a in "$@"; do echo "ARG=$a"; done\nenv\n');
    fs.chmodSync(file, 0o755);
}

function run(script: string, env: Record<string, string>, args: string[] = []) {
    return spawnSync("sh", [script, ...args], {
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
        encoding: "utf-8",
    });
}

function envOf(stdout: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const line of stdout.split("\n")) {
        const i = line.indexOf("=");
        if (i > 0 && !line.startsWith("ARG=")) map.set(line.slice(0, i), line.slice(i + 1));
    }
    return map;
}

describe("impeccable offline layer", () => {
    it("starts the engine with every remote endpoint dead, even over caller env", () => {
        const { home, local } = makeSkill();
        writeFake(path.join(home, ".impeccable", "bin", VERSION, "impeccable"));
        const res = run(
            path.join(local, "engine-offline"),
            {
                HOME: home,
                HTTPS_PROXY: "http://corp-proxy:8080",
                IMPECCABLE_API_URL: "https://impeccable.style/api",
                IMPECCABLE_LIVE_COPY_AGENT: "auto",
                NO_PROXY: "*",
            },
            ["concept-seed", "--scope", "direction"],
        );
        expect(res.status, res.stderr).toBe(0);
        expect(res.stdout).toContain("ARG=concept-seed\nARG=--scope\nARG=direction\n");
        const env = envOf(res.stdout);
        for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy"]) {
            expect(env.get(key), key).toBe(DEAD);
        }
        expect(env.get("NO_PROXY")).toBe("localhost,127.0.0.1,::1");
        expect(env.get("IMPECCABLE_API_URL")).toBe(`${DEAD}/api`);
        expect(env.get("IMPECCABLE_UPDATE_HOST")).toBe(DEAD);
        expect(env.get("IMPECCABLE_CARD_BASE")).toBe(`${DEAD}/cards`);
        expect(env.get("IMPECCABLE_DOWNLOAD_BASE")).toBe(DEAD);
        expect(env.get("IMPECCABLE_NO_UPDATE_CHECK")).toBe("1");
        expect(env.get("IMPECCABLE_NO_TELEMETRY")).toBe("1");
        expect(env.get("DO_NOT_TRACK")).toBe("1");
        expect(env.get("IMPECCABLE_LIVE_COPY_AGENT")).toBe("off");
        expect(env.get("IMPECCABLE_BROWSER")).toBe(path.join(local, "chrome-offline"));
    });

    it("drops OPENAI_API_KEY before the engine starts", () => {
        const { home, local } = makeSkill();
        writeFake(path.join(home, ".impeccable", "bin", VERSION, "impeccable"));
        const res = run(path.join(local, "engine-offline"), { HOME: home, OPENAI_API_KEY: "sk-test-not-real" });
        expect(res.status, res.stderr).toBe(0);
        expect(envOf(res.stdout).has("OPENAI_API_KEY")).toBe(false);
    });

    it("refuses and prints the install command when the engine is missing", () => {
        const { home, local } = makeSkill();
        const res = run(path.join(local, "engine-offline"), { HOME: home });
        expect(res.status).toBe(127);
        expect(res.stdout).toBe("");
        expect(res.stderr).toContain("engine-probe");
        expect(res.stderr).toContain("env -u IMPECCABLE_BIN -u IMPECCABLE_DOWNLOAD_BASE");
    });

    it("refuses with the install hint when HOME is unset", () => {
        const { local } = makeSkill();
        const res = run(path.join(local, "engine-offline"), {});
        expect(res.status).toBe(127);
        expect(res.stdout).toBe("");
        expect(res.stderr).toContain("engine-probe");
    });

    it("prepends the three block flags to the browser args", () => {
        const { root, local } = makeSkill();
        const fakeBrowser = path.join(root, "browser");
        writeFake(fakeBrowser);
        const res = run(path.join(local, "chrome-offline"), { IMPECCABLE_REAL_BROWSER: fakeBrowser }, [
            "--headless=new",
            "about:blank",
        ]);
        expect(res.status, res.stderr).toBe(0);
        const args = res.stdout.split("\n").filter((l) => l.startsWith("ARG=")).map((l) => l.slice(4));
        expect(args).toEqual([
            `--proxy-server=${DEAD}`,
            "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
            "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
            "--headless=new",
            "about:blank",
        ]);
    });

    it("refuses when the configured browser does not exist", () => {
        const { root, local } = makeSkill();
        const res = run(path.join(local, "chrome-offline"), { IMPECCABLE_REAL_BROWSER: path.join(root, "nope") });
        expect(res.status).toBe(127);
        expect(res.stdout).toBe("");
    });

    it("points every URL in offline.sh at the closed local port", () => {
        const text = fs.readFileSync(path.join(localDir, "offline.sh"), "utf-8");
        const urls = text.match(/https?:\/\/[^\s"']+/g) ?? [];
        expect(urls.length).toBeGreaterThanOrEqual(4);
        for (const url of urls) expect(url.startsWith(DEAD), url).toBe(true);
    });
});
