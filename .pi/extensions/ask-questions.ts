import type { AgentToolUpdateCallback, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const OptionSchema = Type.Object({
    label: Type.String({ description: "User-facing option label." }),
    description: Type.Optional(Type.String({ description: "Optional short explanation." })),
    value: Type.Optional(Type.String({ description: "Optional value returned in details. Defaults to label." })),
});

const QuestionSchema = Type.Object({
    id: Type.String({ description: "Stable identifier in snake_case." }),
    label: Type.String({ description: "Short header label shown to the user." }),
    question: Type.String({ description: "Question text shown to the user." }),
    options: Type.Array(OptionSchema, { minItems: 2, maxItems: 6 }),
    allow_other: Type.Optional(Type.Boolean({ description: "Allow a free-text answer option (default true)." })),
});

export const AskQuestionsParams = Type.Object({
    questions: Type.Array(QuestionSchema, { minItems: 1, maxItems: 3 }),
});

export interface AskQuestionOption {
    label: string;
    description?: string;
    value?: string;
}

export interface AskQuestion {
    id: string;
    label: string;
    question: string;
    options: AskQuestionOption[];
    allow_other?: boolean;
}

export interface AskQuestionAnswer {
    id: string;
    label: string;
    value: string;
    was_custom: boolean;
}

export function normalizeNonInteractiveAnswers(questions: AskQuestion[]): AskQuestionAnswer[] {
    return questions.map((question) => {
        const first = question.options[0];
        return {
            id: question.id,
            label: first?.label ?? "",
            value: first?.value ?? first?.label ?? "",
            was_custom: false,
        };
    });
}

function logNonInteractiveFallback(answers: AskQuestionAnswer[]): void {
    const ids = answers.map((answer) => answer.id).join(", ");
    console.warn(
        `[ask_questions] UI unavailable. Applied deterministic fallback (first option per question) for: ${ids || "none"}`,
    );
}

function buildSummaryText(answers: AskQuestionAnswer[]): string {
    const lines = answers.map((answer) => `- ${answer.id}: ${answer.value}`);
    return lines.length > 0 ? `Captured answers:\n${lines.join("\n")}` : "No answers captured.";
}

async function executeAskQuestions(
    params: { questions: AskQuestion[] },
    hasUI: boolean,
    ui?: {
        select: (title: string, options: string[]) => Promise<string | undefined>;
        input: (title: string, placeholder?: string) => Promise<string | undefined>;
    },
) {
    if (params.questions.length === 0) {
        return {
            content: [{ type: "text" as const, text: "No questions provided." }],
            details: { cancelled: true, mode: "invalid_input", answers: {} as Record<string, AskQuestionAnswer> },
            isError: true,
        };
    }

    const seen = new Set<string>();
    for (const question of params.questions) {
        if (seen.has(question.id)) {
            return {
                content: [{ type: "text" as const, text: `Duplicate question id: ${question.id}` }],
                details: { cancelled: true, mode: "invalid_input", answers: {} as Record<string, AskQuestionAnswer> },
                isError: true,
            };
        }
        seen.add(question.id);
    }

    if (!hasUI || !ui) {
        const fallbackAnswers = normalizeNonInteractiveAnswers(params.questions);
        logNonInteractiveFallback(fallbackAnswers);
        return {
            content: [
                {
                    type: "text" as const,
                    text: `UI not available. Using deterministic fallback (first option per question).\n${buildSummaryText(
                        fallbackAnswers,
                    )}`,
                },
            ],
            details: {
                cancelled: false,
                mode: "non_interactive_fallback",
                fallback_policy: "first_option_per_question",
                fallback_reason: "ui_unavailable",
                answers: Object.fromEntries(fallbackAnswers.map((answer) => [answer.id, answer])),
            },
        };
    }

    const answers: AskQuestionAnswer[] = [];

    for (const question of params.questions) {
        const optionLabels = question.options.map((option) => option.label);
        const allowOther = question.allow_other !== false;
        if (allowOther) {
            optionLabels.push("Other");
        }

        const choice = await ui.select(`${question.label}\n${question.question}`, optionLabels);
        if (!choice) {
            return {
                content: [{ type: "text" as const, text: "Questionnaire cancelled by user." }],
                details: {
                    cancelled: true,
                    mode: "interactive",
                    answers: Object.fromEntries(answers.map((answer) => [answer.id, answer])),
                },
            };
        }

        if (allowOther && choice === "Other") {
            const custom = await ui.input(`${question.label}\nEnter your answer`, "");
            if (custom === undefined) {
                return {
                    content: [{ type: "text" as const, text: "Questionnaire cancelled by user." }],
                    details: {
                        cancelled: true,
                        mode: "interactive",
                        answers: Object.fromEntries(answers.map((answer) => [answer.id, answer])),
                    },
                };
            }
            answers.push({
                id: question.id,
                label: custom.trim() || "(empty)",
                value: custom.trim(),
                was_custom: true,
            });
            continue;
        }

        const matched = question.options.find((option) => option.label === choice) ?? question.options[0];
        answers.push({
            id: question.id,
            label: matched?.label ?? "",
            value: matched?.value ?? matched?.label ?? "",
            was_custom: false,
        });
    }

    return {
        content: [{ type: "text" as const, text: buildSummaryText(answers) }],
        details: {
            cancelled: false,
            mode: "interactive",
            answers: Object.fromEntries(answers.map((answer) => [answer.id, answer])),
        },
    };
}

export default function askQuestionsExtension(pi: ExtensionAPI): void {
    const toolDef = {
        label: "Ask Questions",
        description:
            "Ask one to three structured questions and return keyed answers. Use for planning clarifications and tradeoff decisions.",
        parameters: AskQuestionsParams,
        execute: async (
            _toolCallId: string,
            params: { questions: AskQuestion[] },
            _signal: AbortSignal | undefined,
            _onUpdate: AgentToolUpdateCallback | undefined,
            ctx: {
                hasUI: boolean;
                ui: {
                    select: (title: string, options: string[]) => Promise<string | undefined>;
                    input: (title: string, placeholder?: string) => Promise<string | undefined>;
                };
            },
        ) => executeAskQuestions(params, ctx.hasUI, ctx.ui),
    };

    pi.registerTool({
        name: "ask_questions",
        ...toolDef,
    });

    pi.registerTool({
        name: "ask",
        ...toolDef,
    });
}

