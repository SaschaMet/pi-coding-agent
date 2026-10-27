#!/usr/bin/env node
// Mechanical slop check for English and German prose. No dependencies.
import fs from "node:fs";

const USAGE = `Usage: node slop-check.mjs --lang en|de [<file> | --stdin]

Checks prose for AI-slop patterns.
  ✗ hard hit: a phrase formula with almost no honest use. Fails the check.
  ~ advisory: a pattern with honest uses. Read the line and decide.

Skips fenced code, inline code, HTML comments, and image lines.
Matches one line at a time: a phrase wrapped across two lines is not seen.
Mixed-language text: run once per language.

Exit codes: 0 CLEAN (advisory hits allowed), 1 hard hit, 2 usage error.`;

const LANGS = ["en", "de"];
// Enough lines to locate a pattern without flooding the agent's context.
const MAX_HITS_PER_RULE = 6;

// JS \b treats ä/ö/ü/ß as non-word characters, so German words at an umlaut edge would be missed.
const words = (alternatives, flags = "iu") =>
    new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, flags);

const DASH = { id: "dash", re: /[—–]/u, hard: false };
const BANG = { id: "exclamation mark", re: /!/u, hard: false };

// hard: true fails the check; false is a reading prompt, because a regex cannot tell a real correction from a reveal.
const RULES = {
    en: [
        { id: "S4 stock opener", hard: true, re: words(
            "here[’']s the thing|let[’']s dive in(?:to)?|the truth is|in today[’']s [\\p{L}-]+ world|at the end of the day|without further ado|buckle up|spoiler alert|here[’']s the kicker") },
        { id: "S5 question then own answer", hard: true, re: words(
            "(?:[Tt]he (?:result|answer|reason|catch|kicker|best part|twist)|[Ww]hy|[Ss]o what)\\?(?= +\\p{Lu})", "u") },
        { id: "S16 meta-discourse", hard: true, re: words(
            "as we[’']ll see|let me explain|it[’']s worth noting(?: that)?|it is worth noting|it(?:[’']s| is) important to (?:note|understand|remember)|as (?:mentioned|noted) (?:earlier|above)|let[’']s (?:unpack|explore) (?:this|that)|in this (?:post|article),? (?:we|i)[’']ll") },
        { id: "sycophancy opener", hard: true, re: words(
            "great question|i hope this (?:email |message |note )?finds you well|i hope this helps|i[’']d be happy to help") },
        DASH,
        BANG,
        { id: "S1 contrast?", hard: false, re: new RegExp(`${words(
            "not (?:just|only)|(?:it[’']s|it is|this is|that[’']s|isn[’']t) not (?:about|just)|isn[’']t (?:just|about)").source}|, not \\p{L}[^,.;]{0,40}\\.`, "iu") },
        { id: "S2 colon reveal?", hard: false, re: /[a-z)] ?: [\p{L}0-9]/u },
        { id: "S13 slop word", hard: false, re: words(
            "delve|tapestry|testament|leverag\\w*|seamless\\w*|robust|unlock\\w*|empower\\w*|game[- ]changer|transformative|elevate\\w*|realm|landscape|synergy|cutting[- ]edge|pivotal|crucial|vibrant|holistic|moving forward") },
        { id: "S15 hedge", hard: false, re: words("very|really|actually|basically|essentially|truly|quite|arguably|generally|practically|virtually|particularly") },
        { id: "S22 engagement bait", hard: false, re: words(
            "what[’']s your take|what do you think\\?|thoughts\\?|let me know your thoughts|drop a comment|agree\\?") },
        { id: "compression phrase", hard: false, re: words(
            "in order to|due to the fact that|at this point in time|in terms of|for the purpose of|a number of|is able to|make a decision|each and every|first and foremost|end result|past experience|future plans|any and all|fully and completely|true and accurate|free gift|in the event that|despite the fact that|in size|in shape|in nature") },
    ],
    de: [
        { id: "S4 stock opener", hard: true, re: words(
            "die wahrheit ist|kurz gesagt|darüber spricht niemand|stell dir vor|am ende des tages") },
        // Labels and reveals with honest uses ("Fazit: Der Cache ist kalt."), so only a reading prompt.
        { id: "S2/S3 reveal?", hard: false, re: words("mein ergebnis|fazit|und genau das ist|das beste daran|der clou") },
        { id: "S5 question then own answer", hard: true, re: words(
            "(?:[Dd]as Ergebnis|[Dd]er Grund|[Dd]ie Lösung|[Dd]ie Antwort|[Dd]er Haken|[Ww]arum|[Ww]as das heißt)\\?(?= +\\p{Lu})", "u") },
        { id: "S16 meta-discourse", hard: true, re: words(
            "wie du gleich siehst|im folgenden|lass mich (?:dir )?(?:erklären|kurz)|es ist wichtig zu (?:beachten|verstehen|wissen)|kurz vorweg|wie bereits erwähnt") },
        { id: "sycophancy opener", hard: true, re: words(
            "gute frage|ich hoffe, (?:diese|die) (?:mail|nachricht) erreicht dich|ich hoffe, das hilft") },
        DASH,
        BANG,
        { id: "straight quotes", hard: false, re: /["”]/u },
        { id: "S1 contrast?", hard: false, re: /(?<![\p{L}\p{N}_])sondern(?![\p{L}\p{N}_])|, (?:nicht|kein\p{L}*) [^,.;„]{1,40}\./u },
        { id: "S2 colon reveal?", hard: false, re: /[a-zäöüß)] ?: [\p{L}0-9]/u },
        { id: "S6 fragment?", hard: false, re: /(?:^|[.?] )\p{Lu}[^ .?:]*(?: [^ .?:]+){0,2}(?<!\d)\.(?: |$)/u },
        { id: "S13 abstract word", hard: false, re: words(
            "klarheit|potenzial|mehrwert|hebel|nahtlos\\p{L}*|essenziell\\p{L}*|spannend\\p{L}*|ganzheitlich\\p{L}*|maßgeschneidert\\p{L}*|innovativ\\p{L}*|optimier\\p{L}*|verbesser\\p{L}*") },
        { id: "S15 hedge", hard: false, re: words(
            "sehr|vor allem|im grunde|eher|wirklich|durchaus|ziemlich|äußerst|eigentlich|quasi|irgendwie") },
        { id: "compression phrase", hard: false, re: words(
            "der tatsache, dass|für den fall, dass|in bezug auf|hinsichtlich|bezüglich|zum jetzigen zeitpunkt|zur verfügung stell\\p{L}*|in der lage|im rahmen (?:des|der|von)|entscheidung treffen|vornehmen|voll und ganz|einzig und allein|art und weise|sinn und zweck") },
    ],
};

