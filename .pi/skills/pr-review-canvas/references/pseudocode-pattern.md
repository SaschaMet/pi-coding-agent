# Pseudocode + Collapsed Diff Pattern

Use this when a file has a large diff (150+ lines) that implements a well-understood algorithm. Show the intent in plain English; collapse the real code below.

```html
<div class="file-card">
  <div class="file-hdr" onclick="toggle(this)">
    <span class="fname">retryClient.ts</span>
    <div class="fstats">
      <span class="pill add">+173</span>
      <span class="pill del">&minus;11</span>
      <span class="chev open">&#9654;</span>
    </div>
  </div>
  <div class="file-body open">
    <div class="file-note">
      <strong>What this does:</strong>
      <pre style="margin-top:8px;color:var(--text);font-size:12px;line-height:1.6;">
fetch(url):
  if circuit breaker is open → fail fast
  retry up to N times:
    try fetch with timeout
    on success → close circuit breaker, return
    on retryable error → wait (exponential backoff + jitter)
    on non-retryable error → throw
  circuit breaker records failure</pre>
    </div>
    <div class="bp-section" style="margin:0;border:0;border-radius:0;">
      <div class="bp-hdr" onclick="toggleBP(this)">
        <span>Show full implementation (+173 lines)</span>
        <span class="chev">&#9654;</span>
      </div>
      <div class="bp-body">
        <div data-diff="retryClient_ts"></div>
      </div>
    </div>
  </div>
</div>
```

The `data-diff` key must match the sanitized filename key in `/tmp/pr-patches-{number}.json` (all non-alphanumeric chars replaced with `_`). For `retryClient.ts` the key is `retryClient_ts`.
