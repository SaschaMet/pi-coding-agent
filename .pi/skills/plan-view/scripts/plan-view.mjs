#!/usr/bin/env node
// plan-view: render a plan or spec markdown file as one offline HTML page next
// to it. Node builtins only: the skill is synced to ~/.pi/agent without
// node_modules.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

class Fail extends Error {
   constructor(code, message) {
      super(message);
      this.code = code;
   }
}

// Only these render: the page is written next to the source, and the write
// guard never sees this script's writes.
const INPUT_RE = /^docs\/(plans|specs)\/(?:[^/]+\/)?[^/]+\.md$/;

const ARCHIFY_TYPES = ["architecture", "workflow", "sequence", "dataflow", "lifecycle"];
const ASSET_RE = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.json$/;
const ARCHIFY_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------- inline

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "\u2028": "&#8232;", "\u2029": "&#8233;" };
const esc = (s) => String(s).replace(/[&<>"'\u2028\u2029]/g, (c) => ESC[c]);
const sha256 = (s) => `'sha256-${crypto.createHash("sha256").update(s, "utf8").digest("base64")}'`;

/** Browsers strip whitespace and control characters inside a scheme, so any such URL is refused. */
function isSafeHref(url) {
   if (url === "" || /[\u0000-\u0020\u007f]/.test(url)) return false;
   const scheme = url.match(/^([a-z][a-z0-9+.-]*):/i);
   return !scheme || /^https?$/i.test(scheme[1]);
}

/** Bold and italic on already-escaped text. */
function emphasis(s) {
   return s
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>")
      .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
}

function links(s) {
   let out = "";
   let last = 0;
   for (const m of s.matchAll(/(!?)\[([^\]\n]+)\]\(([^)\s]*)\)/g)) {
      out += emphasis(esc(s.slice(last, m.index)));
      // Images stay text: the CSP loads none, and only diagram lines embed content.
      const safe = !m[1] && isSafeHref(m[3]);
      out += safe ? `<a href="${esc(m[3])}">${emphasis(esc(m[2]))}</a>` : emphasis(esc(m[0]));
      last = m.index + m[0].length;
   }
   return out + emphasis(esc(s.slice(last)));
}

