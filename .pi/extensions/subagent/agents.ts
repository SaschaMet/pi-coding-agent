/**
 * Agent and skill discovery/configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";
import { findNearestProjectPiDir, loadConfiguredSkillRoots } from "./config.ts";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
    name: string;
    description: string;
    tools?: string[];
    model?: string;
    systemPrompt: string;
    source: "user" | "project";
    filePath: string;
}

export interface AgentDiscoveryResult {
    agents: AgentConfig[];
    projectAgentsDir: string | null;
}

function loadMarkdownConfigFile(filePath: string, source: "user" | "project"): AgentConfig | null {
    let content: string;
    try {
        content = fs.readFileSync(filePath, "utf-8");
    } catch {
        return null;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) return null;

    const tools = frontmatter.tools
        ?.split(",")
        .map((t: string) => t.trim())
        .filter(Boolean);

    return {
        name: frontmatter.name,
        description: frontmatter.description,
        tools: tools && tools.length > 0 ? tools : undefined,
        model: frontmatter.model,
        systemPrompt: body,
        source,
        filePath,
    };
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
    const agents: AgentConfig[] = [];
    if (!fs.existsSync(dir)) return agents;

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return agents;
    }

    for (const entry of entries) {
        if (!entry.name.endsWith(".md")) continue;
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;

        const filePath = path.join(dir, entry.name);
        const agent = loadMarkdownConfigFile(filePath, source);
        if (agent) agents.push(agent);
    }

    return agents;
}

function isDirectory(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

function isFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
    const projectPiDir = findNearestProjectPiDir(cwd);
    if (!projectPiDir) return null;
    const agentsDir = path.join(projectPiDir, "agents");
    return isDirectory(agentsDir) ? agentsDir : null;
}


function scanSkillFiles(rootDir: string, maxDepth = 4): string[] {
    const found = new Set<string>();

    const visit = (dir: string, depth: number) => {
        if (depth < 0 || !isDirectory(dir)) return;

        const directSkillFile = path.join(dir, "SKILL.md");
        if (isFile(directSkillFile)) {
            found.add(directSkillFile);
            return;
        }

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            visit(path.join(dir, entry.name), depth - 1);
        }
    };

    visit(rootDir, maxDepth);
    return Array.from(found).sort();
}

function loadSkillsFromRoots(roots: string[], source: "user" | "project"): AgentConfig[] {
    const skills: AgentConfig[] = [];
    for (const root of roots) {
        for (const skillFile of scanSkillFiles(root)) {
            const skill = loadMarkdownConfigFile(skillFile, source);
            if (skill) skills.push(skill);
        }
    }
    return skills;
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
    const userDir = path.join(getAgentDir(), "agents");
    const projectAgentsDir = findNearestProjectAgentsDir(cwd);
    const skillRoots = loadConfiguredSkillRoots(cwd);

    const userSkills = scope === "project" ? [] : loadSkillsFromRoots(skillRoots.user, "user");
    const projectSkills = scope === "user" ? [] : loadSkillsFromRoots(skillRoots.project, "project");
    const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
    const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

    const agentMap = new Map<string, AgentConfig>();
    const register = (items: AgentConfig[]) => {
        for (const item of items) agentMap.set(item.name, item);
    };

    if (scope === "both") {
        register(userSkills);
        register(userAgents);
        register(projectSkills);
        register(projectAgents);
    } else if (scope === "user") {
        register(userSkills);
        register(userAgents);
    } else {
        register(projectSkills);
        register(projectAgents);
    }

    return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
    if (agents.length === 0) return { text: "none", remaining: 0 };
    const listed = agents.slice(0, maxItems);
    const remaining = agents.length - listed.length;
    return {
        text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
        remaining,
    };
}
