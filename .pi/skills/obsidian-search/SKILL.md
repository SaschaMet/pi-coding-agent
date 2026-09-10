---
name: obsidian-search
description: Use this skill when the user asks to search, find, or look up notes in their Obsidian vault, second brain, or personal knowledge base ("check my notes for X", "what do my notes say about Y", "find the note about Z"). Runs a deterministic fuzzy keyword search with context snippets and obsidian:// links, with iterative keyword refinement. Do not use for web search, project codebase search, or reading a specific file the user already named.
---

# Obsidian Search

Search the user's Obsidian vault (default: `~/Documents/Documents`) with the bundled script. You are the planner: you extract the keywords, judge the results, and refine. The script is a deterministic fuzzy matcher — it does not understand language.

Script location: `<skill-dir>/scripts/obsidian_search.py`, where `<skill-dir>` is the directory this SKILL.md was loaded from. (`obsidian_vault_search_openwebui.py` in the same dir is a reference copy of the patched Open WebUI tool — it needs rapidfuzz/httpx/pydantic and is not run by this skill.)

## Definition of Done

- The answer cites vault-relative note paths and quotes only the relevant snippets.
- Every cited note carries the `obsidian://` link from the script output.
- At most 3 search runs, no repeated keyword set.

## Workflow

1. Extract 3-10 keywords from the request. Start from the user's exact terms; add German and English variants (the vault is mixed). Prefer `--keywords` over `--query`.
2. Search (resolve `<skill-dir>` first):

   ```bash
   python3 <skill-dir>/scripts/obsidian_search.py --keywords "term1,term2" --max-results 10
   ```

   Exit codes: 0 matches, 1 no matches, 2 vault missing/empty, 3 invalid input (fix the flags, re-run).
3. Judge the top snippets. If they answer the request, stop and answer. If not, refine once or twice: synonyms, related concepts, narrower or broader terms, the other language. Never repeat a keyword set. Read `references/refinement.md` for the refinement decision table.
4. When a snippet is not enough, read the full note with the `read` tool using the vault-relative `path` (vault root: `~/Documents/Documents`).
5. Answer with the 3-5 best notes: path, one line on why it matches, the quoted snippet, the `obsidian://` link.

## Gotchas

- Do not `grep -r` or walk the vault yourself. Use the script — it handles fuzzy matching, scoring, dedupe, and bounded context.
- Do not pass one vague keyword like `budget` alone; it floods the ~180-note vault with thousands of matches. Combine 2-4 specific terms or use a phrase.
- Do not quote whole notes back. Quote only the snippet you need; the vault holds personal notes — never copy note content into commits, issues, or external tools.
- `--keywords` wins over `--query`; pass both only when you want the fallback extraction too.
- The script ignores `.obsidian`, `.trash`, `_attachments`, and `node_modules`. Do not try to search those.

## References

- `references/refinement.md` — read only when the first search returns no or poor matches: the refinement decision table (synonyms, DE/EN, narrowing, filename search).

## Output

```
<direct answer to the user's question>

Notes:
1. <vault-relative path> — <obsidian:// link>
   > <quoted snippet>
```