/** Escaped inline markdown; code spans stay literal. */
function inline(s) {
   let out = "";
   let last = 0;
   for (const m of s.matchAll(/`([^`\n]+)`/g)) {
      out += links(s.slice(last, m.index)) + `<code>${esc(m[1])}</code>`;
      last = m.index + m[0].length;
   }
   return out + links(s.slice(last));
}

// ---------------------------------------------------------------- blocks

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w+-]*)/;
const QUOTE_RE = /^\s{0,3}>/;
const DIAGRAM_RE = /^!\[([^\]\n]*)\]\(([^)\s]+\.json)\)\s*$/;
const MARKER_RE = /^\[( |x|X|wip|f)\]\s+(.*)$/;
const MARKERS = { " ": "idle", x: "done", X: "done", wip: "wip", f: "failed" };

const isBlank = (line) => /^\s*$/.test(line);
const indentOf = (line) => line.match(/^\s*/)[0].length;

function isTableStart(lines, i) {
   return /^\s*\|/.test(lines[i]) && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1] ?? "");
}

function splitRow(line) {
   const cells = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/);
   return cells.map((c) => c.trim().replace(/\\\|/g, "|"));
}

function startsBlock(lines, i) {
   const line = lines[i];
   return (
      HEADING_RE.test(line) ||
      FENCE_RE.test(line) ||
      QUOTE_RE.test(line) ||
      LIST_RE.test(line) ||
      DIAGRAM_RE.test(line) ||
      isTableStart(lines, i)
   );
}

function parseItem(text) {
   const m = text.match(MARKER_RE);
   return m ? { marker: MARKERS[m[1]], text: m[2], children: [] } : { marker: null, text, children: [] };
}

function parseList(lines, start) {
   const first = lines[start].match(LIST_RE);
   const indent = first[1].length;
   const ordered = /\d/.test(first[2]);
   const items = [];
   let i = start;
   while (i < lines.length) {
      const line = lines[i];
      const m = line.match(LIST_RE);
      if (m && m[1].length === indent && /\d/.test(m[2]) === ordered) {
         items.push(parseItem(m[3]));
         i++;
      } else if (m && m[1].length > indent) {
         const [sub, next] = parseList(lines, i);
         items.at(-1).children.push(sub);
         i = next;
      } else if (!m && !isBlank(line) && !FENCE_RE.test(line) && indentOf(line) > indent) {
         items.at(-1).text += ` ${line.trim()}`;
         i++;
      } else if (isBlank(line)) {
         let j = i;
         while (j < lines.length && isBlank(lines[j])) j++;
         const n = lines[j]?.match(LIST_RE);
         if (!n || n[1].length < indent || (n[1].length === indent && /\d/.test(n[2]) !== ordered)) break;
         i = j;
      } else {
         break;
      }
   }
   return [{ type: "list", ordered, items }, i];
}

function parseBlocks(lines) {
   const blocks = [];
   let i = 0;
   while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
         i++;
         continue;
      }
      const fence = line.match(FENCE_RE);
      if (fence) {
         const close = new RegExp(`^\\s*${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}\\s*$`);
         const indent = indentOf(line);
         const body = [];
         i++;
         while (i < lines.length && !close.test(lines[i])) {
            body.push(lines[i].replace(new RegExp(`^[ \\t]{0,${indent}}`), ""));
            i++;
         }
         i++;
         blocks.push({ type: "code", lang: fence[2], text: body.join("\n") });
         continue;
      }
      const h = line.match(HEADING_RE);
      if (h) {
         blocks.push({ type: "heading", level: h[1].length, text: h[2] });
         i++;
         continue;
      }
      if (QUOTE_RE.test(line)) {
         const inner = [];
         while (i < lines.length && QUOTE_RE.test(lines[i])) inner.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
         blocks.push({ type: "quote", blocks: parseBlocks(inner) });
         continue;
      }
      if (isTableStart(lines, i)) {
         const head = splitRow(line);
         const rows = [];
         i += 2;
         while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
         blocks.push({ type: "table", head, rows });
         continue;
      }
      if (LIST_RE.test(line)) {
         const [list, next] = parseList(lines, i);
         blocks.push(list);
         i = next;
         continue;
      }
      const diagram = line.match(DIAGRAM_RE);
      if (diagram) {
         blocks.push({ type: "diagram", caption: diagram[1], ref: diagram[2] });
         i++;
         continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
         blocks.push({ type: "hr" });
         i++;
         continue;
      }
      const para = [line.trim()];
      i++;
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) para.push(lines[i++].trim());
      blocks.push({ type: "para", text: para.join(" ") });
   }
   return blocks;
}

/** Every heading gets done/total over the markers in its section, nested sections included. */
function countMarkers(blocks) {
   const open = [];
   const visit = (list) => {
      for (const item of list.items) {
         if (item.marker) {
            for (const h of open) {
               h.count.total++;
               if (item.marker === "done") h.count.done++;
            }
         }
         item.children.forEach(visit);
      }
   };
   for (const b of blocks) {
      if (b.type === "heading") {
         while (open.length && open.at(-1).level >= b.level) open.pop();
         b.count = { done: 0, total: 0 };
         open.push(b);
      } else if (b.type === "list") {
         visit(b);
      }
   }
}

// ---------------------------------------------------------------- HTML

function slugger() {
   const seen = new Map();
   return (text) => {
      const base =
         text
            .toLowerCase()
            .replace(/[`*_[\]()]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "section";
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n ? `${base}-${n}` : base;
   };
}

function renderList(list) {
   const tag = list.ordered ? "ol" : "ul";
   const items = list.items.map((item) => {
      const chip = item.marker ? `<span class="chip ${item.marker}">${item.marker}</span> ` : "";
      const cls = item.marker ? ` class="task ${item.marker}"` : "";
      return `<li${cls}>${chip}${inline(item.text)}${item.children.map(renderList).join("")}</li>`;
   });
   return `<${tag}>${items.join("")}</${tag}>`;
}

function renderHeading(b, slug, extra = "") {
   const count = b.count?.total ? ` <span class="count">${b.count.done}/${b.count.total}</span>` : "";
   return `<h${b.level} id="${slug(b.text)}">${inline(b.text)}${count}${extra}</h${b.level}>`;
}

