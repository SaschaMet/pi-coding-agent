import { describe, expect, it } from "vitest";
import { parseSessionMode, parseSessionModel, toSessionModelOptions } from "../src/session-mode.ts";

describe("parseSessionMode", () => {
    it("defaults to continue-recent when no flag is present", () => {
        expect(parseSessionMode(["node", "main.ts"])).toBe("continue-recent");
    });

    it("selects in-memory mode when --new-session is present", () => {
        expect(parseSessionMode(["node", "main.ts", "--new-session"])).toBe(
            "in-memory",
        );
    });

    it("detects the flag regardless of position among other args", () => {
        expect(
            parseSessionMode(["node", "main.ts", "--model", "x", "--new-session"]),
        ).toBe("in-memory");
    });

    it("does not treat a flag-like value as the flag", () => {
        expect(parseSessionMode(["node", "main.ts", "--model", "--new-session=true"])).toBe(
            "continue-recent",
        );
    });
});

describe("parseSessionModel", () => {
    it("returns undefined when no model flag is present", () => {
        expect(parseSessionModel(["node", "main.ts"])).toBeUndefined();
    });

    it("parses a space-separated --model value", () => {
        expect(parseSessionModel(["node", "main.ts", "--model", "openrouter/z-ai/glm-5.3-flash"])).toEqual({
            model: "openrouter/z-ai/glm-5.3-flash",
        });
    });

    it("parses an =-joined --model value", () => {
        expect(parseSessionModel(["node", "main.ts", "--model=z-ai/glm-5.3-flash"])).toEqual({
            model: "z-ai/glm-5.3-flash",
        });
    });

    it("parses an optional --provider alongside --model", () => {
        expect(
            parseSessionModel(["node", "main.ts", "--provider", "openrouter", "--model", "z-ai/glm-5.3-flash"]),
        ).toEqual({ provider: "openrouter", model: "z-ai/glm-5.3-flash" });
    });

    it("ignores --provider without --model (provider alone selects nothing)", () => {
        expect(parseSessionModel(["node", "main.ts", "--provider", "openrouter"])).toBeUndefined();
    });

    it("does not confuse --model with other flags", () => {
        expect(parseSessionModel(["node", "main.ts", "--new-session", "--model", "m"])).toEqual({ model: "m" });
    });

    it("returns undefined when --model is the last argv entry", () => {
        expect(parseSessionModel(["node", "main.ts", "--model"])).toBeUndefined();
    });

    it("does not swallow a following flag as the --model value", () => {
        expect(parseSessionModel(["node", "main.ts", "--model", "--new-session"])).toBeUndefined();
    });

    it("rejects an empty =-joined --model value", () => {
        expect(parseSessionModel(["node", "main.ts", "--model="])).toBeUndefined();
    });

    it("rejects a flag-like =-joined --model value", () => {
        expect(parseSessionModel(["node", "main.ts", "--model=--foo"])).toBeUndefined();
    });

    it("accepts a single-dash value as a model name", () => {
        expect(parseSessionModel(["node", "main.ts", "--model", "-x"])).toEqual({ model: "-x" });
    });

    it("does not swallow a following flag as the --provider value", () => {
        expect(parseSessionModel(["node", "main.ts", "--provider", "--model", "m"])).toEqual({ model: "m" });
    });

    it("ignores a trailing --provider without a value", () => {
        expect(parseSessionModel(["node", "main.ts", "--model", "m", "--provider"])).toEqual({ model: "m" });
    });
});

describe("toSessionModelOptions", () => {
    const model = { id: "grunt", provider: "iqRouter" };

    it("keeps the thinking level parsed from a :<level> suffix", () => {
        expect(
            toSessionModelOptions({ model, thinkingLevel: "high", warning: undefined, error: undefined }),
        ).toEqual({ model, thinkingLevel: "high" });
    });

    it("omits thinkingLevel when no suffix was given, so the default level stays", () => {
        const options = toSessionModelOptions({ model, thinkingLevel: undefined, warning: undefined, error: undefined });
        expect(options).toEqual({ model });
        expect("thinkingLevel" in options).toBe(false);
    });

    it("returns no options on a resolver error, so the default model and level stay", () => {
        expect(
            toSessionModelOptions({ model: undefined, thinkingLevel: "high", warning: undefined, error: "unknown model" }),
        ).toEqual({});
    });
});
