/**
 * Pure check behind the degenerate-output extension: is a final assistant reply
 * unreadable model output? No `pi`, no events, no filesystem.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";

const TEMPLATE_LEAK = /<\|im_(?:start|end)\|>|<\|endoftext\|>|<\/parameter\b|<tool_call>/;
const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;

export type DegenerateReason = "template-leak" | "empty";

/** Judges a final reply only: replies with tool calls, errors, and aborts are handled elsewhere. */
export function judgeReply(message: AssistantMessage): DegenerateReason | undefined {
    if (message.stopReason !== "stop") return undefined;
    if (message.content.some((part) => part.type === "toolCall")) return undefined;
    const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
    const thinking = message.content.map((part) => (part.type === "thinking" ? part.thinking : "")).join("");
    // A reply that explains the markers quotes them in code; that is not a leak.
    const prose = `${thinking}\n${text}`.replace(FENCED_CODE, "").replace(INLINE_CODE, "");
    if (TEMPLATE_LEAK.test(prose)) return "template-leak";
    if (text.trim().length === 0) return "empty";
    return undefined;
}
