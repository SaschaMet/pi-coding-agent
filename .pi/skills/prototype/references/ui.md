# UI Prototype

Generate **several radically different UI variations** on a single route, switchable from a floating bottom bar. The user flips between variants in the browser, picks one (or steals bits from each), and throws the rest away.

Wrong branch if the question is about logic or state — use [logic.md](logic.md).

## When this is the right shape

- "What should this page look like?"
- "I want to see a few options for this dashboard before committing."
- "Try a different layout for the settings screen."
- Any time the user would otherwise spend a day picking between three vague mockups in their head.

## Two sub-shapes — strongly prefer A

A UI prototype is far easier to judge when it butts up against the rest of the app: real header, real sidebar, real data, real density. A throwaway route on its own is a vacuum where every variant looks fine.

- **Sub-shape A — inside an existing page (default).** Variants render on the same route, gated by a `?variant=` search param. Existing data fetching, params, and auth stay; only the rendering swaps. Something that has no page yet but would naturally live inside one — a new dashboard section, a new settings card, a new step in a flow — is still sub-shape A. Mount the variants in the host page.
- **Sub-shape B — a new page (last resort).** Only when the thing genuinely has no existing page to live inside. Create a throwaway route following the project's routing convention, with `prototype` in the path or filename. Same `?variant=` pattern. Before committing to B, sanity-check that there really is no host page — an empty route hides design problems a populated one exposes.

The floating bottom bar is identical in both.

## Process

### 1. State the question and pick N

Default to **3 variants**; cap at 5, past which they stop being radically different and start being noise. Write the plan in one line at the top of the file:

> "Three variants of the settings page, switchable via `?variant=`, on the existing `/settings` route."

### 2. Generate radically different variants

Hold each variant to the page's purpose and available data, and to the project's component library and styling system. Give each a clear exported name (`VariantA`, `VariantB`, `VariantC`).

Variants must be **structurally different** — different layout, different information hierarchy, different primary affordance. Not different colours. Three slightly-tweaked card grids isn't a UI prototype, it's wallpaper. If two drafts come out similar, redo one with explicit "do not use a card grid" guidance.

### 3. Wire them together

One switcher component on the route:

```tsx
// pseudo-code — adapt to the project's framework
const variant = searchParams.get('variant') ?? 'A';
return (
  <>
    {variant === 'A' && <VariantA {...data} />}
    {variant === 'B' && <VariantB {...data} />}
    {variant === 'C' && <VariantC {...data} />}
    <PrototypeSwitcher variants={['A','B','C']} current={variant} />
  </>
);
```

Sub-shape A keeps all existing data fetching above the switcher; only the rendered subtree changes per variant.

### 4. Build the floating switcher

A small fixed bar at bottom-centre with three pieces: a left arrow (previous variant, wrapping), the current variant key plus its name if it exports one (`B — Sidebar layout`), and a right arrow (forward, wrapping).

- Arrows update the URL search param through the framework's router, so the variant is shareable and reload-stable.
- `←` and `→` also cycle — but never intercept them while an `<input>`, `<textarea>`, or `[contenteditable]` has focus.
- Visually distinct from the page (high-contrast pill, subtle shadow) so it is obviously not part of the design being evaluated.
- **Hidden in production builds** — gate on `process.env.NODE_ENV !== 'production'` or equivalent, so a stray merge can't ship the bar to users.

Put the switcher in one shared component both sub-shapes reuse.

### 5. Hand it over

Surface the URL and the `?variant=` keys. The most useful feedback is usually "I want the header from B with the sidebar from C" — that's the actual design they want.

### 6. Capture the answer and clean up

Capture which variant won and why, then capture the prototype as `SKILL.md` describes. Fold the winner into the real code; the full variant set is the primary source, so it lands on the throwaway branch, not the bin.

- **Sub-shape A** — fold the winner into the existing page; drop the losing variants and the switcher from main.
- **Sub-shape B** — promote the winner to a real route; drop the throwaway route and the switcher from main.

Variant components and switchers left in main rot fast and confuse the next reader.

## Anti-patterns

- **Variants that differ only in colour or copy.** That's a tweak. Real variants disagree about structure.
- **Sharing too much between variants.** A shared `<Header>` is fine; a shared `<Layout>` defeats the point — each variant should be free to throw out the layout.
- **Wiring variants to real mutations.** Read-only is fine; point at a stub. The question is what it should look like, not whether the backend works.