function fail(message) {
    process.stderr.write(`slop-check: ${message}\n`);
    process.exit(2);
}

function parseArgs(argv) {
    const args = { lang: undefined, stdin: false, file: undefined };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            process.stdout.write(`${USAGE}\n`);
            process.exit(0);
        } else if (arg === "--lang") {
            args.lang = argv[++i];
        } else if (arg.startsWith("--lang=")) {
            args.lang = arg.slice("--lang=".length);
        } else if (arg === "--stdin") {
            args.stdin = true;
        } else if (arg.startsWith("-")) {
            fail(`unknown option "${arg}" (run --help)`);
        } else if (args.file) {
            fail("pass one file only");
        } else {
            args.file = arg;
        }
    }
    if (!args.lang) fail(`--lang is required (accepted: ${LANGS.join(", ")})`);
    if (!LANGS.includes(args.lang)) fail(`unknown --lang "${args.lang}" (accepted: ${LANGS.join(", ")})`);
    if (args.stdin === Boolean(args.file)) fail("pass either <file> or --stdin");
    return args;
}

// Blank out text that is not prose, keeping line numbers stable.
function proseLines(text) {
    const blank = (match) => match.replace(/[^\n]/g, "");
    const cleaned = text
        .replace(/<!--[\s\S]*?-->/g, blank)
        .replace(/^[ \t]*(```|~~~)[^\n]*\n[\s\S]*?^[ \t]*\1[^\n]*$/gm, blank)
        .replace(/`[^`\n]+`/g, "");
    return cleaned.split("\n").map((line) => (/^\s*!\[/.test(line) ? "" : line.replace(/^\s*#+\s*/, "").trim()));
}

function check(text, lang) {
    const lines = proseLines(text);
    const results = [];
    for (const rule of RULES[lang]) {
        const hits = [];
        lines.forEach((line, index) => {
            const match = rule.re.exec(line);
            if (match) hits.push({ line: index + 1, snippet: line.slice(Math.max(0, match.index - 40), match.index + 50) });
        });
        if (hits.length) results.push({ rule, hits });
    }
    return results;
}

const args = parseArgs(process.argv.slice(2));
let text;
try {
    text = args.stdin ? fs.readFileSync(0, "utf8") : fs.readFileSync(args.file, "utf8");
} catch (error) {
    fail(`cannot read ${args.stdin ? "stdin" : args.file}: ${error.message}`);
}

// Decomposed umlauts (u + U+0308) never match the composed letters in the rules.
const results = check(text.normalize("NFC"), args.lang);
let hard = 0;
for (const { rule, hits } of results) {
    if (rule.hard) hard++;
    process.stdout.write(`${rule.hard ? "✗" : "~"} ${rule.id}\n`);
    for (const hit of hits.slice(0, MAX_HITS_PER_RULE)) process.stdout.write(`    L${hit.line}: …${hit.snippet}…\n`);
    if (hits.length > MAX_HITS_PER_RULE) process.stdout.write(`    (+${hits.length - MAX_HITS_PER_RULE} more)\n`);
}
process.stdout.write(hard ? `FAILING: ${hard}\n` : "CLEAN\n");
process.exit(hard ? 1 : 0);
