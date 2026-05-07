import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("package scripts", () => {
  it("keeps default runtime local-first and sandbox opt-in", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.agent).toBe("tsx src/main.ts");
    expect(packageJson.scripts.dev).toBe("tsx watch src/main.ts");
    expect(packageJson.scripts["agent:sandbox"]).toContain("--container");
    expect(packageJson.scripts["agent:sandbox"]).toContain("--container-net");
    expect(packageJson.scripts["agent:sandbox"]).toContain("--container-mount-paths ~/.pi/agent");
    expect(packageJson.scripts["agent:sandbox"]).toContain("--container-keep");
    expect(packageJson.scripts["agent:sandbox"]).toContain("--sandbox-persist");
    expect(packageJson.scripts["agent:sandbox"]).not.toContain("--no-container-net");
    expect(packageJson.scripts["agent:sandbox"]).not.toContain("--no-container-mount-skills");
    expect(packageJson.scripts["dev:sandbox"]).toContain("--container");
    expect(packageJson.scripts["dev:sandbox"]).toContain("--container-net");
    expect(packageJson.scripts["dev:sandbox"]).toContain("--container-mount-paths ~/.pi/agent");
    expect(packageJson.scripts["dev:sandbox"]).toContain("--container-keep");
    expect(packageJson.scripts["dev:sandbox"]).toContain("--sandbox-persist");
    expect(packageJson.scripts["dev:sandbox"]).not.toContain("--no-container-net");
    expect(packageJson.scripts["dev:sandbox"]).not.toContain("--no-container-mount-skills");
  });
});
