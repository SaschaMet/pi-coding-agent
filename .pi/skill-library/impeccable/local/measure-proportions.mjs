#!/usr/bin/env node
// Measures the proportions of a rendered page so "golden" or "premium" is checked with
// numbers, not by eye. Local addition (not upstream); see local/premium-proportion.md.
//
// Usage, from the project root (Playwright must be installed in ./, ./web or ./app):
//   node ~/.pi/agent/skill-library/impeccable/local/measure-proportions.mjs <url> [width] [height]
//   e.g. node .../measure-proportions.mjs http://localhost:4321/lp/x 1440 900
// A cookie banner covers the first viewport; pre-seed consent with MEASURE_INIT_SCRIPT, e.g.
//   MEASURE_INIT_SCRIPT='localStorage.setItem("consent_state_v2","{\"decisions\":{\"necessary\":true}}")'
//
// Offline: only localhost, 127.0.0.1 and [::1] URLs are accepted, and the browser aborts
// every request to another host, so nothing leaves the machine (local/RULES.md, rules 1-2).
//
// Output: one line per section root ([data-section], else <main> > section) with the side-by-side
// columns, the ratio of the two widest and its distance from phi, heading and body sizes, and
// advisory flags; then a summary with the first-viewport check. Exit code 0; flags are advice.

import { createRequire } from 'node:module';
import { join } from 'node:path';

const [, , url, w = '1440', h = '900'] = process.argv;
if (!url) {
  console.error('usage: measure-proportions.mjs <url> [width] [height]');
  process.exit(2);
}
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
if (!LOCAL.has(new URL(url).hostname)) {
  console.error(`refused: ${new URL(url).hostname} is not local (local/RULES.md rule 2)`);
  process.exit(2);
}

function loadPlaywright() {
  for (const base of [process.cwd(), join(process.cwd(), 'web'), join(process.cwd(), 'app')]) {
    try {
      return createRequire(join(base, 'noop.js'))('playwright');
    } catch {
      // try the next workspace
    }
  }
  console.error('playwright not found in ./, ./web or ./app node_modules');
  process.exit(2);
}

const PHI = 1.618;
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.route('**/*', (route) => {
  const target = route.request().url();
  if (target.startsWith('data:') || target.startsWith('blob:')) return route.continue();
  return LOCAL.has(new URL(target).hostname) ? route.continue() : route.abort();
});
if (process.env.MEASURE_INIT_SCRIPT) await page.addInitScript(process.env.MEASURE_INIT_SCRIPT);
await page.goto(url, { waitUntil: 'networkidle' });

const report = await page.evaluate((phi) => {
  const px = (v) => Math.round(Number.parseFloat(v));
  const roots = [...document.querySelectorAll('[data-section]')];
  const sections = roots.length ? roots : [...document.querySelectorAll('main > section')];
  const rows = sections.map((s) => {
    const name = s.dataset.section || s.className.split(' ')[0] || s.tagName;
    const sr = s.getBoundingClientRect();
    const box = s.querySelector('.wrap, .container') || s;
    const bcs = getComputedStyle(box);
    const inner = box.getBoundingClientRect().width - px(bcs.paddingLeft) - px(bcs.paddingRight);
    // Columns: the shallowest row of side-by-side children (vertical ranges overlap, horizontal
    // ranges do not) that fills at least 60% of the content width. Breadth-first, so the page
    // grid wins over a table or card row nested inside one of its columns.
    let cols = [];
    const queue = [box];
    while (queue.length && !cols.length) {
      const el = queue.shift();
      const kids = [...el.children]
        .map((k) => ({ k, r: k.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 80 && r.height > 0);
      if (kids.length >= 2) {
        const first = kids[0].r;
        const row = kids.filter(
          ({ r }) => r.top < first.bottom && r.bottom > first.top,
        );
        row.sort((a, b) => a.r.left - b.r.left);
        const disjoint = row.every((c, i) => i === 0 || c.r.left >= row[i - 1].r.right - 1);
        const widths = row.map(({ r }) => Math.round(r.width));
        const sum = widths.reduce((x, y) => x + y, 0);
        if (row.length >= 2 && disjoint && sum >= inner * 0.6) cols = widths;
      }
      queue.push(...el.children);
    }
    const top2 = [...cols].sort((a, b) => b - a).slice(0, 2);
    const ratio = top2.length === 2 ? top2[0] / top2[1] : null;
    const head = s.querySelector('h1, h2');
    const body = s.querySelector('p');
    const bodyW = body ? body.getBoundingClientRect().width : 0;
    const flags = [];
    if (ratio && cols.length === 2 && Math.abs(ratio - 1) < 0.05) flags.push('50/50 split');
    if (!ratio && body && bodyW < inner * 0.55)
      flags.push('empty side: one column under 55% of the content width');
    if (body) {
      // Rough measure: an average glyph is about half the font size wide.
      const chars = bodyW / (Number.parseFloat(getComputedStyle(body).fontSize) * 0.5);
      if (chars > 80) flags.push(`measure ~${Math.round(chars)}ch > 75`);
    }
    const lh = body
      ? Number.parseFloat(getComputedStyle(body).lineHeight) /
        Number.parseFloat(getComputedStyle(body).fontSize)
      : 0;
    return {
      name,
      top: Math.round(sr.top + window.scrollY),
      height: Math.round(sr.height),
      padY: `${px(getComputedStyle(s).paddingTop)}/${px(getComputedStyle(s).paddingBottom)}`,
      cols: cols.join('|') || '-',
      ratio: ratio ? ratio.toFixed(3) : '-',
      phiDelta: ratio ? Math.abs(ratio - phi).toFixed(3) : '-',
      head: head ? `${head.tagName} ${px(getComputedStyle(head).fontSize)}px` : '-',
      body: body ? `${px(getComputedStyle(body).fontSize)}px/${lh.toFixed(2)}` : '-',
      flags,
    };
  });
  // First viewport: the first visible primary action inside <main>.
  const cta = [...document.querySelectorAll('main .btn--primary, main a.btn, main button.btn')].find(
    (b) => b.getBoundingClientRect().height > 0,
  );
  return {
    rows,
    vh: window.innerHeight,
    ctaBottom: cta ? Math.round(cta.getBoundingClientRect().bottom) : null,
  };
}, PHI);

for (const r of report.rows) {
  const flags = r.flags.length ? `  ! ${r.flags.join('; ')}` : '';
  console.log(
    `${r.name.padEnd(18)} y${String(r.top).padStart(6)} h${String(r.height).padStart(5)} ` +
      `pad ${r.padY.padEnd(8)} cols ${r.cols.padEnd(12)} ratio ${r.ratio} (phiΔ ${r.phiDelta})  ` +
      `${r.head}  body ${r.body}${flags}`,
  );
}
const multi = report.rows.filter((r) => r.ratio !== '-');
const golden = multi.filter((r) => Number(r.phiDelta) <= 0.05);
const fold =
  report.ctaBottom && report.ctaBottom > report.vh ? '  ! primary action below the fold' : '';
console.log(
  `\nsummary: ${golden.length}/${multi.length} multi-column sections within 0.05 of phi; ` +
    `first viewport ${report.vh}px, first primary action ends at ${report.ctaBottom ?? 'none'}px${fold}`,
);
await browser.close();
