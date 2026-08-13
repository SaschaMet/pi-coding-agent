# Architecture — <project name>

Structural overview of the system. Read before any change to understand component boundaries and dependencies.

## Tech Stack

- **Language(s):** <e.g. TypeScript, Python, Go>
- **Framework(s):** <e.g. Next.js, Express, Django>
- **Package Manager:** <e.g. npm, pnpm, yarn>
- **Build Tool:** <e.g. tsc, webpack, esbuild>
- **Runtime:** <e.g. Node.js, Vercel, Docker, Kubernetes>

## Component Map

| Component        | Location | Responsibility                |
| ---------------- | -------- | ----------------------------- |
| <component name> | `<path>` | <what it does, 1–2 sentences> |

## Dependency Direction

```text
<ASCII diagram or bullet list showing which components depend on which>
```

## Key Decisions

- <Decision 1: what was chosen, why, and what was considered>
- <Decision 2: …>

## Data Flow

<High-level request lifecycle or event flow. Keep it brief — trace a single request from entry to response.>

## Architecture Diagram

<ASCII diagram or link to a visual diagram showing the architecture of the system. Include components, data flow, and dependencies.>

- Can be multiple diagrams if needed, e.g., one for the frontend, one for the backend, and one for the database.
- Include caching, queues, and other infrastructure components if they are part of the architecture.
