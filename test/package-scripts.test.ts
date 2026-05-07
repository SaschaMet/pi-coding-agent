import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("package scripts", () => {
    it("keeps only local runtime scripts", () => {
        const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")) as {
            scripts: Record<string, string>;
        };

        expect(packageJson.scripts.agent).toBe("tsx src/main.ts");
        expect(packageJson.scripts.dev).toBe("tsx watch src/main.ts");
        expect(packageJson.scripts["agent:sandbox"]).toBeUndefined();
        expect(packageJson.scripts["dev:sandbox"]).toBeUndefined();
    });
});
