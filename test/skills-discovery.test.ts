import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultResourceLoader, SettingsManager } from "@mariozechner/pi-coding-agent";

describe("skills discovery", () => {
  it("discovers Codex skills when ~/.codex/skills exists", async () => {
    const codexPath = path.join(os.homedir(), ".codex", "skills");
    if (!fs.existsSync(codexPath)) {
      return;
    }

    const cwd = process.cwd();
    const settingsManager = SettingsManager.create(cwd);
    const loader = new DefaultResourceLoader({ cwd, settingsManager });
    await loader.reload();

    const codexSkills = loader
      .getSkills()
      .skills.filter((skill) => skill.filePath.includes(`${path.sep}.codex${path.sep}skills${path.sep}`));

    expect(codexSkills.length).toBeGreaterThan(0);
  });
});
