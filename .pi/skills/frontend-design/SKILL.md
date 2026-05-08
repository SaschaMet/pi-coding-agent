---
name: frontend-design
description: Use this skill when the user asks to build or substantially redesign a frontend component, page, app, website, game UI, dashboard, or interactive web experience, even if they do not say "frontend." Produce working UI with a clear aesthetic direction, responsive states, accessible interactions, and visual verification. Do not use for backend-only work or tiny copy/style tweaks.
---

Create distinctive, production-grade frontend interfaces. Implement real working code with clear product context, responsive behavior, accessible controls, and visual verification.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Gotchas

- Start from the existing app conventions when a codebase already has UI patterns.
- For SaaS, admin, CRM, internal tools, and dashboards, prioritize dense, scannable, work-focused interfaces over marketing layouts.
- Do not create a landing page when the user asked for an app, game, tool, dashboard, or component.
- Visual polish is not enough; controls must be wired to usable behavior where the user would expect it.

## When NOT to use

- Do not use this skill for backend-only, CLI-only, or infrastructure tasks.
- Do not use this skill when the user explicitly requests strict adherence to an existing design system and no visual experimentation.
- Do not use this skill for tiny copy edits, one-line CSS fixes, or simple bug fixes unless visual quality is the main task.
- Prefer `tdd-coder` when the request is primarily behavior-driven logic changes with minimal or no UI work.

## Design Thinking

Before coding, inspect the existing app and commit to one clear aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick a specific direction such as brutally minimal, maximalist, retro-futuristic, organic, luxury/refined, playful, editorial, brutalist, art deco, soft/pastel, or industrial/utilitarian.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: Define one memorable design move that fits the domain.

Choose a clear conceptual direction and execute it consistently. Bold maximalism and refined minimalism both work; inconsistency does not.

Then implement working code using the project's existing framework and styling approach. For standalone artifacts, default to the simplest HTML/CSS/JS that satisfies the request.

- Production-grade and functional
- Visually distinct and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:

- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

Do not use generic AI-style defaults: overused font families (Inter, Roboto, Arial, system fonts), purple gradients on white backgrounds, predictable card grids, or context-free component patterns.

Interpret creatively and make choices that fit the product context. Vary theme, fonts, density, and composition across tasks; do not converge on a favorite default.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

## Outcome checks

- The first screen is the usable product experience, not a marketing placeholder, unless the user requested a landing page.
- Layout works at mobile and desktop widths without text overlap or broken controls.
- Interactive elements have hover/focus/active/disabled states where relevant.
- Visual assets, icons, typography, and colors match the chosen direction.
- Local browser or screenshot verification confirms the UI renders, is nonblank, and key interactions work.
