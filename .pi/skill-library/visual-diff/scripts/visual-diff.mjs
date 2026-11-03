#!/usr/bin/env node
// visual-diff: collect a change set, then render it with a model-written
// narrative as one offline HTML page. Node builtins and ../vendor only: the
// skill is synced to ~/.pi/agent without node_modules.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const VENDOR_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor");

const MAX_DIFF_BYTES = 1024 * 1024;
const TOO_LARGE = "diff too large; narrow with --path";
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const BINARY_SNIFF_BYTES = 8000;

// Matched against each path's basename, case-insensitive. Kept only in this
// file: a hook blocks shell commands that spell out the env dotfile name.
const SECRET_GLOBS = [
   ".env",
   ".env.*",
   "*.pem",
   "*.key",
   "*.p12",
   "*.pfx",
   "id_rsa*",
   "id_ed25519*",
   "id_ecdsa*",
   ".npmrc",
   ".netrc",
   ".pypirc",
   "auth.json",
   "credentials*",
   "secrets.*",
];
const SECRET_RES = SECRET_GLOBS.map(
   (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i"),
);

const LOCKFILES = new Set([
   "package-lock.json",
   "npm-shrinkwrap.json",
   "pnpm-lock.yaml",
   "yarn.lock",
   "bun.lockb",
   "cargo.lock",
   "poetry.lock",
   "pipfile.lock",
   "gemfile.lock",
   "composer.lock",
   "go.sum",
]);
const GENERATED_DIRS = new Set(["dist", "build", "vendor"]);

class Fail extends Error {
   constructor(code, message) {
      super(message);
      this.code = code;
   }
}

// ---------------------------------------------------------------- pure helpers

export function isSecretPath(p) {
   const base = path.posix.basename(p);
   return SECRET_RES.some((re) => re.test(base));
}

export function isGeneratedPath(p) {
   const parts = p.split("/");
   const base = parts[parts.length - 1].toLowerCase();
   if (LOCKFILES.has(base) || /\.min\.(js|css)$/.test(base)) return true;
   return parts.slice(0, -1).some((seg) => GENERATED_DIRS.has(seg));
}

const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** Decode a git C-quoted token starting at s[i] === '"'. Returns [value, nextIndex]. */
function decodeQuoted(s, i) {
   const bytes = [];
   let j = i + 1;
   while (j < s.length && s[j] !== '"') {
      if (s[j] === "\\") {
         const next = s[j + 1];
         if (/[0-7]/.test(next ?? "")) {
            bytes.push(parseInt(s.slice(j + 1, j + 4), 8));
            j += 4;
            continue;
         }
         if (next in C_ESCAPES) {
            bytes.push(C_ESCAPES[next]);
            j += 2;
            continue;
         }
         return null;
      }
      const cp = s.codePointAt(j);
      const ch = String.fromCodePoint(cp);
      bytes.push(...Buffer.from(ch, "utf8"));
      j += ch.length;
   }
   if (s[j] !== '"') return null;
   return [Buffer.from(bytes).toString("utf8"), j + 1];
}

function stripPrefix(p) {
   if (p === "/dev/null") return null;
   return p.replace(/^[ab]\//, "");
}

/** A path value after a keyword ("--- ", "rename from "), quoted or plain. */
function parsePathValue(v) {
   if (v.startsWith('"')) {
      const r = decodeQuoted(v, 0);
      return r ? r[0] : undefined;
   }
   return v.replace(/\t$/, "");
}

function parseHeaderPaths(rest) {
   if (rest.startsWith('"')) {
      const a = decodeQuoted(rest, 0);
      if (!a || rest[a[1]] !== " ") return null;
      const tail = rest.slice(a[1] + 1);
      const b = tail.startsWith('"') ? decodeQuoted(tail, 0)?.[0] : tail;
      return b == null ? null : [a[0], b];
   }
   const q = rest.indexOf(' "b/');
   if (q !== -1) {
      const b = decodeQuoted(rest, q + 1);
      return b ? [rest.slice(0, q), b[0]] : null;
   }
   const mid = (rest.length - 1) / 2;
   if (Number.isInteger(mid) && rest[mid] === " " && rest.slice(2, mid) === rest.slice(mid + 3)) {
      return [rest.slice(0, mid), rest.slice(mid + 1)];
   }
   return null;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Parse one `diff --git` section into paths, hunks, and a binary flag. */
export function parseSection(text) {
   const lines = text.split("\n");
   const header = parseHeaderPaths(lines[0].slice("diff --git ".length));
   let oldPath = header ? stripPrefix(header[0]) : undefined;
   let newPath = header ? stripPrefix(header[1]) : undefined;
   let binary = false;
   const hunks = [];
   let current = null;
   let seenPaths = [];
   for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const m = HUNK_RE.exec(line);
      if (m) {
         current = {
            oldStart: Number(m[1]),
            oldLines: m[2] === undefined ? 1 : Number(m[2]),
            newStart: Number(m[3]),
            newLines: m[4] === undefined ? 1 : Number(m[4]),
            header: m[5].trim(),
            added: 0,
            deleted: 0,
         };
         hunks.push(current);
         continue;
      }
      if (current) {
         if (line.startsWith("+")) current.added++;
         else if (line.startsWith("-")) current.deleted++;
         continue;
      }
      if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) binary = true;
      for (const [kw, side] of [
         ["--- ", "old"],
         ["+++ ", "new"],
         ["rename from ", "old"],
         ["rename to ", "new"],
         ["copy from ", "old"],
         ["copy to ", "new"],
      ]) {
         if (!line.startsWith(kw)) continue;
         const raw = parsePathValue(line.slice(kw.length));
         if (raw === undefined) return { unparsed: true };
         const value = kw.startsWith("---") || kw.startsWith("+++") ? stripPrefix(raw) : raw;
         if (value !== null) seenPaths.push(value);
         if (side === "old" && value !== null) oldPath = value;
         if (side === "new" && value !== null) newPath = value;
         if (kw === "--- " && value === null) oldPath = null;
         if (kw === "+++ " && value === null) newPath = null;
      }
   }
   const paths = [...new Set([oldPath, newPath, ...seenPaths].filter((p) => typeof p === "string"))];
   if (paths.length === 0) return { unparsed: true };
   return { oldPath: oldPath ?? null, newPath: newPath ?? null, paths, binary, hunks };
}

/** Split a patch into sections, drop secret/binary/unparsed ones, sort by path. */
export function filterPatch(patch) {
   const sections = [];
   const excluded = [];
   // Only "\n" starts a line: a multiline regex would also split on U+2028 or
   // "\r" inside file content and invent sections.
   const starts = patch.startsWith("diff --git ") ? [0] : [];
   for (let i = patch.indexOf("\ndiff --git "); i !== -1; i = patch.indexOf("\ndiff --git ", i + 1)) {
      starts.push(i + 1);
   }
   for (let k = 0; k < starts.length; k++) {
      let text = patch.slice(starts[k], starts[k + 1] ?? patch.length);
      if (!text.endsWith("\n")) text += "\n";
      const parsed = parseSection(text.replace(/\n$/, ""));
      if (parsed.unparsed) {
         excluded.push({ path: text.split("\n")[0].slice(0, 200), reason: "unparsed" });
         continue;
      }
      const display = parsed.newPath ?? parsed.oldPath;
      if (parsed.paths.some(isSecretPath)) {
         excluded.push({ path: displayPair(parsed), reason: "secret" });
         continue;
      }
      if (parsed.binary) {
         excluded.push({ path: display, reason: "binary" });
         continue;
      }
      sections.push({ ...parsed, file: display, text });
   }
   sections.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
   return { sections, excluded };
}

function displayPair(p) {
   if (p.oldPath && p.newPath && p.oldPath !== p.newPath) return `${p.oldPath} -> ${p.newPath}`;
   return p.newPath ?? p.oldPath;
}

export function indexHunks(sections) {
   const hunks = [];
   const files = [];
   for (const s of sections) {
      const generated = isGeneratedPath(s.file);
      let added = 0;
      let deleted = 0;
      for (const h of s.hunks) {
         hunks.push({
            id: `h${hunks.length + 1}`,
            file: s.file,
            ...(s.oldPath && s.oldPath !== s.file ? { oldFile: s.oldPath } : {}),
            ...h,
            generated,
         });
         added += h.added;
         deleted += h.deleted;
      }
      files.push({ path: s.file, oldPath: s.oldPath, added, deleted, generated });
   }
   return { hunks, files };
}

// ---------------------------------------------------------------- narrative validation

const str = { type: "string" };
const reqStr = { type: "string", required: true };
const oneOf = (...values) => ({ enum: values, required: true });
const listOf = (item, required = false) => ({ type: "array", item, required });

const NOTE = {
   hunk: reqStr,
   line: { type: "int", min: 1, required: true },
   side: oneOf("new", "old"),
   kind: oneOf("info", "risk", "question"),
   text: reqStr,
};
const THEME = {
   id: reqStr,
   title: reqStr,
   importance: { type: "int", min: 1, max: 5, required: true },
   summary: reqStr,
   hunks: listOf(reqStr, true),
   notes: listOf({ type: "object", fields: NOTE }),
};
const NODE = { id: reqStr, label: reqStr, kind: oneOf("changed", "affected"), layer: str, file: str };
const EDGE = { from: reqStr, to: reqStr, label: str };
const NARRATIVE = {
   version: { const: 1, required: true },
   mode: oneOf("summary", "deep"),
   title: reqStr,
   what: reqStr,
   why: reqStr,
   intent: oneOf("stated", "inferred"),
   themes: listOf({ type: "object", fields: THEME }, true),
   behavior: listOf({ type: "object", fields: { before: reqStr, after: reqStr, where: reqStr } }),
   removed: listOf({
      type: "object",
      fields: { what: reqStr, status: oneOf("re-established", "unaccounted", "intentional"), where: reqStr },
   }),
   impact: {
      type: "object",
      fields: {
         source: oneOf("graphify", "grep", "none"),
         nodes: listOf({ type: "object", fields: NODE }),
         edges: listOf({ type: "object", fields: EDGE }),
      },
   },
   focus: listOf({
      type: "object",
      fields: { severity: oneOf("high", "medium", "low"), where: reqStr, scenario: reqStr },
   }),
};

function checkValue(value, rule, at, errors) {
   if ("const" in rule) {
      if (value !== rule.const) errors.push(`${at}: must be ${JSON.stringify(rule.const)}`);
      return;
   }
   if (rule.enum) {
      if (!rule.enum.includes(value)) errors.push(`${at}: must be one of ${rule.enum.join(", ")}`);
      return;
   }
   switch (rule.type) {
      case "string":
         if (typeof value !== "string" || value.trim() === "") errors.push(`${at}: must be a non-empty string`);
         return;
      case "int":
         if (!Number.isInteger(value) || value < (rule.min ?? -Infinity) || value > (rule.max ?? Infinity)) {
            errors.push(`${at}: must be an integer${rule.min !== undefined ? ` from ${rule.min}` : ""}${rule.max !== undefined ? ` to ${rule.max}` : ""}`);
         }
         return;
      case "array":
         if (!Array.isArray(value)) {
            errors.push(`${at}: must be an array`);
            return;
         }
         value.forEach((v, i) => checkValue(v, rule.item, `${at}[${i}]`, errors));
         return;
      case "object":
         checkObject(value, rule.fields, at, errors);
         return;
   }
}

function checkObject(value, fields, at, errors) {
   if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${at || "narrative"}: must be an object`);
      return;
   }
   const prefix = at ? `${at}.` : "";
   for (const key of Object.keys(value)) {
      if (!(key in fields)) errors.push(`${prefix}${key}: unknown field`);
   }
   for (const [key, rule] of Object.entries(fields)) {
      if (value[key] === undefined) {
         if (rule.required) errors.push(`${prefix}${key}: required`);
         continue;
      }
      checkValue(value[key], rule, `${prefix}${key}`, errors);
   }
}

/** All violations of the narrative contract, including links to hunks.json. */
export function validateNarrative(narrative, hunks) {
   const errors = [];
   checkObject(narrative, NARRATIVE, "", errors);
   if (errors.length > 0) return errors;

   const byId = new Map(hunks.map((h) => [h.id, h]));
   const owner = new Map();
   const themeIds = new Set();
   narrative.themes.forEach((theme, t) => {
      const at = `themes[${t}]`;
      if (theme.id === "other") errors.push(`${at}.id: "other" is reserved`);
      if (themeIds.has(theme.id)) errors.push(`${at}.id: duplicate theme id ${theme.id}`);
      themeIds.add(theme.id);
      theme.hunks.forEach((id, i) => {
         if (!byId.has(id)) errors.push(`${at}.hunks[${i}]: unknown hunk id ${id}`);
         else if (owner.has(id)) errors.push(`${at}.hunks[${i}]: hunk ${id} is already in theme ${owner.get(id)}`);
         else owner.set(id, theme.id);
      });
      (theme.notes ?? []).forEach((note, i) => {
         const nat = `${at}.notes[${i}]`;
         const hunk = byId.get(note.hunk);
         if (!theme.hunks.includes(note.hunk) || !hunk) {
            errors.push(`${nat}.hunk: ${note.hunk} is not a hunk of this theme`);
            return;
         }
         const start = note.side === "new" ? hunk.newStart : hunk.oldStart;
         const count = note.side === "new" ? hunk.newLines : hunk.oldLines;
         if (note.line < start || note.line >= start + count) {
            errors.push(`${nat}.line: line ${note.line} is outside ${note.hunk} (${note.side} side ${start}-${start + count - 1})`);
         }
      });
   });
   const nodeIds = new Set();
   (narrative.impact?.nodes ?? []).forEach((node, i) => {
      if (nodeIds.has(node.id)) errors.push(`impact.nodes[${i}].id: duplicate node id ${node.id}`);
      nodeIds.add(node.id);
   });
   return errors;
}

// ---------------------------------------------------------------- HTML

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "\u2028": "&#8232;", "\u2029": "&#8233;" };
const esc = (s) => String(s).replace(/[&<>"'\u2028\u2029]/g, (c) => ESC[c]);
/** Escaped plain text; `code` spans are the only markup. */
const text = (s) => esc(s).replace(/`([^`\n]+)`/g, "<code>$1</code>");
/** JSON safe inside a <script> element. */
const scriptJson = (v) =>
   JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const sha256 = (s) => `'sha256-${crypto.createHash("sha256").update(s, "utf8").digest("base64")}'`;

const FOLD_LINES = 800;
const OTHER_SUMMARY = "The narrative does not explain these hunks.";

/** Order themes, add "Other changes", and slice diff2html files per theme. */
function buildThemes(narrative, hunks, files, meta) {
   const blockOf = new Map();
   let n = 0;
   files.forEach((file, fi) => {
      file.blocks.forEach((block, bi) => blockOf.set(`h${++n}`, { fi, bi }));
   });
   if (n !== hunks.length) throw new Fail(3, "diff.patch and hunks.json disagree; run collect again");

   const changed = new Map(meta.files.map((f) => [f.path, f.added + f.deleted]));
   const genByFile = new Map(hunks.map((h) => [h.file, h.generated]));
   const themes = narrative.themes
      .map((t, i) => ({ ...t, notes: t.notes ?? [], order: i }))
      .sort((a, b) => b.importance - a.importance || a.order - b.order);
   const assigned = new Set(themes.flatMap((t) => t.hunks));
   const rest = hunks.map((h) => h.id).filter((id) => !assigned.has(id));
   if (rest.length > 0) {
      themes.push({ id: "other", title: "Other changes", summary: OTHER_SUMMARY, hunks: rest, notes: [], importance: 0 });
   }

   return themes.map((theme) => {
      const picked = new Map();
      for (const id of theme.hunks) {
         const { fi, bi } = blockOf.get(id);
         if (!picked.has(fi)) picked.set(fi, []);
         picked.get(fi).push(bi);
      }
      const groups = { main: [], folded: [] };
      for (const fi of [...picked.keys()].sort((a, b) => a - b)) {
         const file = files[fi];
         const blocks = picked.get(fi).sort((a, b) => a - b).map((bi) => file.blocks[bi]);
         const slice = {
            ...file,
            blocks,
            addedLines: blocks.reduce((s, b) => s + b.lines.filter((l) => l.type === "insert").length, 0),
            deletedLines: blocks.reduce((s, b) => s + b.lines.filter((l) => l.type === "delete").length, 0),
         };
         const name = file.newName === "/dev/null" ? file.oldName : file.newName;
         const fold = genByFile.get(name) || (changed.get(name) ?? 0) > FOLD_LINES;
         (fold ? groups.folded : groups.main).push(slice);
      }
      return { ...theme, groups };
   });
}

const PAGE_CSS = `
:root{--bg:#fbfbfa;--fg:#1d1f23;--muted:#5d636d;--line:#e2e4e8;--card:#fff;--accent:#2f5bd3;--risk:#b4232c;--info:#2f5bd3;--q:#8a5a00;--chip:#eef1f6;--on-accent:#fff;--changed-bg:#e8eeff;color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15171a;--fg:#e6e8eb;--muted:#9aa1ab;--line:#2c3036;--card:#1c1f23;--accent:#7ea2ff;--risk:#ff7b83;--info:#7ea2ff;--q:#e0b25c;--chip:#262a30;--on-accent:#0d1117;--changed-bg:#1f2a44;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#15171a;--fg:#e6e8eb;--muted:#9aa1ab;--line:#2c3036;--card:#1c1f23;--accent:#7ea2ff;--risk:#ff7b83;--info:#7ea2ff;--q:#e0b25c;--chip:#262a30;--on-accent:#0d1117;--changed-bg:#1f2a44;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;margin:0}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}
h1{font-size:1.7rem;line-height:1.25;margin:0 0 8px}
h2{font-size:1.2rem;margin:40px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:1.05rem;margin:0}
code{font:0.88em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--chip);padding:1px 5px;border-radius:4px}
.meta{display:flex;flex-wrap:wrap;gap:6px 16px;color:var(--muted);font-size:.9rem;margin:0 0 16px}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:1px 10px;font-size:.8rem;color:var(--fg)}
.lead{font-size:1.05rem;margin:4px 0}
.none{color:var(--muted);font-style:italic}
.theme{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}
.theme header{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px;margin-bottom:6px}
.diff{overflow-x:auto;margin-top:10px}
details.folded{margin-top:10px;border:1px dashed var(--line);border-radius:8px;padding:6px 10px}
details.folded summary{cursor:pointer;color:var(--muted)}
.notes{list-style:none;padding:0;margin:12px 0 0}
.notes li{border-left:3px solid var(--info);padding:4px 10px;margin:6px 0;background:var(--chip);border-radius:0 6px 6px 0}
.notes li.risk{border-color:var(--risk)}.notes li.question{border-color:var(--q)}
.notes .where{font:0.85em ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);margin-right:8px}
.layout{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.layout button{font:inherit;font-size:.85rem;background:var(--card);color:var(--fg);border:0;padding:4px 12px;cursor:pointer}
.layout button[aria-pressed="true"]{background:var(--accent);color:var(--on-accent)}
.table-wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}
.sev-high{color:var(--risk);font-weight:600}.sev-medium{color:var(--q);font-weight:600}
.notice{color:var(--muted);font-size:.9rem;margin-top:10px}
svg text{fill:var(--fg);font:12px system-ui,sans-serif}
.vd-impact{display:block;max-width:100%;height:auto;min-width:560px}
.vd-band{fill:var(--card)}.vd-band.alt{fill:var(--chip)}
.vd-layer{fill:var(--muted);font-weight:600}
.vd-node rect{stroke-width:1.5}
.vd-changed rect{fill:var(--changed-bg);stroke:var(--accent)}
.vd-affected rect{fill:var(--card);stroke:var(--muted)}
.vd-edge{fill:none;stroke:var(--muted);stroke-width:1.4}
.vd-arrowhead{fill:var(--muted)}
`;

// Draws every embedded diff with Diff2HtmlUI and wires the layout buttons.
const APP_JS = `(()=>{const data=[...document.querySelectorAll('script[data-vd-diff]')];const buttons=[...document.querySelectorAll('[data-vd-layout]')];let fmt='line-by-line';try{fmt=localStorage.getItem('vd-layout')||fmt}catch(e){}
function draw(){for(const n of data){const el=document.getElementById(n.dataset.vdTarget);el.textContent='';const ui=new Diff2HtmlUI(el,JSON.parse(n.textContent),{outputFormat:fmt,drawFileList:false,matching:'lines',highlight:true,colorScheme:'auto',fileContentToggle:false,stickyFileHeaders:false,synchronisedScroll:true});ui.draw();ui.highlightCode();}for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.vdLayout===fmt));}
for(const b of buttons)b.addEventListener('click',()=>{fmt=b.dataset.vdLayout;try{localStorage.setItem('vd-layout',fmt)}catch(e){}draw();});draw();})();`;

function section(id, title, body) {
   return `<section id="${id}"><h2>${esc(title)}</h2>${body}</section>`;
}

function renderHeader(narrative, meta) {
   const t = meta.target;
   const target = t.kind === "worktree" ? "working tree" : `${t.kind} ${t.value}`;
   const base = meta.base ? `${meta.base.ref}${meta.base.sha ? ` (${meta.base.sha.slice(0, 12)})` : ""}` : "none";
   return `<header>
<h1>${text(narrative.title)}</h1>
<div class="meta"><span>Target: ${esc(target)}${meta.path ? ` · path ${esc(meta.path)}` : ""}</span><span>Base: ${esc(base)}</span><span>${meta.stats.files} files · +${meta.stats.added} −${meta.stats.deleted}</span><span class="chip">${esc(narrative.mode)}</span><span class="chip">intent ${esc(narrative.intent)}</span></div>
<p class="lead"><strong>What:</strong> ${text(narrative.what)}</p>
<p class="lead"><strong>Why:</strong> ${text(narrative.why)}</p>
</header>`;
}

function renderTour(themes, hunks) {
   const byId = new Map(hunks.map((h) => [h.id, h]));
   let target = 0;
   const dataBlocks = [];
   const container = (theme, files) => {
      const id = `vd-diff-${++target}`;
      dataBlocks.push(
         `<script type="application/json" data-vd-diff data-vd-theme="${esc(theme.id)}" data-vd-target="${id}">${scriptJson(files)}</script>`,
      );
      return `<div class="diff" id="${id}"></div>`;
   };
   const toggle = `<div class="layout" role="group" aria-label="Diff layout" data-vd-toggle><button type="button" data-vd-layout="line-by-line" aria-pressed="true">Unified</button><button type="button" data-vd-layout="side-by-side" aria-pressed="false">Split</button></div>`;
   const blocks = themes.map((theme) => {
      const main = theme.groups.main.length ? container(theme, theme.groups.main) : "";
      const folded = theme.groups.folded
         .map((file) => {
            const name = file.newName === "/dev/null" ? file.oldName : file.newName;
            return `<details class="folded"><summary>${esc(name)} (generated or large, folded)</summary>${container(theme, [file])}</details>`;
         })
         .join("");
      const notes = theme.notes.length
         ? `<ul class="notes">${theme.notes
              .map((note) => {
                 const h = byId.get(note.hunk);
                 const file = note.side === "old" ? (h.oldFile ?? h.file) : h.file;
                 return `<li class="${note.kind}"><span class="where">${esc(`${file}:${note.line}`)}${note.side === "old" ? " (old)" : ""}</span>${text(note.text)}</li>`;
              })
              .join("")}</ul>`
         : "";
      return `<article class="theme" id="theme-${esc(theme.id)}"><header><h3>${text(theme.title)}</h3><span class="chip">${theme.hunks.length} ${theme.hunks.length === 1 ? "hunk" : "hunks"}</span></header><p>${text(theme.summary)}</p>${main}${folded}${notes}</article>`;
   });
   const body = themes.length ? `${toggle}${blocks.join("")}` : NONE;
   return { html: section("tour", "Guided tour", body), dataBlocks };
}

const NONE = `<p class="none">None</p>`;
const EXCLUDED_NOTICE = "Only file names are filtered. Secrets inside other files are shown as-is.";

function table(headers, rows) {
   if (rows.length === 0) return NONE;
   const head = headers.map((h) => `<th>${esc(h)}</th>`).join("");
   const body = rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
   return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderChangeMap(themes, hunks) {
   const byId = new Map(hunks.map((h) => [h.id, h]));
   const rows = themes.map((theme) => {
      const counts = new Map();
      for (const id of theme.hunks) {
         const file = byId.get(id).file;
         counts.set(file, (counts.get(file) ?? 0) + 1);
      }
      const files = [...counts].map(([f, n]) => `<code>${esc(f)}</code> <span class="none">×${n}</span>`).join("<br>");
      return [`<a href="#theme-${esc(theme.id)}">${text(theme.title)}</a>`, files];
   });
   return section("change-map", "Change map", table(["Theme", "Files"], rows));
}

function renderBehavior(items) {
   const rows = items.map((b) => [text(b.before), text(b.after), `<code>${esc(b.where)}</code>`]);
   return section("behavior", "Behavior changes", table(["Before", "After", "Where"], rows));
}

function renderRemoved(items) {
   const rows = items.map((r) => [text(r.what), esc(r.status), `<code>${esc(r.where)}</code>`]);
   return section("removed", "Removed behavior", table(["What was removed", "Status", "Where"], rows));
}

function renderFocus(items) {
   const rows = items.map((f) => [
      `<span class="sev-${f.severity}">${esc(f.severity)}</span>`,
      `<code>${esc(f.where)}</code>`,
      text(f.scenario),
   ]);
   return section("focus", "Review focus", table(["Severity", "Where", "Failure scenario"], rows));
}

function renderExcluded(excluded) {
   const rows = excluded.map((e) => [`<code>${esc(e.path)}</code>`, esc(e.reason)]);
   return section("excluded", "Excluded files", `${table(["Path", "Reason"], rows)}<p class="notice">${esc(EXCLUDED_NOTICE)}</p>`);
}

const MAX_NODES = 40;
const LABEL_CHARS = 32;
const G = { width: 820, layerCol: 130, nodeW: 250, nodeH: 30, rowGap: 12, bandPad: 16, colX: { changed: 150, affected: 540 } };

/** Deterministic layout: one band per layer, changed nodes left, affected right. */
export function layoutImpact(impact) {
   const all = impact?.nodes ?? [];
   const drawn = all.slice(0, MAX_NODES);
   const known = new Set(all.map((n) => n.id));
   const dropped = (impact?.edges ?? []).filter((e) => !known.has(e.from) || !known.has(e.to));
   const layers = [...new Set(drawn.map((n) => n.layer ?? "—"))];
   const pos = new Map();
   const bands = [];
   let y = 0;
   for (const layer of layers) {
      const inLayer = drawn.filter((n) => (n.layer ?? "—") === layer);
      const rows = Math.max(...["changed", "affected"].map((k) => inLayer.filter((n) => n.kind === k).length));
      const height = G.bandPad * 2 + rows * G.nodeH + (rows - 1) * G.rowGap;
      bands.push({ layer, y, height });
      for (const kind of ["changed", "affected"]) {
         inLayer
            .filter((n) => n.kind === kind)
            .forEach((n, i) => pos.set(n.id, { x: G.colX[kind], y: y + G.bandPad + i * (G.nodeH + G.rowGap), node: n }));
      }
      y += height;
   }
   const edges = (impact?.edges ?? []).filter((e) => pos.has(e.from) && pos.has(e.to));
   return { drawn, extra: all.length - drawn.length, all, bands, pos, edges, dropped, height: y };
}

function edgePath(a, b) {
   const ay = a.y + G.nodeH / 2;
   const by = b.y + G.nodeH / 2;
   if (a.x === b.x) {
      const x = a.x + G.nodeW;
      return `M${x} ${ay} C${x + 50} ${ay}, ${x + 50} ${by}, ${x + 4} ${by}`;
   }
   const [x1, x2] = a.x < b.x ? [a.x + G.nodeW, b.x - 4] : [a.x, b.x + G.nodeW + 4];
   const bend = (x2 - x1) / 2;
   return `M${x1} ${ay} C${x1 + bend} ${ay}, ${x2 - bend} ${by}, ${x2} ${by}`;
}

function renderImpact(impact) {
   const L = layoutImpact(impact);
   if (L.all.length === 0) return section("impact", "Impact diagram", NONE);
   const short = (s) => (s.length > LABEL_CHARS ? `${s.slice(0, LABEL_CHARS - 1)}…` : s);
   const bands = L.bands
      .map(
         (b, i) =>
            `<rect class="vd-band${i % 2 ? " alt" : ""}" x="0" y="${b.y}" width="${G.width}" height="${b.height}"></rect><text class="vd-layer" x="12" y="${b.y + G.bandPad + 19}">${esc(short(b.layer))}</text>`,
      )
      .join("");
   const edges = L.edges
      .map((e) => {
         const title = `${e.from} → ${e.to}${e.label ? `: ${e.label}` : ""}`;
         return `<path data-edge class="vd-edge" d="${edgePath(L.pos.get(e.from), L.pos.get(e.to))}" marker-end="url(#vd-arrow)"><title>${esc(title)}</title></path>`;
      })
      .join("");
   const nodes = [...L.pos.values()]
      .map(
         ({ x, y, node }) =>
            `<g data-node-id="${esc(node.id)}" data-kind="${node.kind}" class="vd-node vd-${node.kind}"><title>${esc(node.label)}</title><rect x="${x}" y="${y}" width="${G.nodeW}" height="${G.nodeH}" rx="6"></rect><text x="${x + 10}" y="${y + 19}">${esc(short(node.label))}</text></g>`,
      )
      .join("");
   const svg = `<div class="table-wrap"><svg class="vd-impact" viewBox="0 0 ${G.width} ${L.height}" width="${G.width}" role="img" aria-label="Impact diagram"><defs><marker id="vd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="vd-arrowhead"></path></marker></defs>${bands}${edges}${nodes}</svg></div>`;
   const more = L.extra > 0 ? `<p class="notice">+${L.extra} more (see the table)</p>` : "";
   const legend = `<p class="notice">Source: ${esc(impact.source)} · left: changed · right: affected (1 hop)</p>`;
   const rows = L.all.map((n) => [esc(n.label), esc(n.kind), esc(n.layer ?? "—"), n.file ? `<code>${esc(n.file)}</code>` : ""]);
   return section("impact", "Impact diagram", `${legend}${svg}${more}${table(["Node", "Kind", "Layer", "File"], rows)}`);
}

export function buildPage({ narrative, meta, hunks, themes, vendor }) {
   const tour = renderTour(themes, hunks);
   const scripts = [vendor.uiJs, APP_JS];
   const csp = [
      "default-src 'none'",
      `script-src ${scripts.map(sha256).join(" ")}`,
      "style-src 'unsafe-inline'",
      "img-src data:",
      "base-uri 'none'",
      "form-action 'none'",
   ].join("; ");
   return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(narrative.title)} · visual-diff</title>
<style>${vendor.css}
${vendor.hljsLight}
@media (prefers-color-scheme: dark) {
${vendor.hljsDark}
}
${PAGE_CSS}</style>
</head>
<body>
<main>
${renderHeader(narrative, meta)}
${renderChangeMap(themes, hunks)}
${renderImpact(narrative.impact)}
${tour.html}
${renderBehavior(narrative.behavior ?? [])}
${renderRemoved(narrative.removed ?? [])}
${renderFocus(narrative.focus ?? [])}
${renderExcluded(meta.excluded ?? [])}
</main>
${tour.dataBlocks.join("\n")}
<script>${vendor.uiJs}</script>
<script>${APP_JS}</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- I/O helpers

function git(args, { cwd, allowExit1 = false, capped = false } = {}) {
   const res = spawnSync("git", args, {
      cwd,
      maxBuffer: capped ? MAX_DIFF_BYTES : 64 * 1024 * 1024,
   });
   if (res.error) {
      if (res.error.code === "ENOBUFS") throw new Fail(3, TOO_LARGE);
      throw new Fail(3, `git ${args[0]} failed: ${res.error.message}`);
   }
   if (res.status !== 0 && !(allowExit1 && res.status === 1)) {
      throw new Fail(3, `git ${args[0]} failed: ${res.stderr.toString("utf8").trim()}`);
   }
   return res.stdout;
}

function tryGit(args, cwd) {
   const res = spawnSync("git", args, { cwd, encoding: "utf8" });
   return res.status === 0 ? res.stdout.trim() : null;
}

function reportsRoot() {
   return path.join(fs.realpathSync(os.tmpdir()), "pi-reports");
}

function lexists(p) {
   try {
      fs.lstatSync(p);
      return true;
   } catch {
      return false;
   }
}

/** Real path of `p`, resolving symlinks in every existing ancestor. */
function resolveReal(p) {
   let cur = path.resolve(p);
   const rest = [];
   while (!lexists(cur)) {
      rest.unshift(path.basename(cur));
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
   }
   let real;
   try {
      real = fs.realpathSync(cur);
   } catch {
      throw new Fail(2, `cannot resolve ${p}`);
   }
   return path.join(real, ...rest);
}

function assertInsideReports(p) {
   const root = reportsRoot();
   const real = resolveReal(p);
   if (!real.startsWith(root + path.sep)) {
      throw new Fail(2, `refusing ${p}: output must stay inside ${root}`);
   }
   return real;
}

function isBinaryFile(file) {
   const fd = fs.openSync(file, "r");
   try {
      const buf = Buffer.alloc(BINARY_SNIFF_BYTES);
      const n = fs.readSync(fd, buf, 0, BINARY_SNIFF_BYTES, 0);
      return buf.subarray(0, n).includes(0);
   } finally {
      fs.closeSync(fd);
   }
}

const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "--src-prefix=a/", "--dst-prefix=b/"];
const SECRET_PATHSPECS = SECRET_GLOBS.map((g) => `:(exclude,icase,glob)**/${g}`);

function resolveDefaultBase(top) {
   const head = tryGit(["rev-parse", "--verify", "--quiet", "HEAD"], top);
   if (!head) return { ref: "(empty tree)", sha: EMPTY_TREE };
   const upstream = tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], top);
   const candidates = upstream
      ? [upstream]
      : [
           tryGit(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], top),
           tryGit(["rev-parse", "--verify", "--quiet", "refs/heads/main"], top) && "main",
           tryGit(["rev-parse", "--verify", "--quiet", "refs/heads/master"], top) && "master",
        ].filter(Boolean);
   for (const ref of candidates) {
      const sha = tryGit(["merge-base", ref, "HEAD"], top);
      if (sha) return { ref, sha };
   }
   return { ref: "HEAD", sha: head };
}

