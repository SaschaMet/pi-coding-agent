# Research Checklist

Structured checklist for Step 1. Work through each section and note findings.
Skip sections that don't apply to the project.

## 1. Repository Shape

- [ ] Primary language(s) and version(s)
- [ ] Framework(s) (e.g., Django, Next.js, Spring Boot, Rails)
- [ ] Monorepo or single-project?
- [ ] Package manager(s) and lockfile(s)
- [ ] Build tool(s) and commands (`make`, `npm run build`, `cargo build`, etc.)
- [ ] Entry points (main files, CLI commands, API routers)

## 2. CI/CD & Deployment

- [ ] CI system (GitHub Actions, GitLab CI, Jenkins, etc.)
- [ ] Key CI jobs: lint, test, build, deploy
- [ ] Deployment target (cloud provider, container orchestration, serverless)
- [ ] Feature flags or canary deployment support?
- [ ] Rollback mechanism available?

## 3. Project Guidance Files

Check for and read (if present):

- [ ] `.github/copilot-instructions.md`
- [ ] `.github/instructions/*.instructions.md`
- [ ] `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`
- [ ] `.claude/`, `.cursor/rules`
- [ ] `.github/agents/*.agent.md`
- [ ] `.github/skills/*/SKILL.md`
- [ ] `.github/prompts/*.prompt.md`
- [ ] `CONTRIBUTING.md`
- [ ] Architecture docs, ADRs (`docs/architecture/`, `docs/adr/`)

## 4. Prior Plans & Specs

- [ ] `docs/plans/` — existing plans
- [ ] `.copilot-tracking/` — tracking files
- [ ] `*.plan.md`, `*.spec.md`, `PRD.md`
- [ ] Does a plan for the same feature already exist? → Update in-place

## 5. Implementation Area

- [ ] Which modules/packages are affected?
- [ ] Similar features that exist (patterns to reuse)
- [ ] Shared utilities or helpers already available
- [ ] Data models / schemas involved
- [ ] Dependencies between affected modules
- [ ] External service integrations touched

## 6. Test Landscape

- [ ] Test framework(s) in use
- [ ] Test directory layout and naming convention
- [ ] Existing test coverage (if measurable)
- [ ] Test run command(s)
- [ ] Coverage run command(s)
- [ ] Are there integration/e2e tests? Where do they live?
- [ ] Test data patterns (fixtures, factories, mocks)

## 7. Risk Signals

Note anything that looks like a risk:

- [ ] Schema changes / data migrations
- [ ] Public API surface changes
- [ ] Cross-module dependencies
- [ ] Performance-sensitive code paths
- [ ] Security-sensitive areas (auth, input validation, secrets)
- [ ] One-way doors (irreversible changes)