// Block spans carry the line breaks, so the lines join without "\n".
function diffLines(text) {
   if (!text) return "";
   return text
      .split("\n")
      .map((line) => {
         const cls = /^(@@|\+\+\+|---)/.test(line) ? "d-hunk" : line[0] === "+" ? "d-add" : line[0] === "-" ? "d-del" : "d-ctx";
         return `<span class="${cls}">${esc(line)}</span>`;
      })
      .join("");
}

function renderBlocks(blocks, slug) {
   return blocks
      .map((b) => {
         switch (b.type) {
            case "heading":
               return renderHeading(b, slug);
            case "para":
               return `<p>${inline(b.text)}</p>`;
            case "code":
               return `<pre><code${b.lang ? ` class="lang-${esc(b.lang)}"` : ""}>${b.lang === "diff" ? diffLines(b.text) : esc(b.text)}</code></pre>`;
            case "quote":
               return `<blockquote>${renderBlocks(b.blocks, slug)}</blockquote>`;
            case "list":
               return renderList(b);
            case "table": {
               const head = b.head.map((c) => `<th>${inline(c)}</th>`).join("");
               const rows = b.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`);
               return `<table><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
            }
            case "hr":
               return "<hr>";
            case "diagram":
               return `<figure class="diagram"><iframe sandbox="allow-scripts" src="${esc(b.src)}" title="${esc(b.caption)}" loading="lazy"></iframe><figcaption>${inline(b.caption)}</figcaption></figure>`;
            default:
               return "";
         }
      })
      .join("\n");
}

// ---------------------------------------------------------------- sections

const NOTE_ROLES = new Set(["planner", "griller", "implementer", "reviewer", "worker"]);
const NOTE_TYPES = ["context", "decision", "gotcha", "dead-end", "handoff"];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

const FILTER_JS = `document.getElementById("note-filter").addEventListener("change", (e) => {
  for (const li of document.querySelectorAll("li.note")) li.hidden = e.target.value !== "" && li.dataset.type !== e.target.value;
});`;

const sectionName = (text) => text.replace(/^\d+(\.\d+)*\.?\s+/, "").trim();

function splitSections(blocks) {
   const sections = [{ heading: null, blocks: [] }];
   for (const b of blocks) {
      if (b.type === "heading" && b.level <= 2) sections.push({ heading: b, blocks: [] });
      else sections.at(-1).blocks.push(b);
   }
   return sections;
}

function parseNoteHeader(text) {
   const parts = text.split(/\s+·\s+/);
   if (parts.length !== 5) return { error: "the header needs 5 fields: time · agent · session · role · type" };
   const [time, agent, session, role, type] = parts;
   if (!ISO_RE.test(time) || Number.isNaN(Date.parse(time))) return { error: `"${time}" is not an ISO-8601 time` };
   if (!NOTE_ROLES.has(role)) return { error: `unknown role "${role}"` };
   if (!NOTE_TYPES.includes(type)) return { error: `unknown type "${type}"` };
   return { time, agent, session, role, type };
}

function renderNotes(section, ctx) {
   const intro = [];
   const entries = [];
   for (const b of section.blocks) {
      if (b.type === "heading" && b.level === 3) entries.push({ header: b.text, blocks: [] });
      else if (entries.length) entries.at(-1).blocks.push(b);
      else intro.push(b);
   }
   const out = [`<section class="ai-notes">`, renderHeading(section.heading, ctx.slug), renderBlocks(intro, ctx.slug)];
   if (entries.length) {
      const agents = new Set();
      const sessions = new Set();
      const items = entries.map((e) => {
         const note = parseNoteHeader(e.header);
         const body = renderBlocks(e.blocks, ctx.slug);
         if (note.error) {
            ctx.warn(`AI-Notes entry "${e.header}" is unparsed: ${note.error}`);
            return `<li class="note unparsed" data-type="unparsed"><div class="note-head"><span class="type unparsed">unparsed</span> ${inline(e.header)}</div>${body}</li>`;
         }
         agents.add(note.agent);
         if (note.session !== "unknown") sessions.add(note.session);
         const who = [note.agent, note.session, note.role].map(esc).join(" · ");
         return `<li class="note" data-type="${note.type}"><div class="note-head"><time datetime="${esc(note.time)}">${esc(note.time)}</time> <span class="type ${note.type}">${note.type}</span> ${who}</div>${body}</li>`;
      });
      const list = (set) => [...set].map((v) => `<code>${esc(v)}</code>`).join(", ") || "none";
      const options = ["", ...NOTE_TYPES, "unparsed"].map((t) => `<option value="${t}">${t || "all"}</option>`);
      out.push(
         `<p class="note-people">Agents: ${list(agents)} · Sessions: ${list(sessions)}</p>`,
         `<p class="note-filter"><label>Type <select id="note-filter">${options.join("")}</select></label></p>`,
         `<ol class="timeline">\n${items.join("\n")}\n</ol>`,
      );
      ctx.scripts.push(FILTER_JS);
   }
   out.push("</section>");
   return out.join("\n");
}

