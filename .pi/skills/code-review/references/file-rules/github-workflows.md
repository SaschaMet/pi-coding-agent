# GitHub Workflow Rules

Applies to `.github/workflows/**/*.{yml,yaml}`. Check changed lines. The tag names the owning lens.

## Security

- [security] Script injection: `${{ github.event.* }}` (issue or PR title, body, comment, head ref, commit
  message) expanded inside `run:`. The runner pastes the text into the script. Fix: pass it via `env:`
  and quote the shell variable.
- [security] `pull_request_target` or `workflow_run` that checks out the PR head
  (`ref: ${{ github.event.pull_request.head.sha }}`) and runs its code: untrusted code gets a write token
  and secrets.
- [security] No `permissions` key, or `permissions: write-all`: the `GITHUB_TOKEN` gets the broad repo
  default. Each job should declare only what it needs. Report it as its own finding: it is a separate
  control, even when it widens the damage of another finding.
- [security] Third-party action pinned to a tag or branch (`some-org/action@v2`): tags are mutable. Pin a
  full commit SHA. First-party `actions/*` on a major tag is acceptable.
- [security] Secrets echoed to logs (`echo ${{ secrets.X }}`), passed on a command line, or hardcoded in
  the file instead of `secrets.*`.

## Correctness

- [qa] Misspelled action inputs are ignored silently: `fetch-detph: 0` instead of `fetch-depth: 0`.
- [qa] A job that needs git history (tags, merge-base, changelog) checks out without `fetch-depth: 0`.
- [qa] An `if:` that can never or always match: wrong event name (`pull_request` vs `pull_request_target`)
  or a broken expression.
- [qa] `needs:` names a job ID that does not exist, or forms a cycle.
- [qa] `|| true` or `continue-on-error: true` on a step whose failure must fail the job.
- [qa] Deprecated `::set-output` or `::save-state`; use `$GITHUB_OUTPUT` or `$GITHUB_STATE`.

## Reliability

- [code_quality] A job on a self-hosted runner without `timeout-minutes`.
- [code_quality] A container image or tool version on `latest`.
