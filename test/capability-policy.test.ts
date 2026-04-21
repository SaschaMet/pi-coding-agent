import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    clearCapabilityConfigCache,
    evaluateBashCommand,
    evaluatePathToolAccess,
    getMissingCapabilityTools,
    loadCapabilityConfig,
    loadCapabilityConfigCached,
    validateCapabilityConfig,
} from "../.pi/extensions/capability-policy.ts";

const tempDirs: string[] = [];

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

describe("capability policy", () => {
    it("validates default capability config", () => {
        const config = loadCapabilityConfig(process.cwd());
        expect(validateCapabilityConfig(config)).toEqual([]);
    });

    it("reuses cached capability config when file is unchanged", () => {
        clearCapabilityConfigCache();
        const first = loadCapabilityConfigCached(process.cwd());
        const second = loadCapabilityConfigCached(process.cwd());
        expect(second).toBe(first);
    });

    it("detects missing tool capability entries", () => {
        const config = loadCapabilityConfig(process.cwd());
        const missing = getMissingCapabilityTools(["read", "bash", "unknown_tool"], config);
        expect(missing).toEqual(["unknown_tool"]);
    });

    it("allows non-delete bash commands and confirms delete/.env reads", () => {
        const config = loadCapabilityConfig(process.cwd());

        const env = evaluateBashCommand("printenv", false, config);
        expect(env.action).toBe("allow");

        const network = evaluateBashCommand("curl https://example.com", false, config);
        expect(network.action).toBe("allow");

        const safe = evaluateBashCommand("ls -la src", false, config);
        expect(safe.action).toBe("allow");

        const deleteNonUi = evaluateBashCommand("rm -rf /tmp/foo", false, config);
        expect(deleteNonUi.action).toBe("block");
        expect(deleteNonUi.reason).toContain("no UI");

        const deleteUi = evaluateBashCommand("rm -rf /tmp/foo", true, config);
        expect(deleteUi.action).toBe("confirm");

        const envFileUi = evaluateBashCommand("cat .env", true, config);
        expect(envFileUi.action).toBe("confirm");
    });

    it("allows repo-standard npm verification scripts", () => {
        const config = loadCapabilityConfig(process.cwd());

        expect(evaluateBashCommand("npm run smoke", false, config).action).toBe("allow");
        expect(evaluateBashCommand("npm run typecheck", false, config).action).toBe("allow");
        expect(evaluateBashCommand("npm run test:coverage", false, config).action).toBe("allow");
        expect(evaluateBashCommand("npm run docs:sync-pi", false, config).action).toBe("allow");
    });

    it("allows python and uv version diagnostics", () => {
        const config = loadCapabilityConfig(process.cwd());

        expect(evaluateBashCommand("python --version", false, config).action).toBe("allow");
        expect(evaluateBashCommand("python3 --version", false, config).action).toBe("allow");
        expect(evaluateBashCommand("python3 -V", false, config).action).toBe("allow");
        expect(evaluateBashCommand("uv --version", false, config).action).toBe("allow");
        expect(evaluateBashCommand("uv -V", false, config).action).toBe("allow");
        expect(evaluateBashCommand("uv run --python 3.12 python3 --version", false, config).action).toBe("allow");
    });

    it("allows python and uv run execution workflows", () => {
        const config = loadCapabilityConfig(process.cwd());

        expect(evaluateBashCommand("python3 scripts/app.py", false, config).action).toBe("allow");
        expect(evaluateBashCommand("python -m http.server 8000", false, config).action).toBe("allow");
        expect(evaluateBashCommand("uv run --python 3.12 python3 scripts/app.py", false, config).action).toBe("allow");
        expect(evaluateBashCommand("uv run pytest -q", false, config).action).toBe("allow");
    });

    it("allows npm/bun/php and related execution workflows", () => {
        const config = loadCapabilityConfig(process.cwd());

        expect(evaluateBashCommand("npm run dev", false, config).action).toBe("allow");
        expect(evaluateBashCommand("npm install", false, config).action).toBe("allow");
        expect(evaluateBashCommand("pnpm run build", false, config).action).toBe("allow");
        expect(evaluateBashCommand("yarn dev", false, config).action).toBe("allow");
        expect(evaluateBashCommand("npx tsx scripts/smoke.ts", false, config).action).toBe("allow");
        expect(evaluateBashCommand("bun run dev", false, config).action).toBe("allow");
        expect(evaluateBashCommand("bunx vitest", false, config).action).toBe("allow");
        expect(evaluateBashCommand("php artisan serve", false, config).action).toBe("allow");
        expect(evaluateBashCommand("composer install", false, config).action).toBe("allow");
    });

    it("allows shell separators when command does not match confirm rules", () => {
        const config = loadCapabilityConfig(process.cwd());

        const chained = evaluateBashCommand("npm run smoke ; printenv", false, config);
        expect(chained.action).toBe("allow");
    });

    it("allows safe command pipelines", () => {
        const config = loadCapabilityConfig(process.cwd());

        const piped = evaluateBashCommand("jq 'keys' example-chat.json | head -100", false, config);
        expect(piped.action).toBe("allow");
    });

    it("allows safe boolean command chaining", () => {
        const config = loadCapabilityConfig(process.cwd());

        const chainedAnd = evaluateBashCommand("npm run smoke && npm run typecheck", false, config);
        expect(chainedAnd.action).toBe("allow");

        const chainedOr = evaluateBashCommand("npm run smoke || npm run typecheck", false, config);
        expect(chainedOr.action).toBe("allow");
    });

    it("does not require confirmation for non-delete git commands", () => {
        const config = loadCapabilityConfig(process.cwd());

        const nonUi = evaluateBashCommand("git push origin main", false, config);
        expect(nonUi.action).toBe("allow");
    });

    it("confirms .env reads and allows other path access", () => {
        const config = loadCapabilityConfig(process.cwd());

        const readEnv = evaluatePathToolAccess("read", ".env", process.cwd(), config);
        expect(readEnv.action).toBe("confirm");

        const grepRoot = evaluatePathToolAccess("grep", ".", process.cwd(), config);
        expect(grepRoot.action).toBe("allow");

        const grepProtected = evaluatePathToolAccess("grep", ".git", process.cwd(), config);
        expect(grepProtected.action).toBe("allow");

        const grepScoped = evaluatePathToolAccess("grep", "src", process.cwd(), config);
        expect(grepScoped.action).toBe("allow");
    });

    it("allows web tools without confirmation", () => {
        const config = loadCapabilityConfig(process.cwd());

        expect(config.tools.web_search?.mode).toBe("allow");
        expect(config.tools.fetch_web_page?.mode).toBe("allow");
    });

    it("fails closed when capabilities file is missing", () => {
        const cwd = createTempDir("cap-missing-");
        fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
        fs.writeFileSync(
            path.join(cwd, ".pi", "agent.config.json"),
            JSON.stringify({ security: { capabilitiesFile: ".pi/security/capabilities.json" } }),
        );

        expect(() => loadCapabilityConfig(cwd)).toThrowError(/capabilities\.json/);
    });

    it("fails closed when capabilities file is invalid JSON", () => {
        const cwd = createTempDir("cap-invalid-");
        fs.mkdirSync(path.join(cwd, ".pi", "security"), { recursive: true });
        fs.writeFileSync(
            path.join(cwd, ".pi", "agent.config.json"),
            JSON.stringify({ security: { capabilitiesFile: ".pi/security/capabilities.json" } }),
        );
        fs.writeFileSync(path.join(cwd, ".pi", "security", "capabilities.json"), "{ invalid json");

        expect(() => loadCapabilityConfig(cwd)).toThrowError(/invalid JSON/i);
    });
});
