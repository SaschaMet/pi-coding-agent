/**
 * Unit tests for the context-analyzer extension's pure core
 * (`.pi/extensions/lib/context-analyzer.ts`).
 *
 * Uses fake ctx / pi / theme objects only — no live PI runtime, no disk state.
 */
import { describe, it, expect } from "vitest";
import {
  type Breakdown,
  type BuildPromptOptionsLike,
  type ContextLike,
  type PiLike,
  type SessionEntryLike,
  type ThemeLike,
  type ToolLike,
  buildReport,
  bar,
  collectBreakdown,
  compactList,
  fileRows,
  fmt,
  messagesSection,
  percent,
  skillPromptTokens,
  skillRows,
  systemPromptSection,
  themeColorFor,
  textTokens,
  toolRows,
  toolsSection,
} from "../.pi/extensions/lib/context-analyzer.ts";

/* ------------------------------------------------------------------ */
/* Fakes                                                               */
/* ------------------------------------------------------------------ */

const identityTheme: ThemeLike = {
  fg: (_c, s) => s,
  bold: (s) => s,
};

interface CtxOverrides {
  prompt?: string;
  options?: BuildPromptOptionsLike;
  usage?:
    | { tokens: number | null; contextWindow: number; percent: number | null }
    | undefined;
  model?: { provider: string; id: string } | undefined;
  entries?: SessionEntryLike[];
}

function makeCtx(overrides: CtxOverrides = {}): ContextLike {
  return {
    getSystemPrompt: () => overrides.prompt ?? "BASE PROMPT",
    getSystemPromptOptions: () => overrides.options ?? {},
    getContextUsage: () => overrides.usage,
    model: overrides.model ?? { provider: "test", id: "model" },
    ui: { theme: identityTheme },
    sessionManager: { buildContextEntries: () => overrides.entries ?? [] },
  };
}

function makePi(tools: ToolLike[] = []): PiLike {
  return { getAllTools: () => tools };
}

/** Estimator: messages carry a `t` field with their token count. */
const tEstimate = (m: unknown): number => (m as { t?: number }).t ?? 0;

const msg = (role: string, t: number) => ({
  type: "message" as const,
  message: { role, t },
});

/* ------------------------------------------------------------------ */
/* Token estimation                                                    */
/* ------------------------------------------------------------------ */

describe("textTokens", () => {
  it("returns 0 for empty, whitespace, null and undefined", () => {
    expect(textTokens("")).toBe(0);
    expect(textTokens("   ")).toBe(0);
    expect(textTokens(null)).toBe(0);
    expect(textTokens(undefined)).toBe(0);
  });

  it("estimates chars/4, minimum 1 for non-empty text", () => {
    expect(textTokens("abcd")).toBe(1);
    expect(textTokens("abcde")).toBe(2);
    expect(textTokens(" a ")).toBe(1);
    expect(textTokens("x".repeat(400))).toBe(100);
  });
});

describe("skillPromptTokens", () => {
  it("adds a flat prompt pad on top of name/description/path", () => {
    expect(skillPromptTokens("a", "b", "c")).toBe(textTokens("a b c") + 30);
    expect(skillPromptTokens("s1", "d", "/p/SKILL.md")).toBe(34);
  });
});

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

describe("fmt", () => {
  it("formats compactly: raw, k, M", () => {
    expect(fmt(0)).toBe("0");
    expect(fmt(42)).toBe("42");
    expect(fmt(1_234)).toBe("1.2k");
    expect(fmt(12_345)).toBe("12.3k");
    expect(fmt(1_000_000)).toBe("1.00M");
    expect(fmt(1_500_000)).toBe("1.50M");
  });
});

describe("percent", () => {
  it("computes share of window, 0 when window is unknown", () => {
    expect(percent(50, 100)).toBe(50);
    expect(percent(250, 100)).toBe(250);
    expect(percent(1, 0)).toBe(0);
  });
});

describe("themeColorFor", () => {
  it("colors by usage share and compaction threshold", () => {
    expect(themeColorFor(10, 100, 80)).toBe("success");
    expect(themeColorFor(50, 100, 80)).toBe("accent");
    expect(themeColorFor(75, 100, 80)).toBe("warning");
    expect(themeColorFor(95, 100, 80)).toBe("error");
    expect(themeColorFor(79, 100, 75)).toBe("error"); // above threshold
  });
});

