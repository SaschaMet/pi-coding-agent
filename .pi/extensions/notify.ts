/**
 * Desktop notification extension.
 *
 * Writes an OSC 777 escape sequence when the top-level agent finishes, so the
 * terminal (cmux/Ghostty, iTerm2, WezTerm, rxvt-unicode) shows a native
 * desktop notification. No external dependencies.
 *
 * Rebuilt locally from https://github.com/mitsuhiko/agent-stuff/blob/main/extensions/notify.ts
 * with a mode guard: subagent sessions (mode "print") must not ring the bell.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
    Markdown,
    type MarkdownTheme,
    stripTerminalSequences,
} from "@earendil-works/pi-tui";
import { isShadowedProjectCopy } from "./lib/extension-helpers.ts";

const NOTIFY_REGISTERED = Symbol.for("pi.extensions.notify.registered");

const notify = (title: string, body: string): void => {
    // OSC 777 format: ESC ] 777 ; notify ; title ; body BEL
    process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
};

const isTextPart = (part: unknown): part is { type: "text"; text: string } =>
    Boolean(
        part &&
            typeof part === "object" &&
            "type" in part &&
            part.type === "text" &&
            "text" in part,
    );

const extractLastAssistantText = (
    messages: Array<{ role?: string; content?: unknown }>,
): string | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.role !== "assistant") {
            continue;
        }

        const content = message.content;
        if (typeof content === "string") {
            return content.trim() || null;
        }

        if (Array.isArray(content)) {
            const text = content
                .filter(isTextPart)
                .map((part) => part.text)
                .join("\n")
                .trim();
            return text || null;
        }

        return null;
    }

    return null;
};

const plainMarkdownTheme: MarkdownTheme = {
    heading: (text) => text,
    link: (text) => text,
    linkUrl: () => "",
    code: (text) => text,
    codeBlock: (text) => text,
    codeBlockBorder: () => "",
    quote: (text) => text,
    quoteBorder: () => "",
    hr: () => "",
    listBullet: () => "",
    bold: (text) => text,
    italic: (text) => text,
    strikethrough: (text) => text,
    underline: (text) => text,
};

const simpleMarkdown = (text: string, width = 80): string => {
    const markdown = new Markdown(text, 0, 0, plainMarkdownTheme);
    return markdown.render(width).join("\n");
};

const formatNotification = (
    text: string | null,
): { title: string; body: string } => {
    const simplified = text ? simpleMarkdown(text) : "";
    // Markdown emits OSC 8 hyperlinks. Embedding one OSC sequence inside the OSC
    // 777 notification terminates the notification early and prints its visible
    // text at the terminal cursor. Remove terminal sequences and remaining
    // control characters before constructing the outer OSC sequence.
    const normalized = stripTerminalSequences(simplified)
        .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) {
        return { title: "Ready for input", body: "" };
    }

    const maxBody = 200;
    const body =
        normalized.length > maxBody
            ? `${normalized.slice(0, maxBody - 1)}…`
            : normalized;
    return { title: "π", body };
};

export default function notifyExtension(pi: ExtensionAPI): void {
    if (isShadowedProjectCopy(import.meta.url)) return;
    const guardPi = pi as ExtensionAPI & Record<PropertyKey, unknown>;
    if (guardPi[NOTIFY_REGISTERED]) return;
    guardPi[NOTIFY_REGISTERED] = true;

    pi.on("agent_end", async (event, ctx) => {
        // Subagent sessions bind extensions in "print" mode; only the
        // interactive session should notify.
        if (ctx.mode !== "tui") return;
        const lastText = extractLastAssistantText(event.messages ?? []);
        const { title, body } = formatNotification(lastText);
        notify(title, body);
    });
}
