---
name: improve-writing
description: Rewrite an existing piece of non-fiction so it is structured the way readers actually read — essays, articles, reports, memos, emails, landing pages, documentation, newsletters, posts. Use this skill whenever the user asks to improve, edit, rewrite, tighten, restructure, polish, or "make better" a draft; whenever they ask why their writing is unclear, confusing, boring, flat, too long, or "not landing"; whenever they hand over notes, bullet points, or a transcript and want a finished piece; and whenever they ask you to write a non-fiction piece from scratch. Also use it when they mention clarity, flow, structure, coherence, voice, tone, hooks, or introductions. It applies reader-psychology frameworks — Index and Discussion, Topic and Comment, problem-first introductions, Key Terms — instead of surface-level style tips, so prefer it over ad-hoc editing even when the user asks only for a "quick pass".
---

# Improve Writing

## The job

**One job: rewrite the text you were given so it reads the way readers read. Not a better argument. Not a more complete page. The same substance, delivered properly.**

This boundary is the whole discipline of the skill, and it is easy to lose. Diagnosis surfaces real problems that are not yours to solve — a missing call to action, absent proof, an argument that would land harder reframed. Those findings are valuable and you must report them. **You must not act on them.** The author knows things about their reader, their market and their offer that are not in the text, and a change that looks obviously right from the page can invert what they meant.

> **A recommendation you apply without asking is not help. It is a rewrite of their thinking wearing the clothes of an edit.**

**The underlying reason the whole method works:**

> Coherence is not a property of the text. It is an experience the reader creates. So you cannot check writing by re-reading and asking whether it feels clear — to whoever wrote it, it always does. You check it against the places readers expect to find things.

That is why this skill measures before it judges, and asks before it changes anything that carries meaning.

## Two classes of change

Every edit you are about to make is one of these. Learn the line; it governs everything below.

### Text-level — do these without asking

They change **how** the piece says what it says. The substance is untouched.

- Sentence mechanics: characters into subjects, actions into verbs, nominalizations, the runway, end-weight, long introductory clauses, verb near object
- Information order **within** a sentence or paragraph; topic positions; handoffs between adjacent sentences
- Cutting meta-discourse, hedges, filler, clichés
- Grammar, agreement, number, typography, punctuation of quotations
- Formatting what is already there: turning a run of lines into a list, bolding an existing label
- Making an existing term consistent with the author's own usage elsewhere in the same text

### Substance-level — propose, never apply unsolicited

They change **what** the piece says, claims, or contains.

- Adding **any** claim, example, statistic, quote, anecdote, scene, or section
- Removing a claim, section, or heading — including one that looks redundant
- Reordering, merging or splitting sections; renaming a framework or its steps
- Changing the Point, the status quo it displaces, the stated cost, or the argument's shape
- Adding a call to action, price, offer, guarantee, or next step
- Anything asserting something about the author's business, market, audience, offer or results
- Changing how the author addresses their reader — person, gender, formality, the name they use for their own clients

**When in doubt, it is substance-level.** The cost of asking is one message. The cost of guessing is a page that misrepresents the author to their own audience.

## The workflow

### Step 1 — Gate, part one: the brief

Settle four things before analysing anything.

**a. What is the input?**

| Input | Mode |
|---|---|
| A finished or half-finished draft | **Improve** — diagnose, then revise |
| Notes, bullets, a transcript, a voice memo | **Build** — no draft yet; construct one from this material only |
| A topic and no text | **Draft** — start from the frame |
| A request for critique | **Review** — diagnose and report, change nothing |

**b. What is the voice instruction?** A real decision, not a default.

| Situation | Voice mode | What you do |
|---|---|---|
| Draft already sounds like a person | **Preserve** | Fix structure and information order. Leave register, vocabulary and idiom alone. |
| Input is notes, bullets or a transcript | **Establish** | No voice exists yet — you must add one. Read `references/07-voice.md` and choose deliberately. |
| Writing as or for someone, or to a house style | **Match** | Work from samples or a transcript. Find the one or two attributes that carry the voice. |

**c. Who is the reader, and what do they already believe?** Ask if the text does not make it plain. Without this you cannot judge whether the piece establishes a cost.

**d. What is the piece for, and what must not change?** Publication, an internal decision, a sales page and a status update have different obligations. Ask what is fixed: claims, structure, legal constraints, terminology.

### Step 2 — Measure

```bash
python3 scripts/diagnose.py DRAFT.md          # readable report
python3 scripts/diagnose.py DRAFT.md --full   # long lists, untruncated
python3 scripts/diagnose.py DRAFT.md --json   # machine-readable
```

It counts what is countable: the skim-test skeleton, the topic strip, cohesion handoffs, subject-verb gaps, nominalizations, meta-discourse, long introductory clauses, Key Term threading. Stdlib only.

**The numbers are pointers, not verdicts.** A flagged passive that puts old information first is correct and stays. `references/01-diagnose.md` explains each block, gives the manual version, and names the checks no script can make.

### Step 3 — Diagnose

Work down this list. A fault high up makes everything below it irrelevant — there is no point fixing rhythm in a piece with no problem statement.

