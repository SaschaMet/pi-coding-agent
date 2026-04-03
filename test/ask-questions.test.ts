import { describe, expect, it } from "vitest";
import askQuestionsExtension, { normalizeNonInteractiveAnswers } from "../.pi/extensions/ask-questions.ts";
import { createFakePi } from "./helpers/fake-pi.ts";

describe("ask_questions tool", () => {
    it("uses deterministic first-option fallback without UI", async () => {
        const answers = normalizeNonInteractiveAnswers([
            {
                id: "scope",
                label: "Scope",
                question: "What scope?",
                options: [
                    { label: "Small", value: "small" },
                    { label: "Large", value: "large" },
                ],
            },
        ]);

        expect(answers).toEqual([
            {
                id: "scope",
                label: "Small",
                value: "small",
                was_custom: false,
            },
        ]);
    });

    it("returns keyed answer details in non-interactive mode", async () => {
        const pi = createFakePi();
        askQuestionsExtension(pi as any);
        const tool = pi.tools.get("ask_questions");
        expect(tool).toBeDefined();

        const result = await tool!.execute(
            "call1",
            {
                questions: [
                    {
                        id: "provider",
                        label: "Provider",
                        question: "Which provider?",
                        options: [
                            { label: "Brave", value: "brave" },
                            { label: "Serper", value: "serper" },
                        ],
                    },
                ],
            },
            undefined,
            undefined,
            { hasUI: false, ui: {} },
        );

        expect(result.details.mode).toBe("non_interactive_fallback");
        expect(result.details.fallback_policy).toBe("first_option_per_question");
        expect(result.details.fallback_reason).toBe("ui_unavailable");
        expect(result.details.answers.provider.value).toBe("brave");
    });

    it("supports interactive other-option answers", async () => {
        const pi = createFakePi();
        askQuestionsExtension(pi as any);
        const tool = pi.tools.get("ask");
        expect(tool).toBeDefined();

        const result = await tool!.execute(
            "call2",
            {
                questions: [
                    {
                        id: "tradeoff",
                        label: "Tradeoff",
                        question: "Preferred tradeoff?",
                        options: [
                            { label: "Speed", value: "speed" },
                            { label: "Quality", value: "quality" },
                        ],
                        allow_other: true,
                    },
                ],
            },
            undefined,
            undefined,
            {
                hasUI: true,
                ui: {
                    select: async () => "Other",
                    input: async () => "Latency-aware quality",
                },
            },
        );

        expect(result.details.cancelled).toBe(false);
        expect(result.details.answers.tradeoff.was_custom).toBe(true);
        expect(result.details.answers.tradeoff.value).toBe("Latency-aware quality");
    });
});
