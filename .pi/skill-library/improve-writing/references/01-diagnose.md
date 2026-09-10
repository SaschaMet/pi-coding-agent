# 01 — Diagnose

How to read `scripts/diagnose.py`, how to run the same checks by hand, and what no script can see.

## The stance

You are looking for **where readers will stumble**, not for rule violations.

**A finding is not a licence to act.** Diagnosis produces two kinds of result, and they have different destinations: text-level faults you repair yourself, and substance-level faults you write into the step-4 proposal and leave alone until the author answers. Sort as you go. The satisfying ones — a missing call to action, absent proof, an argument that would land harder reframed — are almost always the second kind. Every number the script prints is a place to look. Some flagged items are correct as written and should stay. If you cannot say which reader experience a change improves, do not make the change.

Two facts shape everything:

- **You cannot proofread for coherence.** When anyone re-reads their own text they are remembering it, not reading it. The words recall the idea because the writer chose them for that idea. This is why the checks below are mechanical: they substitute for the outside reader you do not have.
- **A missing structure does not leave the reader blank.** Readers hunt for a pattern and supply one you never intended. Unstructured writing produces a *wrong* idea, not an absent one.

## Reading the script output

### OUTLINE

The headings, in order. Headings set the context a reader interprets the section in, so they must make sense **now**, not in retrospect. Build them from the concepts that actually recur inside the section. A cryptic, abstract, or joke heading is a fault even when the section beneath it is good.

### SKIM TEST — the highest-value block

The first sentence of each paragraph, in order. **Read only these.** If that skeleton outlines the whole story, the structure works. If it does not, no amount of sentence polishing will save the piece — go to `02-structure.md` and fix the Index of each unit.

Common failures visible here:

- An index sentence that announces the text instead of the content ("In this section I will discuss…").
- An index sentence that is really a detail from the middle of the paragraph.
- A skeleton that reads as a list of unrelated facts — the paragraphs have no unit above them.

### TOPIC STRIP

The opening words of every sentence — approximately, up to the first verb. Read only this list and ask two questions:

1. Do these name a **small set of related, important characters**? Not "could I see how they relate" — you wrote it, you always can. Would a reader?
2. Can you say what the passage is about from this list alone?

If the strip wanders — *Portland, the aroma, the machines, his typewriter, I, this preference* — the passage is incoherent even if every sentence is clean and every handoff works. Fix by making subjects name the topic and putting them near the front. → `04-paragraphs.md`

### COHESION — POSSIBLE HANDOFF BREAKS

Sentence pairs where the start of the second picks up nothing from the end of the first. The script counts repetition, shared stems, and pointing pronouns as links.

**It cannot detect synonyms.** "…running on his **computer**. **The machine**, a Royal McBee…" is a perfect handoff that will be reported as a break. So read every flagged pair before touching it. What you are hunting is the choppy start-stop rhythm where each sentence is fine alone and the sequence jerks the reader forward and back.

A low link rate with a *consistent* topic strip is usually fine — that is the Constant Theme pattern, which links by repeating the topic rather than by chaining. A low link rate **and** a wandering topic strip is the real problem.

### LONG SUBJECT-VERB GAP

Words the reader must hold before the verb arrives. Readers get through complicated material easily once they have momentum from the first nine or ten words; obstacles on the runway stop the plane taking off. Move the core clause to the front and let the details hitch on behind. → `05-sentences.md`

### SENTENCES 40+ WORDS

Not wrong, but worth reading aloud. Long is fine **after** the verb, when the sentence is well built.

### LONG INTRODUCTORY CLAUSES

A subordinate clause of eight or more words before the main clause. Move it to the end, or split it out. The reader should reach your point before spending their memory.

### NOMINALIZATION CANDIDATES

Actions construed as nouns — *investigate → investigation*. They make prose abstract and force flabby verbs (*was undertaken*, *took place*, *resulted in*).

**Four keep-reasons.** A nominalization earns its place if it:

1. Sits in the subject position to link back to the previous sentence ("Their **discovery**…").
2. Replaces *the fact that* / *the idea that*.
3. Turns a clause into a concrete object ("I approved his **proposal**").
4. Names a concept so familiar to this reader that it functions as a character ("the greenhouse **effect**").

Otherwise turn it back into a verb and give it a character: *"There is a need for an examination of the strategy"* → *"We need to examine the strategy."*