describe("bar", () => {
  it("fills proportionally and marks the threshold position", () => {
    expect(bar(50, 100, 80, 10)).toBe("█████░░░┃░");
    expect(bar(0, 100, 80, 10)).toBe("░░░░░░░░┃░");
    expect(bar(100, 100, 80, 10)).toBe("████████┃█");
    expect(bar(50, 100, 80, 20)).toHaveLength(20);
  });
});

describe("compactList", () => {
  it("lists largest first, capped, with '+N more'", () => {
    const items = [
      { label: "a", tokens: 10 },
      { label: "b", tokens: 5 },
      { label: "c", tokens: 1 },
      { label: "d", tokens: 2 },
    ];
    expect(compactList(items, 2)).toBe("a 10 · b 5 · +2 more");
  });

  it("lists all items when under the cap and handles empty input", () => {
    expect(
      compactList([
        { label: "a", tokens: 3 },
        { label: "b", tokens: 1 },
      ]),
    ).toBe("a 3 · b 1");
    expect(compactList([])).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* Breakdown sections                                                  */
/* ------------------------------------------------------------------ */

describe("systemPromptSection", () => {
  it("splits the system prompt into parts and back-fills the remainder", () => {
    const ctx = makeCtx({
      prompt: "x".repeat(400), // 100 tokens total
      options: {
        customPrompt: "c".repeat(40), // 10
        contextFiles: [{ path: "/a/AGENTS.md", content: "f".repeat(80) }], // 20
        skills: [{ name: "s1", description: "d", filePath: "/p/SKILL.md" }], // 34
      },
    });
    const s = systemPromptSection(ctx);
    expect(s.title).toBe("System prompt");
    expect(s.total).toBe(100);
    expect(s.lines).toEqual([
      { label: "custom prompt", tokens: 10 },
      { label: "context files (1)", tokens: 20, detail: "AGENTS.md 20" },
      { label: "skills (1)", tokens: 34, detail: "s1 34" },
      { label: "base prompt / other", tokens: 36 },
    ]);
  });

  it("never back-fills a negative remainder and totals at least the parts sum", () => {
    const ctx = makeCtx({
      prompt: "tiny", // 1 token, parts sum larger
      options: { customPrompt: "c".repeat(4_000) }, // 1000 tokens
    });
    const s = systemPromptSection(ctx);
    expect(s.total).toBe(1000);
    expect(s.lines).toEqual([{ label: "custom prompt", tokens: 1000 }]);
  });

  it("omits zero-size parts", () => {
    const s = systemPromptSection(makeCtx({ prompt: "x".repeat(100) }));
    expect(s.lines).toEqual([{ label: "base prompt / other", tokens: 25 }]);
  });

  it("includes guidelines, tool snippets and appended prompt when present", () => {
    const ctx = makeCtx({
      prompt: "x".repeat(800), // 200
      options: {
        promptGuidelines: ["g1", "g2"], // 2
        toolSnippets: { read: "r snippet" }, // 5
        appendSystemPrompt: "a".repeat(40), // 10
      },
    });
    const labels = systemPromptSection(ctx).lines.map((l) => l.label);
    expect(labels).toContain("guidelines");
    expect(labels).toContain("tool snippets");
    expect(labels).toContain("appended prompt");
  });
});

describe("messagesSection", () => {
  it("groups tokens by role and counts compaction summaries", () => {
    const entries = [
      msg("user", 10),
      msg("assistant", 20),
      msg("toolResult", 5),
      { type: "thinking" },
      { type: "compaction", summary: "s".repeat(40) }, // 10
    ];
    const s = messagesSection(makeCtx({ entries }), tEstimate);
    expect(s.title).toBe("Messages");
    expect(s.total).toBe(45);
    expect(s.lines).toEqual([
      { label: "compaction summary", tokens: 10 },
      { label: "assistant", tokens: 20 },
      { label: "toolResult", tokens: 5 },
      { label: "user", tokens: 10 },
    ]);
  });

  it("returns an empty section with zero total for an empty session", () => {
    const s = messagesSection(makeCtx(), tEstimate);
    expect(s).toEqual({ title: "Messages", total: 0, lines: [] });
  });
});

describe("toolsSection", () => {
  const tools: ToolLike[] = [
    {
      name: "read",
      description: "d1",
      parameters: {},
      sourceInfo: { source: "builtin" },
    },
    {
      name: "mcp_x",
      description: "d2",
      parameters: {},
      sourceInfo: { source: "extension" },
    },
    {
      name: "sdk_t",
      description: "d3",
      parameters: { a: 1 },
      sourceInfo: { source: "sdk" },
    },
    { name: "no_source", description: "d4", parameters: {} },
  ];

  it("groups tools by source with counts and token totals", () => {
    const s = toolsSection(makePi(tools));
    expect(s.title).toBe("Tools");
    const labels = s.lines.map((l) => l.label);
    expect(labels).toEqual([
      "extension (incl. MCP) (2)",
      "sdk (1)",
      "builtin (1)",
    ]);
    const expected = [
      ...tools.map((t) =>
        textTokens(
          JSON.stringify({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          }),
        ),
      ),
    ];
    expect(s.total).toBe(expected.reduce((a, b) => a + b, 0));
  });

  it("falls back to the extension group when sourceInfo is missing", () => {
    const s = toolsSection(makePi([tools[3]]));
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].label).toBe("extension (incl. MCP) (1)");
  });

  it("returns an empty section when there are no tools", () => {
    const s = toolsSection(makePi());
    expect(s).toEqual({ title: "Tools", total: 0, lines: [] });
  });
});

describe("collectBreakdown", () => {
  it("returns the three sections in fixed order", () => {
    const pi = makePi([{ name: "t", description: "d", parameters: {} }]);
    const ctx = makeCtx({ entries: [msg("user", 4)] });
    const b: Breakdown = collectBreakdown(pi, ctx, tEstimate);
    expect([b.system.title, b.messages.title, b.tools.title]).toEqual([
      "System prompt",
      "Messages",
      "Tools",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* List rows                                                           */
/* ------------------------------------------------------------------ */

describe("list rows", () => {
  it("skillRows maps skills to name/description/tokens", () => {
    const rows = skillRows(
      makeCtx({
        options: {
          skills: [
            { name: "s1", description: "d1", filePath: "/a/SKILL.md" },
            { name: "s2", description: "d2", filePath: "/b/SKILL.md" },
          ],
        },
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: "s1",
      desc: "d1",
      tokens: skillPromptTokens("s1", "d1", "/a/SKILL.md"),
    });
  });

  it("fileRows maps context files to path/tokens", () => {
    const rows = fileRows(
      makeCtx({
        options: {
          contextFiles: [{ path: "/a/AGENTS.md", content: "f".repeat(80) }],
        },
      }),
    );
    expect(rows).toEqual([{ name: "/a/AGENTS.md", desc: "", tokens: 20 }]);
  });

  it("toolRows maps tools to name/source/tokens", () => {
    const rows = toolRows(
      makePi([
        {
          name: "t",
          description: "d",
          parameters: {},
          sourceInfo: { source: "sdk" },
        },
      ]),
    );
    expect(rows).toEqual([
      {
        name: "t",
        desc: "sdk",
        tokens: textTokens(
          JSON.stringify({ name: "t", description: "d", parameters: {} }),
        ),
      },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

describe("buildReport", () => {
  it("reports no usage when getContextUsage returns undefined", () => {
    const report = buildReport(makePi(), makeCtx());
    expect(report).toContain("Context Usage");
    expect(report).toContain("No active model or session yet.");
  });

  it("reports usage, bar, breakdown and reconciliation", () => {
    const ctx = makeCtx({
      prompt: "x".repeat(3_600), // 900 tokens → 90% of the reported 1.0k
      usage: { tokens: 1_000, contextWindow: 200_000, percent: 0.5 },
      model: { provider: "p", id: "m" },
    });
    const report = buildReport(makePi(), ctx);
    expect(report).toContain("p/m");
    expect(report).toContain("200.0k tokens");
    expect(report).toContain("1.0k tokens (0.5%)");
    expect(report).toContain("199.0k tokens");
    expect(report).toContain("┃");
    expect(report).toContain("auto-compaction threshold");
    expect(report).toContain("Section breakdown (estimated)");
    expect(report).toContain("✓ Breakdown accounts for");
  });

  it("skips the breakdown when tokens are unknown", () => {
    const ctx = makeCtx({
      usage: { tokens: null, contextWindow: 200_000, percent: null },
    });
    const report = buildReport(makePi(), ctx);
    expect(report).toContain("Breakdown unavailable (tokens unknown).");
    expect(report).not.toContain("Section breakdown (estimated)");
  });
});