/** Names-only pass: renames/copies touching a secret path must drop both sides. */
function secretPairs(diffArgs, top) {
   const out = git(["diff", "--name-status", "-z", "-M", "-C", ...diffArgs], { cwd: top }).toString("utf8");
   const parts = out.split("\0").filter((x, i, a) => !(x === "" && i === a.length - 1));
   const excluded = [];
   const literal = [];
   for (let i = 0; i < parts.length; ) {
      const status = parts[i++];
      const paths = /^[RC]/.test(status) ? [parts[i++], parts[i++]] : [parts[i++]];
      if (!paths.some(isSecretPath)) continue;
      excluded.push({ path: paths.join(" -> "), reason: "secret" });
      for (const p of paths) literal.push(`:(exclude,literal)${p}`);
   }
   return { excluded, literal };
}

function collectUntracked(top, pathspec, budget) {
   const list = git(["ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspec], { cwd: top })
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .sort();
   const excluded = [];
   let patch = "";
   let used = 0;
   for (const rel of list) {
      if (isSecretPath(rel)) {
         excluded.push({ path: rel, reason: "secret" });
         continue;
      }
      const abs = path.join(top, rel);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) {
         excluded.push({ path: rel, reason: "symlink" });
         continue;
      }
      if (!st.isFile()) continue;
      if (st.size > MAX_DIFF_BYTES) {
         excluded.push({ path: rel, reason: "too-large" });
         continue;
      }
      if (isBinaryFile(abs)) {
         excluded.push({ path: rel, reason: "binary" });
         continue;
      }
      const out = git(["diff", "--no-index", ...DIFF_FLAGS, "--", "/dev/null", rel], {
         cwd: top,
         allowExit1: true,
         capped: true,
      });
      used += out.length;
      if (used > budget) throw new Fail(3, TOO_LARGE);
      patch += out.toString("utf8");
   }
   return { patch, excluded };
}

function dedupe(entries) {
   const seen = new Set();
   return entries.filter((e) => {
      const key = `${e.reason}\0${e.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
   });
}

function stamp() {
   return new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
}

// ---------------------------------------------------------------- commands

// Revisions reach git as arguments: a leading "-" would turn them into options.
const SAFE_REV = /^[A-Za-z0-9_][A-Za-z0-9_./~^@{}-]*$/;

function checkRev(flag, value) {
   if (!SAFE_REV.test(value)) throw new Fail(2, `${flag} ${value}: not a revision`);
}

function gh(args, cwd, capped = false) {
   const res = spawnSync("gh", args, { cwd, maxBuffer: capped ? MAX_DIFF_BYTES : 16 * 1024 * 1024 });
   if (res.error) {
      if (res.error.code === "ENOBUFS") throw new Fail(3, TOO_LARGE);
      throw new Fail(3, `gh failed: ${res.error.message}`);
   }
   if (res.status !== 0) throw new Fail(3, `gh ${args.slice(0, 2).join(" ")} failed: ${res.stderr.toString("utf8").trim()}`);
   return res.stdout;
}

/** The raw patch plus what was excluded before any content was read. */
function readTarget(opts, top, pathspec) {
   const given = ["range", "commit", "pr"].filter((k) => opts[k] !== undefined);
   if (given.length > 1) throw new Fail(2, "use only one of --range, --commit, --pr");

   if (opts.pr !== undefined) {
      if (!/^\d+$/.test(opts.pr)) throw new Fail(2, `--pr ${opts.pr}: not a PR number`);
      let view;
      try {
         view = JSON.parse(gh(["pr", "view", opts.pr, "--json", "headRefOid,body"], top).toString("utf8"));
      } catch (err) {
         if (err instanceof Fail) throw err;
         throw new Fail(3, `gh pr view returned invalid JSON: ${err.message}`);
      }
      const head = tryGit(["rev-parse", "--verify", "--quiet", "HEAD"], top);
      if (view.headRefOid !== head) {
         throw new Fail(3, `HEAD is not the PR head; check out the PR head first (gh pr checkout ${opts.pr})`);
      }
      const patch = gh(["pr", "diff", opts.pr], top, true).toString("utf8");
      return { target: { kind: "pr", value: opts.pr }, base: null, patch, excluded: [], prBody: view.body ?? "" };
   }

   let target;
   let base;
   let diffArgs;
   if (opts.range !== undefined) {
      checkRev("--range", opts.range);
      const left = opts.range.split(/\.{2,3}/)[0] || "HEAD";
      target = { kind: "range", value: opts.range };
      base = { ref: opts.range, sha: tryGit(["rev-parse", "--verify", "--quiet", `${left}^{commit}`], top) };
      diffArgs = [opts.range];
   } else if (opts.commit !== undefined) {
      checkRev("--commit", opts.commit);
      const sha = tryGit(["rev-parse", "--verify", "--quiet", `${opts.commit}^{commit}`], top);
      if (!sha) throw new Fail(3, `unknown commit: ${opts.commit}`);
      const parent = tryGit(["rev-parse", "--verify", "--quiet", `${sha}^`], top) ?? EMPTY_TREE;
      target = { kind: "commit", value: opts.commit };
      base = { ref: `${opts.commit}^`, sha: parent };
      diffArgs = [parent, sha];
   } else {
      target = { kind: "worktree" };
      base = resolveDefaultBase(top);
      diffArgs = [base.sha];
   }

   const pairs = secretPairs([...diffArgs, "--", ...pathspec], top);
   const tracked = git(
      ["diff", ...DIFF_FLAGS, "-M", ...diffArgs, "--", ...pathspec, ...SECRET_PATHSPECS, ...pairs.literal],
      { cwd: top, capped: true },
   );
   const untracked =
      target.kind === "worktree"
         ? collectUntracked(top, pathspec, MAX_DIFF_BYTES - tracked.length)
         : { patch: "", excluded: [] };
   return {
      target,
      base,
      patch: tracked.toString("utf8") + untracked.patch,
      excluded: [...pairs.excluded, ...untracked.excluded],
   };
}

function underPath(file, rel) {
   return rel === "." || file === rel || file.startsWith(`${rel}/`);
}

function collect(opts) {
   const cwd = process.cwd();
   const top = tryGit(["rev-parse", "--show-toplevel"], cwd);
   if (!top) throw new Fail(3, "not inside a git repository");
   const outDir = opts.out
      ? assertInsideReports(opts.out)
      : assertInsideReports(path.join(reportsRoot(), `visual-diff-${stamp()}-${crypto.randomBytes(3).toString("hex")}`));
   if (lexists(outDir)) throw new Fail(2, `refusing ${outDir}: it already exists`);

   const rel = opts.path ? path.relative(top, path.resolve(cwd, opts.path)) || "." : ".";
   if (rel.startsWith("..")) throw new Fail(2, `--path ${opts.path} is outside the repository`);
   const { target, base, patch, excluded: early, prBody } = readTarget(opts, top, [rel]);

   const filteredPatch = filterPatch(patch);
   const sections = filteredPatch.sections.filter((sec) => sec.paths.some((p) => underPath(p, rel)));
   const excluded = dedupe([...early, ...filteredPatch.excluded]);
   if (sections.length === 0) {
      process.stdout.write("no changes\n");
      for (const e of excluded) process.stdout.write(`excluded: ${e.path} (${e.reason})\n`);
      return;
   }

   const { hunks, files } = indexHunks(sections);
   const meta = {
      version: 1,
      target,
      base,
      head: tryGit(["rev-parse", "--verify", "--quiet", "HEAD"], top),
      path: opts.path ?? null,
      ...(prBody !== undefined ? { prBody } : {}),
      stats: {
         files: files.length,
         added: files.reduce((n, f) => n + f.added, 0),
         deleted: files.reduce((n, f) => n + f.deleted, 0),
      },
      files,
      excluded,
      createdAt: new Date().toISOString(),
   };

   fs.mkdirSync(path.dirname(outDir), { recursive: true });
   fs.mkdirSync(outDir);
   assertInsideReports(outDir);
   fs.writeFileSync(path.join(outDir, "diff.patch"), sections.map((s) => s.text).join(""));
   fs.writeFileSync(path.join(outDir, "hunks.json"), `${JSON.stringify(hunks, null, 2)}\n`);
   fs.writeFileSync(path.join(outDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

   const baseText = base ? `${base.ref}${base.sha ? ` ${base.sha.slice(0, 12)}` : ""}` : "none";
   const lines = [`run: ${outDir}`, `files: ${meta.stats.files}  +${meta.stats.added} -${meta.stats.deleted}  base: ${baseText}`];
   for (const h of hunks) {
      lines.push(
         `${h.id} ${h.file} @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@ +${h.added} -${h.deleted}${h.generated ? " [generated]" : ""}`,
      );
   }
   for (const e of excluded) lines.push(`excluded: ${e.path} (${e.reason})`);
   process.stdout.write(`${lines.join("\n")}\n`);
}

/**
 * Evaluate a UMD bundle as CommonJS. `require` would treat it as an ES module
 * wherever the nearest package.json says "type": "module", as this repo does.
 */
function loadCommonJs(file) {
   const module = { exports: {} };
   const wrapper = new vm.Script(`(function (module, exports) {${fs.readFileSync(file, "utf8")}\n})`, { filename: file });
   wrapper.runInThisContext().call(module.exports, module, module.exports);
   return module.exports;
}

function readRunJson(dir, name) {
   const file = path.join(dir, name);
   if (!fs.existsSync(file)) throw new Fail(2, `${name} is missing in ${dir}`);
   try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
   } catch (err) {
      throw new Fail(2, `${name} is not valid JSON: ${err.message}`);
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
   if (!opts.dir) throw new Fail(2, "render needs --dir <run>");
   const dir = assertInsideReports(opts.dir);
   if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Fail(2, `${dir} is not a run directory`);
   const meta = readRunJson(dir, "meta.json");
   const hunks = readRunJson(dir, "hunks.json");
   const narrative = readRunJson(dir, "narrative.json");

   const errors = validateNarrative(narrative, hunks);
   if (errors.length > 0) throw new Fail(2, `narrative.json is invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`);

   const Diff2Html = loadCommonJs(path.join(VENDOR_DIR, "diff2html.min.js"));
   const patchFile = path.join(dir, "diff.patch");
   if (!fs.existsSync(patchFile)) throw new Fail(2, `diff.patch is missing in ${dir}`);
   const files = Diff2Html.parse(fs.readFileSync(patchFile, "utf8"));
   const themes = buildThemes(narrative, hunks, files, meta);
   for (const e of layoutImpact(narrative.impact).dropped) {
      process.stderr.write(`warning: dropped impact edge ${e.from} -> ${e.to}: unknown node id\n`);
   }
   const vendorText = (name) => fs.readFileSync(path.join(VENDOR_DIR, name), "utf8");
   const page = buildPage({
      narrative,
      meta,
      hunks,
      themes,
      vendor: {
         uiJs: vendorText("diff2html-ui-slim.min.js"),
         css: vendorText("diff2html.min.css"),
         hljsLight: vendorText("hljs-github.min.css"),
         hljsDark: vendorText("hljs-github-dark.min.css"),
      },
   });

   const out = path.join(dir, "visual-diff.html");
   fs.writeFileSync(out, page);
   process.stdout.write(`${out}\n`);
   if (!opts.noOpen) openInBrowser(out);
}

// ---------------------------------------------------------------- CLI

const VALUE_FLAGS = new Set(["--out", "--dir", "--range", "--commit", "--pr", "--path"]);
const BOOL_FLAGS = new Set(["--no-open"]);

function parseArgs(argv) {
   const [command, ...rest] = argv;
   const opts = {};
   for (let i = 0; i < rest.length; i++) {
      const flag = rest[i];
      if (BOOL_FLAGS.has(flag)) {
         opts[flag.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = true;
      } else if (VALUE_FLAGS.has(flag)) {
         const value = rest[++i];
         if (value === undefined) throw new Fail(2, `${flag} needs a value`);
         opts[flag.slice(2)] = value;
      } else {
         throw new Fail(2, `unknown argument: ${flag}`);
      }
   }
   return { command, opts };
}

const USAGE = `usage:
  visual-diff.mjs collect [--range <r> | --commit <sha> | --pr <n>] [--path <p>] [--out <dir>]
  visual-diff.mjs render --dir <run> [--no-open]`;

function main() {
   try {
      const { command, opts } = parseArgs(process.argv.slice(2));
      if (command === "collect") collect(opts);
      else if (command === "render") render(opts);
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
