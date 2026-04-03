# Risk Taxonomy

Categories of risk to probe during a grilling session. Not every category applies
to every design — focus on the ones relevant to the target.

## Correctness

- Does the logic handle all documented input cases?
- What are the boundary conditions (empty, null, max, negative, unicode, concurrent)?
- Are error states handled explicitly, not silently swallowed?
- Is there a mismatch between the spec/requirements and the proposed behavior?

## Security

- Who can access this? What are the authentication and authorization boundaries?
- What untrusted input flows through this path? Is it validated and sanitized?
- Are secrets stored safely? Could they leak through logs, errors, or responses?
- Does this expand the attack surface? (new endpoints, new permissions, new data stores)
- Could this be abused? (rate limiting, resource exhaustion, privilege escalation)

## Data Integrity

- What happens if the operation fails halfway? Is there a partial state?
- Are writes atomic or is there a window for inconsistency?
- Is data validated at the boundary before storage?
- What's the migration path for existing data?
- Can this cause data loss, corruption, or silent overwrite?

## Scalability & Performance

- What's the expected load? How does behavior change at 10x, 100x?
- Are there N+1 queries, unbounded loops, or full-table scans?
- Is there a hot path that becomes a bottleneck?
- What resources are consumed (memory, connections, file handles) and how are they bounded?

## Reliability & Operations

- What happens when a dependency is down, slow, or returning errors?
- Is there retry logic? Is it idempotent? Does it have backoff?
- How do you know this is broken in production? (monitoring, alerts, health checks)
- What does the rollback plan look like?
- Is there a graceful degradation path?

## Maintainability

- Is this change easy to understand for someone who didn't write it?
- Does it introduce coupling between previously independent modules?
- Will this be painful to change in 6 months?
- Does it duplicate logic that already exists elsewhere?

## Dependencies & Integration

- Are there implicit dependencies (ordering, timing, shared state)?
- What's the contract with external services? Is it version-pinned?
- What if the dependency changes behavior without notice?
- Is the integration tested, or only assumed to work?

## Reversibility

- If this is wrong, how expensive is it to undo?
- Can you feature-flag this and roll back without a deploy?
- Does this create a one-way door? (schema migration, public API, data format change)
