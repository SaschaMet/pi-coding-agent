# Premium proportion (local addition, not upstream)

Read after [../reference/craft-floor.md](../reference/craft-floor.md) and before the first edit when the surface is **Persuade** (landing page, marketing, pricing) or the request names premium, high-end, expensive, golden ratio, hero, or first impression. The brief and the project's design system still win; this file says how to make a committed world read as expensive and how to prove it with numbers.

## 1. Phi is a coherence device, not a beauty proof

- Phi = 1.618…; 1/phi = 0.618; 1/phi² = 0.382. Claims that phi is inherently more beautiful rest on weak evidence, and the "divine proportion" story traces to an 18th-century misreading of Pacioli. Never put such a claim in copy or in a client explanation.
- What reads as premium is that **every** proportion comes from one ratio. Phi works well because its steps are clearly distinct (×1.618) and its half-steps (×√phi ≈ 1.272) give a usable type scale.
- Round to whole pixels, use Fibonacci/Lucas neighbours where they fit (7, 11, 18, 29, 47, 76, 123).

## 2. The system

Write these as named tokens in the project's token source (theme file, `:root`, design-system doc), never as one-off numbers.

| Axis | Rule | Example at 18px body |
| --- | --- | --- |
| Type | body × √phi per step, × phi every second step; display ≤ 6rem | 14 · 18 · 23 · 29 · 37 · 47 · 60 · 76 · 97 |
| Space | × phi per step | 7 · 11 · 18 · 29 · 47 · 76 · 123 |
| Rhythm | inside a group 1 step, between groups 2 steps, between sections the top step; heading → body one step more than paragraph → paragraph | 18 / 29–47 / 123 |
| Line height | body 1.618 at 16–18px; headings 0.98–1.1 | |
| Two columns | `minmax(0, 1fr) minmax(0, 1.618fr)` (38.2 / 61.8), gap one large step | 466 \| 754 in 1296 |
| Text section | heading in the short column (one step smaller, sticky), text in the long column capped at 65ch; no empty half beside a 60ch column | |
| Copy + media | copy on the long side, media on the short side; 50/50 only when both sides are equals (before/after) | |
| Single block | a lone card, form or quote = container ÷ phi | 801 in 1296 |
| Media | golden rectangle, 1 : 1.618 portrait or 1.618 : 1 landscape, `object-fit: cover` | |
| First viewport | full-height hero: space above the content block : below = 1 : phi, so the block sits on the upper golden section | 76 / 123 |

Mobile collapses to one column; the type and space scale still apply.

## 3. The hero builds the halo

Halo effect (Thorndike, 1920): one strong first impression colours every later judgement. Warmth is a central trait that shifts how all other traits are read (Asch, 1946), and small craft cues stand in for quality. The horn effect works the same way down. So the first viewport gets the most care:

- **One dominant element.** The headline takes the top step of the scale; nothing else competes in size or colour.
- **One sentence of mechanism.** What happens and how, ≤ 34em. A second paragraph is a wall; move it down or turn it into proof.
- **A person behind the promise.** A signed line, a portrait, a name with a credential, set quieter than the lede (short accent rule, body size, softer ink). Real only: never invent proof (RULES rule 11).
- **One primary action, above the fold** at 1440×900 and 390×844. If a larger headline pushes it down, take the space from the gaps (one phi step down), not from the headline.
- **Free craft cues:** balanced headings (`text-wrap: balance`), themed `::selection` and focus ring, lining numerals in serif figures, one rule length, sentence case instead of tracked capitals for proof chips.
- **Kill horn triggers first:** visible placeholders, shouting capitals, a cookie banner over the action, misaligned edges, a stock-looking image in the first viewport.

## 4. Design for the decision

Information overload, analysis paralysis and decision fatigue stall a decision. Layout can lower the load:

- One primary action per viewport; repeated calls to action share one label and one look. A secondary action (talk first) is visibly quieter.
- Progressive disclosure: reason first, detail later (cost tables, FAQ, terms) in the long column or an accordion.
- Few things to compare at once; a price sits with its anchor as a plain fact.
- Anchoring, framing and social proof are shown honestly. Ethics and law (UWG, HWG) belong to `influence-psychology`: no countdowns, fake scarcity, or invented proof.

## 5. Verify with numbers

Before the first edit and after the last, from the project root (offline, localhost only):

```bash
node ~/.pi/agent/skill-library/impeccable/local/measure-proportions.mjs <local-url> 1440 900
node ~/.pi/agent/skill-library/impeccable/local/measure-proportions.mjs <local-url> 390 844
```

Set `MEASURE_INIT_SCRIPT` to pre-seed the project's consent state, so the banner does not cover the first viewport. Pass when:

- every two-column section is within 0.05 of phi, or the summary names why not (equal content, a 3-up sequence);
- no text section carries the "empty side" flag;
- the first primary action ends above the fold at both sizes;
- no body measure flag (> 75ch).

Put the before/after summaries in the change summary. Then the batched screenshots (RULES rule 14), then the detector.

## 6. Pitfalls seen in practice

- **Pack contract tests** may split selectors on commas or check a scope prefix per line: avoid `:is(a, b)` in scoped selectors, and keep a selector short enough that the formatter does not wrap it (set a custom property in a short rule, read it in the long one).
- **CMS spacing knobs** (section padding chosen by an editor) stay; change the inner rhythm, not the editor's outer spacing.
- **Centred grid columns** start at different tops; compare vertical ranges, not top edges, when measuring.
- **A global grid change** reaches every page on that theme: screenshot the home page and one text-heavy page as regression checks.
