# Risk Taxonomy

Use this taxonomy to decide whether a question is worth asking at all.
It is not a generic checklist. Prefer silent defaults over interrogation.

## How To Use It

For each relevant category:

1. Check whether the risk is `Critical`, `High`, or lower.
2. Apply the default change if best practice is obvious.
3. Ask a question only if the user must make a decision or the repo contradicts the default.

If a category does not expose a real `Critical` or `High` decision, skip it.

## High-Signal Categories

### 1. Security Boundary

Ask only if the plan changes who can access something, exposes new untrusted input,
or increases privilege.

Default changes:

- Require existing authn/authz patterns on new endpoints or actions
- Validate and sanitize untrusted input at the boundary
- Avoid logging secrets or sensitive payloads
- Add rate limiting or abuse controls when a public or expensive path is introduced

### 2. Data Mutation & Integrity

Ask only if the change can lose, corrupt, duplicate, or silently overwrite data,
or if there is a one-way migration.

Default changes:

- Make writes atomic where possible
- Add validation before persistence
- Prefer idempotent write paths
- Add migration and rollback notes for schema or stored-data changes

### 3. External Dependency Failure

Ask only if the user must choose between strict failure, degraded behavior,
or eventual consistency.

Default changes:

- Add timeouts on remote calls
- Add retries with bounded exponential backoff when the operation is safe to retry
- Define a graceful failure path for dependency outages
- Pin or explicitly document external contracts when feasible

### 4. Rollout, Reversibility & Blast Radius

Ask only if the change is expensive to undo, affects many users at once,
or lacks a safe rollout path.

Default changes:

- Prefer feature flags or staged rollout when supported
- Add rollback steps for risky deploys
- Scope the first release narrowly when the blast radius is broad

### 5. Observability & Operability

Ask only if production failure would be hard to detect or diagnose and the user
must decide on monitoring ownership or thresholds.

Default changes:

- Add structured logs on important failure paths
- Add health signals, metrics, or alerts for new operationally important flows
- Make failure modes visible instead of silent

### 6. API & Contract Changes

Ask only if the contract is intentionally ambiguous, externally owned,
or breaking behavior is being considered.

Default changes:

- Document API changes using the repo's existing standard
- If no standard is stated and this is an HTTP/API surface, use OpenAPI/Swagger
- Add versioning or compatibility notes for breaking contract changes
- Add contract or integration tests for the changed boundary

### 7. Performance Hot Paths

Ask only if the change sits on a known hot path, introduces an unbounded operation,
or load expectations materially affect the design.

Default changes:

- Avoid obvious N+1 queries and unbounded scans
- Bound memory, concurrency, and queue growth
- Add a benchmark or regression guard if the path is known to be hot

### 8. Testability & Regression Safety

Ask only if the user must choose between test depth, cost, or delivery speed.

Default changes:

- Add focused tests for the changed behavior
- Cover the main failure path when the change writes data, calls dependencies, or changes auth
- Reuse existing test patterns instead of inventing a new harness

## Categories Usually Not Worth A Question

These should almost never become explicit questions unless they hide a critical business trade-off:

- Maintainability
- Code style
- Naming
- Minor edge cases already covered by standard validation
- Generic "what about scalability?" concerns without evidence this path is hot

Convert them into defaults, short notes, or ignore them entirely.