1. **Value** — does it solve a problem this reader cares about, or cover a topic? → `06-story-and-value.md`
2. **The Point** — one central claim, displacing something the reader believes? → `03-introduction.md`
3. **Structure** — does each unit's Index state its point and name its Key Terms? Run the skim test. → `02-structure.md`
4. **Threading** — does each Discussion develop the terms its Index announced? → `04-paragraphs.md`
5. **Paragraph patterns** — does each paragraph's pattern fit its job? → `04-paragraphs.md`
6. **Sentences** — characters in subjects, actions in verbs, complexity at the end, handoffs intact. → `05-sentences.md`
7. **Voice** — consistent with the mode from step 1. → `07-voice.md`

Sort every finding into text-level or substance-level as you go. You are building the proposal for the next step.

### Step 4 — Gate, part two: propose, then wait

**This is the step that keeps the skill honest. Do not skip it, and do not fold it into the report at the end — by then the damage is done.**

Present, using `assets/change-proposal-template.md`:

1. **What I will fix without asking** — the text-level list, summarised by kind, not itemised line by line.
2. **What I recommend but will not touch** — each substance-level finding: what you found, why it costs the reader, what you would do, and what it would change about the author's meaning. **Numbered, so they can answer "1 and 3, not 2".**
3. **What I need from you** — at most three questions, each with your best-guess default. Ask only what changes the output.
4. **What I am assuming** — anything you inferred rather than confirmed.

Then stop and wait for an answer.

**If nobody can answer** — a scheduled run, an offline user, an explicit "just do it" — apply the text-level changes only, leave every substance-level item as a labelled gap in place, and say at the top exactly what you left alone and why. **Silence is never consent for a substance-level change.**

### Step 5 — Frame

Only after approval. Write these before touching prose; they are your delete rule.

```
POINT:      the one thing the reader should walk away believing
STATUS QUO: the belief this Point displaces, in the reader's own words
COST:       what it costs this reader to keep believing it
READER:     who they are and what they already care about
```

**Derive all four from the text and from what the author told you. Never from what would make a stronger page.** If the text does not supply one, that is a gap to name, not a blank to fill.

### Step 6 — Restructure

Only what step 4 approved. → `02-structure.md`

### Step 7 — Rewrite

Paragraph level, then sentence level. → `04-paragraphs.md`, then `05-sentences.md`. Use `06-story-and-value.md` to judge whether an example or scene *works*, not as a licence to invent one.

### Step 8 — Verify and report

Re-run the script. Walk the exit checklist in `08-checklists.md`. Report with `assets/report-template.md`: what you changed, what you deliberately left alone, and the gaps still open. **No new recommendations at this stage** — if you found something in the rewrite that belongs in a proposal, say so as a proposal for a next pass, not as something you already did.

## The rule that outranks everything

**Never invent content.** No fabricated example, statistic, quote, source, anecdote, scene, or claim — and no invented assertion about the author's business, market, audience, offer, or results. Where the method calls for material the author has not supplied, **name the gap in place and ask.**

This is not caution for its own sake. Style and substance are not two layers; you cannot paint clear prose over an idea that is not there. Fluent text on invented substance is the exact failure that makes readers stop trusting a writer — polished, plausible, hollow. **A named gap is worth more to the author than a confident fabrication, and far more than a plausible sentence that reverses what they meant.**

## Reference map

Read a reference when you reach the step that needs it. Do not preload everything.

| File | Read it when | Contains |
|---|---|---|
| `references/01-diagnose.md` | Steps 2–3, every time | How to read each script block; the manual version; what the script cannot see |
| `references/02-structure.md` | Structural problems | The levels; Index + Discussion; fractals; Point placement; the skim test |
| `references/03-introduction.md` | Openings, weak value, no Point | Six intro slots; invert-the-Point; cost; awareness levels; titles |
| `references/04-paragraphs.md` | Choppy or incoherent passages | Topic and Comment; the four patterns; Key Terms; thematic strings |
| `references/05-sentences.md` | Line editing | Characters and actions; nominalizations; the runway; handoffs; end-weight |
| `references/06-story-and-value.md` | Dry, abstract, unpersuasive | Question over topic; judgment; foreground; time; bridges; memory; devices |
| `references/07-voice.md` | Voice mode is Establish or Match | Voice as relationship; five archetypes; the transcript method; register |
| `references/08-checklists.md` | Steps 1, 4 and 8 | Gate checklist; proposal checklist; edit pass; exit QA; letter-of-response |
| `references/09-lineage.md` | Citing a source | Where each idea comes from |
| `assets/change-proposal-template.md` | Step 4 | The proposal format |
| `assets/report-template.md` | Step 8 | The report format |

## Output

**Step 4:** the proposal. Nothing else.

**Step 8:** the revised piece, then a short report — the changes that mattered, what you left alone, the open gaps. Keep it proportionate; a long report on a short piece is noise.

**Review mode:** the report only, in the letter-of-response order from `08-checklists.md` — what the piece is trying to do → what works and is worth keeping → then what is missing. That order is not politeness. If you have not shown you understood the intent, the author has no reason to accept the criticism.
