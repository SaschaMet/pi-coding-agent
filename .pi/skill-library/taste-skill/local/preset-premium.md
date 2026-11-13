# Preset: premium

> Local file, not from upstream. Read only when the user asks for an expensive, premium, luxury, or
> Apple-like look. This file sets look values. Every ban, accessibility, performance, and
> pre-flight rule in `taste-skill` still applies; nothing here may break one.

**Core concept:** This preset decides how a single component is physically constructed. Premium
components are *nested enclosures*, not flat rectangles — machined hardware rather than boxes.

**Why it works:** Depth read at component scale is what separates an expensive interface from a
well-spaced one. A card sitting flatly on a background is the default; a card sitting in a tray is a
decision.

**The Double-Bezel (nested enclosure).** Never place a premium card, image, or container flatly on the
background.
- **Outer shell:** a wrapper with a subtle background (`bg-black/5` or `bg-white/5`), a hairline border (`ring-1 ring-black/5` or `border border-white/10`), tight padding (`p-1.5` or `p-2`), and a large radius (`rounded-[2rem]`).
- **Inner core:** its own background, its own inner highlight (`shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]`), and a **mathematically concentric** radius — `rounded-[calc(2rem-0.375rem)]`, outer radius minus the padding. Concentric curves are the tell that someone did the math.

**Button-in-Button trailing icon.** A button's arrow never sits naked beside the label. Nest it in its
own circular wrapper (`w-8 h-8 rounded-full bg-black/5 dark:bg-white/10 flex items-center
justify-center`), flush with the button's right inner padding. Primary buttons are `rounded-full` with
generous padding (`px-6 py-3`).

**Fluid Island nav.** Closed: a floating glass pill detached from the top (`mt-6 mx-auto w-max
rounded-full`) — not an edge-to-edge bar glued to the viewport. The hamburger **morphs**: its lines
rotate and translate into a true 'X' (`rotate-45` / `-rotate-45`, absolutely positioned) rather than
disappearing. Open: a screen-filling overlay with heavy glass (`backdrop-blur-3xl bg-black/80`), and
the links inside slide up out of an invisible box (`translate-y-12 opacity-0` → `translate-y-0
opacity-100`) on a stagger (`delay-100`, `delay-150`, `delay-200`).

**Eyebrow tags.** When `taste-skill`'s eyebrow limit allows one, style it as a microscopic pill
(`rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-medium`).

**Motion for these components:** custom cubic-beziers only
(`duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]`), never `ease`, `linear`, or `ease-in-out`.
