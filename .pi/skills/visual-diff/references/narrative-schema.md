# narrative.json (version 1)

`render` rejects the whole file on any violation (exit 2) and lists every problem on stderr. Unknown fields are rejected at every level.

```jsonc
{
  "version": 1,                        // required, must be 1
  "mode": "summary",                   // required: "summary" | "deep"
  "title": "Short title",              // required
  "what": "One or two sentences.",     // required
  "why": "One or two sentences.",      // required
  "intent": "stated",                  // required: "stated" | "inferred"
  "themes": [                          // required, may be empty
    {
      "id": "retry",                   // unique; "other" is reserved
      "title": "Retry on 503",
      "importance": 4,                 // integer 1-5, highest first on the page
      "summary": "Why these hunks belong together.",
      "hunks": ["h2", "h5"],           // ids from the collect index; each hunk in at most one theme
      "notes": [                       // optional
        {
          "hunk": "h2",                // must be one of this theme's hunks
          "line": 42,                  // must fall inside that hunk on the given side
          "side": "new",               // "new" | "old"
          "kind": "risk",              // "info" | "risk" | "question"
          "text": "Plain text; `code` spans allowed."
        }
      ]
    }
  ],
  "behavior": [                        // optional
    { "before": "Fails on 503.", "after": "Retries 3 times.", "where": "src/http.ts:42" }
  ],
  "removed": [                         // optional
    { "what": "Timeout check", "status": "unaccounted", "where": "src/http.ts:30" }
    // status: "re-established" | "unaccounted" | "intentional"
  ],
  "impact": {                          // optional
    "source": "graphify",              // "graphify" | "grep" | "none"
    "nodes": [
      { "id": "fetchJson", "label": "fetchJson()", "kind": "changed", "layer": "service", "file": "src/http.ts" },
      { "id": "loadUser", "label": "loadUser()", "kind": "affected", "layer": "ui" }
    ],
    "edges": [{ "from": "loadUser", "to": "fetchJson", "label": "calls" }]
  },
  "focus": [                           // optional
    { "severity": "high", "where": "src/http.ts:48", "scenario": "Retrying a POST can charge twice." }
    // severity: "high" | "medium" | "low"
  ]
}
```

## Notes

- Hunks that no theme lists land in a last theme "Other changes". Its summary says the narrative does not explain them, so assign every hunk you understand.
- Note line ranges: a hunk `@@ -10,4 +12,6 @@` covers new lines 12–17 and old lines 10–13.
- The impact diagram draws the first 40 nodes. All nodes appear in the table under it. Edges to unknown node ids are dropped with a warning.
- Files that are generated, or have more than 800 changed lines, are folded on the page.
