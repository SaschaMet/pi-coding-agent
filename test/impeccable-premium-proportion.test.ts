import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const localDir = path.join(process.cwd(), ".pi", "skill-library", "impeccable", "local");
const script = path.join(localDir, "measure-proportions.mjs");

function run(args: string[]) {
    // A cwd without node_modules: a local URL passes the host check and stops at the
    // Playwright lookup, so no browser starts and no request is made.
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "measure-"));
    try {
        return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf-8" });
    } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
    }
}

describe("impeccable premium-proportion local layer", () => {
    it("RULES.md rule 15 routes to files that exist", () => {
        const rules = fs.readFileSync(path.join(localDir, "RULES.md"), "utf-8");
        expect(rules).toMatch(/^15\. \*\*Persuade surfaces/m);
        expect(rules).toContain("[premium-proportion.md](premium-proportion.md)");
        expect(fs.existsSync(path.join(localDir, "premium-proportion.md"))).toBe(true);
        expect(fs.existsSync(script)).toBe(true);
    });

    it("premium-proportion.md links resolve", () => {
        const text = fs.readFileSync(path.join(localDir, "premium-proportion.md"), "utf-8");
        const links = [...text.matchAll(/\]\(([^)#][^)]*)\)/g)].map((m) => m[1] ?? "");
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) expect(fs.existsSync(path.join(localDir, link)), link).toBe(true);
    });

    it("refuses a non-local URL before starting a browser", () => {
        const r = run(["https://example.com/"]);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain("refused: example.com is not local");
    });

    it("accepts a localhost URL (passes the host check)", () => {
        const r = run(["http://localhost:4321/"]);
        expect(r.stderr).not.toContain("refused");
        expect(r.stderr).toContain("playwright not found");
    });

    it("prints usage without a URL", () => {
        const r = run([]);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain("usage:");
    });
});
