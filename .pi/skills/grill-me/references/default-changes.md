# Default Changes

Risks that industry best practice already answers. Record them; do not spend a question on them.

## Record format

> [High] Missing retry/backoff on an external API call.
> Default change: add idempotent exponential backoff with jitter.
> No question needed unless the team has a known reason to avoid retries.

## Defaults to apply without asking

- **API surface changed, no documentation approach named** — use OpenAPI/Swagger unless the repo already
  uses something else.
- **External API call, no resiliency noted** — add timeouts, retries, and backoff if the operation is safe
  to retry.
- **New async/background work, no visibility noted** — add structured logging and success/failure metrics.
- **New write path, no tests noted** — add focused regression tests for the write and the failure path.
- **New rollout risk, no deployment guidance** — prefer a feature flag or another reversible rollout if the
  stack supports it.

## Replace generic prompts with concrete findings

| Instead of asking                 | Do this                                                       |
| --------------------------------- | ------------------------------------------------------------- |
| "Have you considered pagination?" | Flag the missing pagination as a default change               |
| "What about error handling?"      | Name the specific unhandled error path                        |
| "Did you think about security?"   | Name the exact attack surface                                 |
| "What's your testing strategy?"   | No tests in the plan is the finding — record the tests to add |
