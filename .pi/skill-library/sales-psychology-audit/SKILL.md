---
name: sales-psychology-audit
description: Audits a website or landing page against Matthias Niggehoff's sales psychology (Verkaufspsychologie) — buyer motive fit, comparability, hook, framing, specificity, proof — and returns ranked recommendations with before/after copy. Use when the user asks for a Niggehoff-style, sales-psychology, or motive-based audit of a site, page, or its copy. Not for A/B test design or funnel analytics (improve-website, cro-methodology), page structure (storybrand-messaging), or building pages.
---

# Sales Psychology Audit

Audit one site's copy the way Matthias Niggehoff would: find the buyer's dominant **motive**, then check whether every word, proof, and call to action serves it. Output is a report with ranked recommendations. **Audit only**: never edit the audited site or its code.

## Definition of Done

- Every audited page is listed with how it was fetched.
- One dominant buyer motive is named with at least 3 verbatim quotes, marked `confirmed` (user said so) or `hypothesis`.
- All 8 lenses are scored 0-2, each with a verbatim quote as evidence.
- 5-10 recommendations, ranked, each with lens, principle, before → after copy, and a check.
- The report is written to `docs/audits/<site-slug>/sales-psychology-audit.md` in the current project.

## Workflow

1. **Fetch the pages.** The given URL, plus up to 3 key pages it links to (offer, about, contact) when the user gave a whole site. Pick the method from the table below.
   Done when: every page is listed with URL, method, and any failure.
2. **Load the knowledge base.** Read [references/niggehoff-principles.md](references/niggehoff-principles.md) in full.
   Done when: you can name the four motives and their "repels it" column without looking.
3. **Profile the buyer's motive.** Who pays? Map the page's audience to one dominant motive (red, blue, green, yellow) and at most one secondary. If the user named a motive, use it and mark it `confirmed`; do not second-guess it. Otherwise collect evidence (audience, industry, the problem they buy for) and mark it `hypothesis`.
   Separately note which motive the **current copy** serves. The gap between the two is lens 1.
   Done when: the dominant motive, its status, and 3+ quotes are written down.
4. **Score the 8 lenses** (table below) with these anchors. Quote the page verbatim for every score; a score without a quote does not count.
   - **0**: missing, or it works against the dominant motive.
   - **1**: present but weak: buried below the first screen, said once, or mixed with a clash.
   - **2**: present, prominent (first screen or repeated), and fits the motive. Minor polish still allowed.
   If six or more lenses share one score, re-check each against the anchors before moving on.
   Done when: 8 rows, 8 quotes.
5. **List what already works.** Name 3-5 passages to keep, so the fixes do not break them.
   Done when: 3-5 verbatim quotes, each with one line on why it works.
6. **Write recommendations.** Rank by impact on the dominant motive first, effort second. Each item: lens number, principle (heading in the knowledge base), the verbatim **before**, a proposed **after** in the site's language and form of address (du/Sie), why, and how to check it (5-second test, A/B test, or reader question).
   Done when: 5-10 items, each with all fields.
7. **Write the report** using the template below, then give the user a summary of at most 10 lines: the motive, the 3 lowest lenses, and the top 3 recommendations.
   Done when: the report file exists, every template section is filled or says "none", and the summary is 10 lines or fewer.

### Fetch method

| Situation | Method |
| --- | --- |
| Public URL | MCP fetch tool, `max_length` 20000 per page |
| Fetch refused by `robots.txt` (common for `/lp/` paths), or the page needs JavaScript | Playwright MCP: `browser_navigate`, then `browser_evaluate` returning headings, CTA texts, image alt texts, and `document.body.innerText` |
| `localhost` URL | Bash is sandboxed and cannot reach local ports. Use Playwright with `host.docker.internal` in place of `localhost` |
| Nothing reaches the page | Ask the user to paste the text or give a saved HTML file. Do not audit from memory or search snippets |

Write the extracted text to `$TMPDIR` if a subagent needs it.

## Lenses

| # | Lens | Question | Evidence to quote |
| --- | --- | --- | --- |
| 1 | Motive fit | Do the words, proof, and tone serve the buyer's dominant motive, and avoid what repels it? | 2 sentences: one that fits, one that clashes |
| 2 | Comparability | Swap the logo for a competitor's: would the hero still be true? | Hero headline and first sentence |
| 3 | Hook | Is there one short core sentence, memorable and repeated? | The sentence, or "none found" |
| 4 | Motives over features | Does each benefit bullet answer "so what?" for this motive? | The 3 most feature-like bullets |
| 5 | Specificity | Provable numbers, names, and dates instead of vague adjectives? | Count of vague claims plus 2 examples |
| 6 | Proof first | Is the strongest proof for this motive near the headline? | The strongest proof and its position |
| 7 | Framing | Do CTAs and offer names say what the visitor gets or becomes? | Every distinct CTA text |
| 8 | Named method | Does the offer have its own name and visible steps? | The name and steps, or "none" |

## Gotchas

- **Never invent numbers, clients, testimonials, or market prices.** Write `[Platzhalter: Anzahl Kundinnen]` in the after-copy and list each placeholder as a human to-do.
- **Placeholders already on the page** (`[Datum]`, `[Betrag]`) mean the draft is unfinished. List them only under "Draft gaps". Leave them out of every score and every recommendation; score the copy that exists.
- **Urgency and scarcity are not default fixes.** They repel green and blue buyers. Recommend them only for red or yellow, and only with real limits. Ethics and regulation (UWG; HWG for health offers) belong to influence-psychology; name it when a fix needs that check.
- **Do not call the audit "Neuroprofiling".** The method is proprietary. Call it "motive-based audit after Niggehoff's published principles".
- **Color advice is a hypothesis.** Mark it so and pair it with a test.
- **Copy his principles, not his site.** His homepage uses superlatives and a 40-testimonial wall. Do not recommend those; see the last section of the knowledge base.
- **Keep the site's voice.** Match du/Sie, gendering, and sentence length in every after-copy.

## Report template

```markdown
# Sales psychology audit: <page title>
URL(s) and fetch method · date · basis: Niggehoff's published principles (not Neuroprofiling)

## Buyer motive
Dominant: <motive> (<confirmed|hypothesis>) · secondary: <motive or none>
Evidence: "<quote>", "<quote>", "<quote>"
Current copy serves: <motive> → gap: <one sentence>

## Scores
| # | Lens | Score | Evidence | Note |

## Keep
- "<quote>" — why it works

## Recommendations
### 1. <title> (lens N, impact high/medium/low, effort S/M/L)
Principle: <knowledge-base heading>
Before: "<verbatim>"
After: "<proposed copy>"
Why: <one sentence tied to the motive>
Check: <how to verify>

## Draft gaps
## Human to-dos (placeholders to fill, claims to verify)
```

## Adjacent skills

For evidence-backed funnel work and A/B test design, hand off to improve-website or cro-methodology. For page order and the one-liner, use storybrand-messaging. For Cialdini's principles and the persuasion-ethics check, use influence-psychology. Name the skill in the report; do not run it unasked.
