/**
 * Parses the `Scope` section of a spec into write-boundary lists, and matches paths
 * against those lists. Pure: no `pi`, no events, no filesystem.
 *
 * The accepted markdown shape is the contract of
 * `.pi/skills/create-spec/references/spec-template.md`. Changing the template's Scope
 * section without changing this parser silently changes what the write guard allows.
 */

/** List items that carry no real path. */
const PLACEHOLDER_ENTRIES = new Set([
    "...",
    "none",
    "n/a",
    "na",
    "tbd",
    "path/to/file",
    "path/or/area",
    "service-or-api",
]);

export type ScopeLists = { modify: string[]; forbid: string[] };

export type ScopeParseResult = { lists: ScopeLists } | { error: string };

/** Extracts a path from a markdown list item, dropping backticks and trailing prose. */
function parseListEntry(line: string): string | undefined {
    const withoutBullet = line.replace(/^\s*[-*]\s+/, "").trim();
    if (withoutBullet.length === 0) return undefined;

    const backticked = withoutBullet.match(/`([^`]+)`/);
    const candidate = (backticked ? backticked[1] : withoutBullet.split(/\s+/)[0]).trim();
    if (candidate.length === 0) return undefined;
    if (PLACEHOLDER_ENTRIES.has(candidate.toLowerCase())) return undefined;
    return candidate;
}

/** Isolates the `## N. Scope` section body. */
function extractScopeSection(specText: string): string | undefined {
    const lines = specText.split("\n");
    const headingIndex = lines.findIndex((line) => /^#{1,6}\s*(?:\d+\.\s*)?Scope\s*$/i.test(line.trim()));
    if (headingIndex < 0) return undefined;

    const headingDepth = (lines[headingIndex].match(/^#+/) ?? ["##"])[0].length;
    const body: string[] = [];
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        const nextHeading = line.match(/^(#+)\s/);
        if (nextHeading && nextHeading[1].length <= headingDepth) break;
        body.push(line);
    }
    return body.join("\n");
}

/** Collects entries under a `**Label:**` block inside the scope section. */
function extractLabelledList(scopeSection: string, label: string): string[] {
    const lines = scopeSection.split("\n");
    const labelPattern = new RegExp(`^\\s*\\*{0,2}${label}\\*{0,2}\\s*:?\\s*\\*{0,2}\\s*$`, "i");
    const anyLabelPattern = /^\s*\*\*[^*]+\*\*\s*:?\s*$/;

    const startIndex = lines.findIndex((line) => labelPattern.test(line.trim()));
    if (startIndex < 0) return [];

    const entries: string[] = [];
    for (let index = startIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim().length === 0) continue;
        if (anyLabelPattern.test(line)) break;
        if (!/^\s*[-*]\s+/.test(line)) {
            if (entries.length > 0) break;
            continue;
        }
        const entry = parseListEntry(line);
        if (entry) entries.push(entry);
    }
    return entries;
}

export function parseScopeSection(specText: string): ScopeParseResult {
    const scopeSection = extractScopeSection(specText);
    if (scopeSection === undefined) return { error: "no 'Scope' section found" };

    const modify = extractLabelledList(scopeSection, "Modify");
    if (modify.length === 0) {
        return { error: "no usable 'Modify' entries in the Scope section (only placeholders?)" };
    }

    return { lists: { modify, forbid: extractLabelledList(scopeSection, "Forbid") } };
}

function normalizePattern(pattern: string): string {
    let normalized = pattern.trim().split("\\").join("/");
    if (normalized.startsWith("./")) normalized = normalized.slice(2);
    if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
    return normalized;
}

/** Escapes regex metacharacters, then maps the glob wildcards that stay inside one segment. */
function segmentToRegExp(segment: string): string {
    return segment
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]");
}

// `**` spans zero or more path segments, so `src/**/*.ts` matches `src/index.ts` as well as
// `src/a/b.ts`. Treating it as "at least one separator" would reject paths the spec author
// plainly scoped in.
function globToRegExp(pattern: string): RegExp {
    const segments = pattern.split("/");
    let source = "^";

    segments.forEach((segment, index) => {
        const isLast = index === segments.length - 1;
        if (segment === "**") {
            source += isLast ? "(?:[^/]+(?:/[^/]+)*)?" : "(?:[^/]+/)*";
            return;
        }
        source += segmentToRegExp(segment);
        if (!isLast) source += "/";
    });

    return new RegExp(`${source}$`);
}

export function matchesPattern(relativePath: string, rawPattern: string): boolean {
    const pattern = normalizePattern(rawPattern);
    if (pattern.length === 0) return false;
    if (relativePath === pattern) return true;

    // A pattern without wildcards names a file or a directory prefix.
    if (!pattern.includes("*") && !pattern.includes("?")) {
        return relativePath.startsWith(`${pattern}/`);
    }

    try {
        return globToRegExp(pattern).test(relativePath);
    } catch {
        // An uncompilable pattern must never widen the boundary.
        return false;
    }
}

export function matchesAny(relativePath: string, patterns: string[]): boolean {
    return patterns.some((pattern) => matchesPattern(relativePath, pattern));
}