/** The latest row decides, as the implementation gate does. */
function grillBadge(blocks) {
   const status = blocks.findLast((b) => b.type === "table")?.rows.at(-1)?.at(-1) ?? "";
   const ready = /^(done|overridden)\s+\d{4}-\d{2}-\d{2}/i.test(status);
   return ready ? ` <span class="badge ready">ready</span>` : ` <span class="badge blocked">blocked</span>`;
}

function renderSection(section, ctx) {
   const name = section.heading?.level === 2 ? sectionName(section.heading.text) : "";
   const body = renderBlocks(section.blocks, ctx.slug);
   if (name === "AI-Notes") return renderNotes(section, ctx);
   if (name === "Metadata") {
      return `<details class="metadata"><summary>${renderHeading(section.heading, ctx.slug)}</summary>\n${body}\n</details>`;
   }
   const badge = name === "Grill Status" ? grillBadge(section.blocks) : "";
   return [section.heading ? renderHeading(section.heading, ctx.slug, badge) : "", body].join("\n");
}

const PAGE_CSS = `
:root { --bg: #fff; --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --code: #f6f8fa; --link: #0969da;
  --idle: #6e7781; --wip: #bf8700; --done: #1a7f37; --failed: #cf222e; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #3d444d; --code: #151b23; --link: #4493f8;
    --idle: #9198a1; --wip: #d29922; --done: #3fb950; --failed: #f85149; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 24px 20px 64px; }
a { color: var(--link); }
h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 0.6em; }
h1 { font-size: 1.9em; margin-top: 0.4em; }
h2 { font-size: 1.45em; border-bottom: 1px solid var(--line); padding-bottom: 0.25em; }
code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--code); padding: 0.1em 0.3em; border-radius: 4px; }
pre { background: var(--code); padding: 12px; border-radius: 6px; overflow-x: auto; }
pre code { padding: 0; background: none; }
.d-add, .d-del, .d-hunk, .d-ctx { display: block; }
.d-add { background: color-mix(in srgb, var(--done) 18%, transparent); }
.d-del { background: color-mix(in srgb, var(--failed) 18%, transparent); }
.d-hunk { color: var(--muted); }
blockquote { margin: 1em 0; padding: 0 1em; color: var(--muted); border-left: 4px solid var(--line); }
table { border-collapse: collapse; margin: 1em 0; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
li { margin: 0.2em 0; }
li.task { list-style: none; margin-left: -1.2em; }
.chip { display: inline-block; min-width: 3.6em; text-align: center; font-size: 0.75em; font-weight: 600; text-transform: uppercase;
  border-radius: 999px; padding: 0 0.6em; color: var(--bg); }
.chip.idle { background: var(--idle); } .chip.wip { background: var(--wip); }
.chip.done { background: var(--done); } .chip.failed { background: var(--failed); }
.count { font-size: 0.7em; font-weight: 600; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0 0.5em; vertical-align: middle; }
.badge { font-size: 0.6em; font-weight: 600; text-transform: uppercase; border-radius: 4px; padding: 0.1em 0.5em; vertical-align: middle; color: var(--bg); }
.badge.ready { background: var(--done); } .badge.blocked { background: var(--failed); }
details.metadata summary { cursor: pointer; } details.metadata summary h2 { display: inline; border: 0; }
.timeline { list-style: none; padding-left: 0; border-left: 2px solid var(--line); }
.note { margin: 0 0 12px; padding: 4px 0 4px 14px; }
.note-head { font-size: 0.85em; color: var(--muted); }
.type { font-weight: 600; text-transform: uppercase; font-size: 0.85em; color: var(--fg); }
.type.gotcha, .type.dead-end, .type.unparsed { color: var(--failed); } .type.decision { color: var(--done); } .type.handoff { color: var(--wip); }
.diagram { margin: 1.2em 0; } .diagram iframe { width: 100%; height: 640px; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
.diagram figcaption { font-size: 0.85em; color: var(--muted); margin-top: 4px; }
.doc-meta { font-size: 0.8em; color: var(--muted); border-bottom: 1px solid var(--line); padding-bottom: 8px; word-break: break-all; }
`;

