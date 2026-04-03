import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgents } from "../.pi/extensions/subagent/agents.ts";

describe("subagent discovery", () => {
  it("discovers configured skills as subagents and prefers explicit agents on name collisions", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-discovery-project-"));
    const userSkillRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-discovery-user-skills-"));

    fs.mkdirSync(path.join(projectRoot, ".pi", "agents"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".pi", "skills", "brave-search"), { recursive: true });
    fs.mkdirSync(path.join(userSkillRoot, "interactive-planner"), { recursive: true });
    fs.mkdirSync(path.join(userSkillRoot, "worker"), { recursive: true });

    fs.writeFileSync(
      path.join(projectRoot, ".pi", "settings.json"),
      JSON.stringify({ enableSkillCommands: false, skills: [userSkillRoot, ".pi/skills"] }, null, 2),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(projectRoot, ".pi", "skills", "brave-search", "SKILL.md"),
      [
        "---",
        "name: brave-search",
        "description: Search skill",
        "---",
        "Use web search.",
      ].join("\n"),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(userSkillRoot, "interactive-planner", "SKILL.md"),
      [
        "---",
        "name: interactive-planner",
        "description: Planner skill",
        "---",
        "Plan only.",
      ].join("\n"),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(userSkillRoot, "worker", "SKILL.md"),
      [
        "---",
        "name: worker",
        "description: Worker skill",
        "---",
        "Skill-backed worker.",
      ].join("\n"),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(projectRoot, ".pi", "agents", "worker.md"),
      [
        "---",
        "name: worker",
        "description: Worker agent",
        "---",
        "Agent-backed worker.",
      ].join("\n"),
      "utf-8",
    );

    const discovery = discoverAgents(projectRoot, "both");
    const byName = new Map(discovery.agents.map((agent) => [agent.name, agent]));

    expect(byName.get("interactive-planner")?.source).toBe("user");
    expect(byName.get("interactive-planner")?.filePath).toContain(`${path.sep}interactive-planner${path.sep}SKILL.md`);

    expect(byName.get("brave-search")?.source).toBe("project");
    expect(byName.get("brave-search")?.filePath).toContain(`${path.sep}.pi${path.sep}skills${path.sep}brave-search${path.sep}SKILL.md`);

    expect(byName.get("worker")?.source).toBe("project");
    expect(byName.get("worker")?.filePath).toContain(`${path.sep}.pi${path.sep}agents${path.sep}worker.md`);
    expect(byName.get("worker")?.systemPrompt.trim()).toBe("Agent-backed worker.");
  });
});