Note the limit on reason 3: nominalizations work as objects, not as subjects. *"His proposal arrived after the deadline"* is awkward — proposals do not arrive, people do.

### PASSIVE VOICE — informational, not an error

Keep every passive that puts old information at the front of the sentence. It is the tool that makes a handoff work. Cut the ones that only hide who acted. The rule is old-to-new, never active-versus-passive.

### META-DISCOURSE

Writing about writing: *this section discusses*, *the preceding paragraph demonstrates*, *the final topic to be discussed*. It is a hangover from an era when speeches needed to keep a live audience oriented.

Three replacements, in order of preference:

1. **A question.** "Chapter 2 discusses the social factors behind declining birth rates" → "What social factors make birth rates decline?"
2. **Visual language.** "As we have seen, economic conditions play a significant role." Seeing implies seers, so writer and reader become the characters instead of units of text.
3. **Shared movement.** "Now that we have seen X, we arrive at Y." / "Let's finish with policy responses."

Heavy signposting is also a **symptom**: it means the structure is organised by the writer's private associations and the writer is manually patching every logical gap. Repair the structure rather than adding another sign.

Ordinal markers that help a reader track previewed themes across a long section (*first, second, third*) are structural aids, not meta-discourse. Keep those.

### FLABBY CONSTRUCTIONS

*there is / there are*, *took place*, *occurred*, *resulted in*, *the fact that*, *in order to*, *on the part of*. Each usually hides a character and an action. Find who did what.

### HEDGES AND FILLER / -LY ADVERBS

Two readings depending on voice mode. In **Preserve** mode, trim only what dulls a sentence. In **Establish** mode these are dials: adverbs and intensifiers up for a strongly opinionated register, down for a facts-first one. → `07-voice.md`

### KEY TERMS

The most frequent content words — the threads a reader actually experiences as coherence. Check that the top terms are the ones you *want* the piece to be about. A piece whose most frequent word is incidental is a piece about nothing.

### PARAGRAPH THREADING

For each paragraph: which terms the index sentence announced, and which of those the rest of the paragraph developed. **Dropped terms are broken promises.** The reader was told what the unit was about and then given something else. Either develop the term or stop announcing it.

## Language

The script's word lists are **English**: the nominalization suffixes, meta-discourse phrases, stopwords, participles and hedges. On a text in another language the language-independent blocks still work — outline, skim test, sentence lengths, paragraph and sentence counts, duplicate detection — and everything driven by vocabulary is unreliable. Run it, use what transfers, and do the vocabulary checks by hand with that language's own forms. German nominalizations, for instance, end in *-ung, -heit, -keit, -nis, -schaft, -tion, -ität*.

Some rules do not transfer at all. A long introductory clause is a real cost in English, where the reader waits for a verb; German front-field subordinate clauses are idiomatic and deliver the verb immediately after the comma. **When a rule and the reader's actual experience disagree, the reader wins — and say so in your report.**

## The manual version

No script available? Do this by hand, in this order:

1. **Copy out the first sentence of every paragraph** into a list. Read only that. Does it tell the story?
2. **Copy out the first six to eight words of every sentence.** Read only that. Small set of related, important characters?
3. **Read the piece aloud.** Two questions at every stumble: *can I say this in fewer words?* and *would this voice say this?* Reading aloud catches rhythm, clumsy handoffs, and out-of-character phrasing that silent reading hides.
4. **Body-scan any reaction you have.** "This part is boring" is data, not a verdict. Where does the boredom live? Which sentence is worst? How far does it extend? Locate it precisely before you try to fix it, the way you would locate a pain rather than getting up.
5. **Check every paragraph's opening promise against its body.**

## What no script can see

These are yours to judge, and they matter more than anything above:

- **Is there a problem the reader cares about?** A piece can pass every mechanical check and still be worthless. Clear and useless is useless.
- **Is the Point actually displacing a belief**, or restating something the reader already agrees with?
- **Is the material real?** Foreground detail, a named example, a specific number. If it is missing, that is a gap to report — never a gap to invent. → SKILL.md, rule 1.
- **Does anything get a payoff?** Set-ups without payoffs, or payoffs with no set-up.
- **Is the judgment present?** A piece with no evaluation is an encyclopedia entry.
- **Does the voice match the instruction from the gate?**