export function buildPage({ blocks, source, rel, renderedAt, warn = () => {} }) {
   countMarkers(blocks);
   const title = blocks.find((b) => b.type === "heading" && b.level === 1)?.text ?? path.basename(rel);
   const scripts = [];
   const ctx = { slug: slugger(), scripts, warn };
   const body = splitSections(blocks).map((s) => renderSection(s, ctx)).join("\n");
   const csp = [
      "default-src 'none'",
      `script-src ${scripts.length ? scripts.map(sha256).join(" ") : "'none'"}`,
      "style-src 'unsafe-inline'",
      "frame-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
   ].join("; ");
   const hash = crypto.createHash("sha256").update(source, "utf8").digest("hex");
   return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · plan-view</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<header class="doc-meta">Source <code>${esc(rel)}</code> · sha256 <code>${hash}</code> · rendered <time datetime="${renderedAt}">${renderedAt}</time> · generated, edit the .md instead</header>
${body}
</main>
${scripts.map((s) => `<script>${s}</script>`).join("\n")}
</body>
</html>
`;
}

// ---------------------------------------------------------------- I/O

function resolveInput(arg) {
   const cwd = fs.realpathSync(process.cwd());
   let real;
   try {
      real = fs.realpathSync(path.resolve(cwd, arg));
   } catch {
      throw new Fail(2, `${arg}: no such file`);
   }
   const rel = path.relative(cwd, real).split(path.sep).join("/");
   if (!INPUT_RE.test(rel) || !fs.statSync(real).isFile()) {
      throw new Fail(2, `${arg}: only docs/{plans,specs}/[<name>/]*.md under the working directory can be rendered`);
   }
   return { real, rel };
}

function archifyBin() {
   // Same layout in the project (.pi) and the global runtime (~/.pi/agent).
   const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
   const bin = path.join(here, "..", "..", "..", "skill-library", "archify", "bin", "archify.mjs");
   if (!fs.existsSync(bin)) throw new Fail(2, `archify not found at ${bin}`);
   return bin;
}

function archify(bin, args) {
   const res = spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", timeout: ARCHIFY_TIMEOUT_MS });
   if (res.error) return `archify ${args[0]} failed: ${res.error.message}`;
   if (res.status !== 0) return `archify ${args[0]} failed:\n${(res.stderr || res.stdout).trim()}`;
   return null;
}

function diagramBlocks(blocks) {
   return blocks.flatMap((b) => (b.type === "diagram" ? [b] : b.type === "quote" ? diagramBlocks(b.blocks) : []));
}

/**
 * Checks every reference before archify writes anything, and renders to temp
 * files, so a bad reference never leaves a half-updated page. Returns the
 * renames the caller applies once the page is built.
 */
function renderDiagrams(blocks, docReal) {
   const diagrams = diagramBlocks(blocks);
   if (!diagrams.length) return [];
   const docDir = path.dirname(docReal);
   const base = path.basename(docReal, ".md");
   const assetsDir = path.join(docDir, `${base}.assets`);
   const errors = [];
   const jobs = [];
   const ids = new Set();
   for (const d of diagrams) {
      const fail = (why) => errors.push(`  - ${d.ref}: ${why}`);
      const file = path.resolve(docDir, d.ref);
      const name = path.basename(file).match(ASSET_RE);
      if (path.dirname(file) !== assetsDir) fail(`must be a file directly inside ${base}.assets/`);
      else if (!name || !ARCHIFY_TYPES.includes(name[2])) fail(`name must be <id>.<type>.json, type one of ${ARCHIFY_TYPES.join(", ")}`);
      else if (!fs.existsSync(file)) fail("file not found");
      else if (fs.realpathSync(assetsDir) !== assetsDir || path.dirname(fs.realpathSync(file)) !== assetsDir) {
         fail(`resolves outside ${base}.assets/`);
      } else if (ids.has(name[1])) fail(`id "${name[1]}" is used by another diagram`);
      else {
         ids.add(name[1]);
         jobs.push({ d, file, id: name[1], type: name[2] });
      }
   }
   const bin = jobs.length ? archifyBin() : null;
   for (const job of jobs) {
      const err = archify(bin, ["validate", job.type, job.file]);
      if (err) errors.push(`  - ${job.d.ref}: ${err.replace(/\n/g, "\n    ")}`);
   }
   if (errors.length) throw new Fail(2, `diagram references are invalid:\n${errors.join("\n")}`);

   const renames = jobs.map((job) => ({
      job,
      tmp: path.join(assetsDir, `.${job.id}.${process.pid}.tmp.html`),
      out: path.join(assetsDir, `${job.id}.html`),
   }));
   try {
      for (const { job, tmp } of renames) {
         fs.rmSync(tmp, { force: true });
         const err = archify(bin, ["render", job.type, job.file, tmp]);
         if (err) throw new Fail(2, `  - ${job.d.ref}: ${err}`);
         job.d.src = [`${base}.assets`, `${job.id}.html`].map(encodeURIComponent).join("/");
      }
   } catch (err) {
      for (const { tmp } of renames) fs.rmSync(tmp, { force: true });
      throw err;
   }
   return renames;
}

/** A temp file plus rename never follows a symlink planted at the output path. */
function writeAtomic(file, contents) {
   const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
   try {
      fs.writeFileSync(tmp, contents, { flag: "wx" });
      fs.renameSync(tmp, file);
   } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
   }
}

function openInBrowser(file) {
   const opener = process.platform === "darwin" ? "open" : "xdg-open";
   const res = spawnSync(opener, [file], { stdio: "ignore" });
   if (res.error || res.status !== 0) {
      process.stderr.write(`warning: could not open the page with ${opener}; open it by hand\n`);
   }
}

function render(opts) {
   if (!opts.doc) throw new Fail(2, USAGE);
   const { real, rel } = resolveInput(opts.doc);
   const source = fs.readFileSync(real, "utf8");
   const blocks = parseBlocks(source.split(/\r?\n/));
   const renames = renderDiagrams(blocks, real);
   const warn = (message) => process.stderr.write(`warning: ${message}\n`);
   const page = buildPage({ blocks, source, rel, renderedAt: new Date().toISOString(), warn });
   for (const { tmp, out } of renames) fs.renameSync(tmp, out);
   const out = real.replace(/\.md$/, ".html");
   writeAtomic(out, page);
   process.stdout.write(`${out}\n`);
   if (!opts.noOpen) openInBrowser(out);
}

// ---------------------------------------------------------------- CLI

const USAGE = "usage: plan-view.mjs render <docs/plans/*.md | docs/specs/*.md> [--no-open]";

function parseArgs(argv) {
   const [command, ...rest] = argv;
   const opts = {};
   for (const arg of rest) {
      if (arg === "--no-open") opts.noOpen = true;
      else if (arg.startsWith("-") || opts.doc) throw new Fail(2, `unknown argument: ${arg}`);
      else opts.doc = arg;
   }
   return { command, opts };
}

function main() {
   try {
      const { command, opts } = parseArgs(process.argv.slice(2));
      if (command === "render") render(opts);
      else throw new Fail(2, USAGE);
   } catch (err) {
      if (err instanceof Fail) {
         process.stderr.write(`${err.message}\n`);
         process.exitCode = err.code;
         return;
      }
      throw err;
   }
}

main();
