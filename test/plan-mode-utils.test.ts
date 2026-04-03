import { describe, expect, it } from "vitest";
import { cleanStepText, extractTodoItems, formatTodoItemsForDisplay } from "../.pi/extensions/plan-mode/utils.ts";

describe("plan mode utils", () => {
  it("keeps long step text intact instead of truncating it", () => {
    const input = "A new extension file for the tool, likely .pi/extensions/fetch-web-page.ts with tests and docs";

    expect(cleanStepText(input)).toBe("A new extension file for the tool, likely .pi/extensions/fetch-web-page.ts with tests and docs");
  });

  it("extracts full plan steps without shortening them", () => {
    const message = `Plan:\n1. A new extension file for the tool, likely .pi/extensions/fetch-web-page.ts with tests and docs\n2. Define a minimal parameter schema for a single required url string`;

    expect(extractTodoItems(message)).toEqual([
      {
        step: 1,
        text: "A new extension file for the tool, likely .pi/extensions/fetch-web-page.ts with tests and docs",
        completed: false,
      },
      {
        step: 2,
        text: "Define a minimal parameter schema for a single required url string",
        completed: false,
      },
    ]);
  });

  it("wraps long plan items for display instead of truncating them", () => {
    const display = formatTodoItemsForDisplay([
      {
        step: 1,
        text: "A new extension file for the tool, likely .pi/extensions/fetch-web-page.ts with tests and docs",
        completed: false,
      },
    ], 48);

    const lines = display.split("\n");
    expect(lines[0]).toBe("1. ☐ A new extension file for the tool, likely");
    expect(lines[1]).toBe("   .pi/extensions/fetch-web-page.ts with tests");
    expect(lines[2]).toBe("   and docs");
    for (const line of display.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(48);
    }
  });
});
