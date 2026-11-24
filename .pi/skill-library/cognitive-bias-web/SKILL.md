---
name: cognitive-bias-web
description: Applies cognitive biases to website copy and page design through the Cognitive Bias Codex's four visitor problems (too much information, not enough meaning, need to act fast, what to remember), covering framing, anchoring, decoy pricing, loss aversion, labor illusion, cognitive fluency, zero-risk and serial position. Use when the user asks to write or audit headlines, hero sections, pricing tables, value props, or landing pages with cognitive biases or "conversion psychology". Not for Cialdini principles, social proof, similarity, scarcity or persuasion ethics (influence-psychology), Niggehoff motive audits (sales-psychology-audit), memorability (made-to-stick), or A/B test design (cro-methodology).
---

# Cognitive Bias Web

Use cognitive biases on a web page the way a conversion agency does: every change names the **bias** it uses, the **Codex problem** it solves for the visitor, and the **check** that would prove it. A bias without a check is a hypothesis, not a fix.

## Definition of Done

- The mode is stated: `write` (draft new copy or sections) or `audit` (score existing copy).
- The visitor, their desire, and what they fear losing are written in one sentence, marked `confirmed` or `hypothesis`.
- `audit`: all 4 Codex problems are scored 0-2, each with a verbatim quote.
- Every recommendation or drafted element carries: bias, Codex problem, before (verbatim, or "new"), after, check.
- Every real asset the user gave (customer count, ratings, guarantees, prices) is used or deliberately left out with a reason.
- Every number, testimonial, rating or claim the user did not give is a `[placeholder: ...]` and is listed under Human to-dos.
- Every anchor price, urgency or stock claim has passed the Honesty gate.

## Workflow

1. **Get the material.** Page text (MCP fetch tool, `max_length` 20000) or the user's brief: audience, offer, prices, proof that exists. If neither is reachable, ask for pasted text. Never work from memory of a site.
   Done when: the text or brief is quoted in your notes.
2. **Name the visitor.** Who pays, which core desire drives them (table below), and what they fear losing. Use the user's statement if given (`confirmed`), else infer from audience and offer (`hypothesis`).
   Done when: one sentence with the status mark.
3. **Run the four-problem check** (table below). `audit`: quote the page for each problem and score 0 (missing or works against the visitor), 1 (present but buried or weak), 2 (prominent and fits). `write`: assign each element you will draft to one problem.
   Done when: 4 rows filled.
4. **Pick biases** from the selector. Default: at most 2 biases per page element; the lowest-scoring problem first. Stacking every bias on one screen breaks cognitive fluency.
   Done when: each planned change names one primary bias.
5. **Draft before and after.** Keep the page's language, voice and form of address (du/Sie). Turn each real asset into its strongest framing before inventing anything.
   Done when: every change has all five fields.
6. **Run the Honesty gate** on every draft line.
   Done when: no line fails it.
7. **Write the output** with the template below. Give the user at most 10 lines of summary: visitor, lowest problem, top 3 changes.

## Core desires (step 2)

Survival and enjoyment of life · comfortable living · attraction and companionship · freedom from fear, pain and danger · status and winning · care and protection of loved ones · enjoyment of food and drink · social approval. (Life Force 8, Drew Eric Whitman.) Pick one dominant desire; a headline serves one.

## Four-problem check

| Codex problem | Visitor question in the first seconds | Where it lives on the page | Biases owned here |
| --- | --- | --- | --- |
| Too much information | "Is this for me? What stands out?" | Headline, hero, first screen | Framing, Von Restorff (one standout), picture superiority, contrast |
| Not enough meaning | "Why does it cost this? Is it real?" | Value props, process, story | Labor illusion, identifiable victim (one named story) |
| Need to act fast | "Is the next step easy and safe?" | CTA, pricing, form | Cognitive fluency, zero-risk, default, anchoring, decoy, loss aversion |
| What should we remember | "What will I tell someone later?" | Section order, last screen, thank-you page | Serial position, peak-end, chunking |

Social proof, similarity, authority, scarcity and urgency also act on these problems, but influence-psychology owns their rules. Name that skill in the output when a fix needs them; do not restate its principles.

## Bias selector

| Need on the page | Default bias | Copy pattern | Design pattern |
| --- | --- | --- | --- |
| Cost words ("price", "fee", "package") | Framing (gain) | "Your investment", "Join 1,200 teams who ..." | Show the outcome math: jobs, hours, money per year |
| Offer that prevents a loss | Loss aversion | "Stop losing X each month" | Cost-of-inaction line next to the price |
| Premium offer compared on price | Labor illusion | Steps, materials, decisions, and why each matters to the buyer | Value prop sections, process timeline |
| 3-tier pricing, push the middle | Anchoring, then decoy | Show the highest real reference first. A decoy is an added option close to the target and clearly worse; an existing cheaper plan is an anchor, not a decoy | Highlight the target plan; label it only with a true fact |
| Plan or option choice | Default | Recommended plan preselected | Preselected free option, never a paid add-on |
| Headline with 2+ ideas | Cognitive fluency | One idea, grade 6-8 reading level | Chunk into tabs, bullets, 3-5 items per group |
| Doubt next to the CTA | Zero-risk | A guarantee that removes one risk fully | Guarantee line directly under the button |
| Safety, health, cause | Identifiable victim | One named person's story instead of a statistic. A testimonial used as proof is social proof (influence-psychology), not this bias | Photo and name with consent |
| Long page | Serial position, peak-end | Strongest claim first and last | Close with the best proof, not the FAQ |

Read [references/bias-playbook.md](references/bias-playbook.md) when you need a worked example, the evidence strength of a bias, or real sites that use it.

## Honesty gate

Each line below is a hard rule. A draft that fails one gets rewritten, not hedged.

- **No invented facts.** Never invent numbers, ratings, testimonials, trials, guarantees or "most popular" labels. Write `[placeholder: real customer count]` and list it under Human to-dos.
- **Anchor prices must be real.** A "was" price in the EU must be the lowest price of the prior 30 days (Price Indication Directive, Art. 6a; Germany: PAngV section 11). Anchor with a real higher plan or the real annual total instead.
- **No fake urgency or stock.** A timer that resets per visitor or a stock count not tied to inventory is banned (EU UCPD Annex I No. 7; FTC deceptive practices). Offer a true deadline or a live stock number, and name influence-psychology for the ethics check.
- **No preselected paid extras.** Preselecting a paid add-on is not valid consent in the EU (Consumer Rights Directive, Art. 22). Preselect only the plan choice.
- **Superlatives and fear need proof.** "Strongest", "safest", "No. 1" and health or safety statistics need a source. Mark them `needs legal/source check` (UWG; HWG for health).

## Output

```markdown
# <write|audit>: <page or offer>
Source: <URL + fetch method, or "brief from user"> · date
Visitor: <who, desire, fear of loss> (<confirmed|hypothesis>)

## Four-problem check
| Problem | Score (audit) / element (write) | Evidence |

## Changes
### 1. <title> (<Codex problem>, impact high|medium|low)
Bias: <name>
Before: "<verbatim>" | new
After: "<copy>"
Check: <5-second test, reader question, or A/B test (design it with cro-methodology)>

## Honesty gate
<each anchor, urgency, stock, superlative or statistic, and how it passed>

## Human to-dos
- [placeholder: ...] <what to supply and where>
```
