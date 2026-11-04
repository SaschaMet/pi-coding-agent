# graphify reference: semantic extraction (Part B)

## Contents

- Step B0 cache check · B1 split into chunks · B2 dispatch subagents · B3 collect, cache, merge

**MANDATORY: You MUST use the Agent tool here. Reading files yourself one-by-one is forbidden - it is 5-10x slower. If you do not use the Agent tool you are doing this wrong.**

Before dispatching subagents, print a timing estimate:
- Load `total_words` and file counts from `graphify-out/.graphify_detect.json`
- Estimate agents needed: `ceil(uncached_non_code_files / 22)` (chunk size is 20-25 files, capped at ~6000 total lines)
- Estimate time: ~45s per agent batch (they run in parallel, so total ≈ 45s × ceil(agents/parallel_limit))
- Print: "Semantic extraction: ~N files → X agents, estimated ~Ys"

**Step B0 - Check extraction cache first**

Before dispatching any subagents, check which files already have cached extraction results:

SPEC_PATH below is the **absolute** path of the `references/extraction-spec.md` that ships beside this SKILL.md — the same file Step B2 loads and hands to every subagent. It is the extraction prompt, so cache entries are attributed to it: when a graphify upgrade changes the prompt, entries produced by the old one are re-extracted instead of replayed, and unchanged prompts keep their entries (#1939). Substitute the real path in both Step B0 and Step B3 — pass the same one to each, and do not drop the argument.

```bash
$(cat graphify-out/.graphify_python) -c "
import json
from graphify.cache import check_semantic_cache
from pathlib import Path

detect = json.loads(Path('graphify-out/.graphify_detect.json').read_text(encoding=\"utf-8\"))
# Only content files go to semantic extraction. Code is already covered structurally
# by the AST pass (Part A); flattening every category here makes subagents re-read
# every source file (#1392). Video is transcribed to a document in Step 2.5 first.
all_files = [f for cat in ('document', 'paper', 'image') for f in detect['files'].get(cat, [])]

cached_nodes, cached_edges, cached_hyperedges, uncached = check_semantic_cache(all_files, root='INPUT_PATH', prompt_file='SPEC_PATH')

# Always (re)write the cache file: write hits, else DELETE any leftover from a prior
# run so Part C never merges a stale .graphify_cached.json (#1392).
if cached_nodes or cached_edges or cached_hyperedges:
    Path('graphify-out/.graphify_cached.json').write_text(json.dumps({'nodes': cached_nodes, 'edges': cached_edges, 'hyperedges': cached_hyperedges}, ensure_ascii=False), encoding=\"utf-8\")
else:
    Path('graphify-out/.graphify_cached.json').unlink(missing_ok=True)
Path('graphify-out/.graphify_uncached.txt').write_text('\n'.join(uncached), encoding=\"utf-8\")
# Nothing has been dispatched yet, so any chunk file on disk is a leftover from an
# interrupted run, and Step B3 merges every .graphify_chunk_*.json it finds.
for stale in Path('graphify-out').glob('.graphify_chunk_*.json'):
    stale.unlink()
print(f'Cache: {len(all_files)-len(uncached)} files hit, {len(uncached)} files need extraction')
"
```

Only dispatch subagents for files listed in `graphify-out/.graphify_uncached.txt`. If all files are cached, skip Steps B1 and B2 but still run Step B3's commands: its merge is the only Part B step that writes `graphify-out/.graphify_semantic.json`, and Part C reads that file unconditionally. Do not write an empty `.graphify_semantic.json` instead, because that drops every cached node.

**Step B1 - Split into chunks**

Load files from `graphify-out/.graphify_uncached.txt`. Split into chunks bounded by BOTH limits: at most 20-25 files AND at most ~6000 total lines per chunk. A text file longer than 2000 lines gets a chunk to itself - that is past the Read tool's single-call cap, so sharing a chunk with other files guarantees it is only partly read. Each image gets its own chunk (vision needs separate context). When splitting, group files from the same directory together so related artifacts land in the same chunk and cross-file relationships are more likely to be extracted.

Both bounds matter. The line bound is not only about the 2000-line Read cap: a subagent holding 25 files splits its attention across all of them and skims the dense ones, and a 590-line plan can come back with zero nodes that way. Bounding content as well as file count is what keeps a chunk's coverage honest (#2225).

**Step B2 - Dispatch ALL subagents in a single message**

Call the Agent tool multiple times IN THE SAME RESPONSE - one call per chunk. This is the only way they run in parallel. If you make one Agent call, wait, then make another, you are doing it sequentially and defeating the purpose.

**IMPORTANT - subagent type:** Always use `subagent_type="general-purpose"`. Do NOT use `Explore` - it is read-only and cannot write chunk files to disk, which silently drops extraction results. General-purpose has Write and Bash access which the subagent needs.

Concrete example for 3 chunks:
```
[Agent tool call 1: files 1-15, subagent_type="general-purpose"]
[Agent tool call 2: files 16-30, subagent_type="general-purpose"]
[Agent tool call 3: files 31-45, subagent_type="general-purpose"]
```
All three in one message. Not three separate messages.

Each subagent receives this exact prompt (substitute FILE_LIST, CHUNK_NUM, TOTAL_CHUNKS, DEEP_MODE, and CHUNK_PATH).

CHUNK_PATH must be an **absolute** path — derive it before dispatching:
```bash
PROJECT_ROOT=$(pwd)  # cwd — where Part C globs graphify-out/ (NOT .graphify_root/scan dir, #1392)
# Then for chunk N: CHUNK_PATH="${PROJECT_ROOT}/graphify-out/.graphify_chunk_0N.json"
```

Subagent prompt template:

See `references/extraction-spec.md` for the exact subagent prompt (JSON schema, node-ID rules, confidence rubric, frontmatter, hyperedge, and vision rules). Load it only here, only when at least one chunk holds a doc, paper, or image; a pure-code corpus has skipped Part B and never reads it. Pass each subagent that prompt verbatim with FILE_LIST, CHUNK_NUM, TOTAL_CHUNKS, DEEP_MODE, and CHUNK_PATH substituted, and have it write the result to CHUNK_PATH.

**Step B3 - Collect, cache, and merge**

Wait for all subagents. For each result:
- Check that `graphify-out/.graphify_chunk_NN.json` exists on disk — this is the success signal
- If the file exists and contains valid JSON with `nodes` and `edges`, include it and save to cache
- If the file is missing, the subagent was likely dispatched as read-only (Explore type) — print a warning: "chunk N missing from disk — subagent may have been read-only. Re-run with general-purpose agent." Do not silently skip.
- If a subagent failed or returned invalid JSON, print a warning and skip that chunk - do not abort

If more than half the chunks failed or are missing, stop and tell the user to re-run and ensure `subagent_type="general-purpose"` is used.

**Step B3.5 - Verify each reported file was actually read to its end**

A subagent that only read the first Read call's worth of a long file still writes a well-formed chunk, so "chunk file exists and parses" is not evidence of coverage. Compare each file's self-reported `coverage` against its real length:

```bash
$(cat graphify-out/.graphify_python) -c "
import json, glob
from pathlib import Path

covered = {}
for c in sorted(glob.glob('graphify-out/.graphify_chunk_*.json')):
    d = json.loads(Path(c).read_text(encoding=\"utf-8\"))
    for src, n in (d.get('coverage') or {}).items():
        covered[src] = max(covered.get(src, 0), int(n))

partial = []
for src, n in sorted(covered.items()):
    p = Path(src)
    if not p.is_absolute():
        p = Path('INPUT_PATH') / src
    if not p.is_file():
        continue
    total = sum(1 for _ in p.open(encoding='utf-8', errors='replace'))
    if total and n < total:
        partial.append((src, n, total))

Path('graphify-out/.graphify_partial.txt').write_text('\n'.join(s for s, _, _ in partial), encoding=\"utf-8\")
if partial:
    print(f'WARNING: {len(partial)} file(s) were only partly read. They are cached as partial and retried on the next --update:')
    for src, n, total in partial:
        print(f'  {src}: read {n} of {total} lines')
else:
    print('Coverage OK - every file a subagent reported was read to its last line')
"
```

Tell the user which files came up short and what was lost (the line counts are printed above). The nodes already extracted for those files are kept - they are still true - but the file is cached as partial and left unstamped in the manifest below, so the next `--update` re-dispatches it and replace-on-re-extract swaps the partial node set for a complete one. This is the same mechanism the library path uses for a truncated LLM response (#933, #1950), so both paths now recover instead of silently keeping a half-read file forever. A file a subagent did not report at all is not counted as partial - there is nothing to compare against - which is why the prompt rule in `references/extraction-spec.md` asks for the count in the first place.

Merge all chunk files into `.graphify_semantic_new.json`. **After each Agent call completes, read the real token counts from the Agent tool result's `usage` field and write them back into the chunk JSON before merging** — the chunk JSON itself always has placeholder zeros. Then run:
```bash
$(cat graphify-out/.graphify_python) -c "
import json, glob
from pathlib import Path

chunks = sorted(glob.glob('graphify-out/.graphify_chunk_*.json'))
all_nodes, all_edges, all_hyperedges = [], [], []
total_in, total_out = 0, 0
for c in chunks:
    d = json.loads(Path(c).read_text(encoding=\"utf-8\"))
    all_nodes += d.get('nodes', [])
    all_edges += d.get('edges', [])
    all_hyperedges += d.get('hyperedges', [])
    total_in += d.get('input_tokens', 0)
    total_out += d.get('output_tokens', 0)
Path('graphify-out/.graphify_semantic_new.json').write_text(json.dumps({
    'nodes': all_nodes, 'edges': all_edges, 'hyperedges': all_hyperedges,
    'input_tokens': total_in, 'output_tokens': total_out,
}, indent=2, ensure_ascii=False), encoding=\"utf-8\")
print(f'Merged {len(chunks)} chunks: {total_in:,} in / {total_out:,} out tokens')
"
```

Save new results to cache. Pass the same SPEC_PATH as Step B0 — it stamps each entry with the prompt that produced it, and a write under a different prompt than the read lands where the next run won't look (#1939):
```bash
$(cat graphify-out/.graphify_python) -c "
import json
from graphify.cache import save_semantic_cache
from pathlib import Path

new = json.loads(Path('graphify-out/.graphify_semantic_new.json').read_text(encoding=\"utf-8\")) if Path('graphify-out/.graphify_semantic_new.json').exists() else {'nodes':[],'edges':[],'hyperedges':[]}
uncached = [line for line in Path('graphify-out/.graphify_uncached.txt').read_text(encoding=\"utf-8\").splitlines() if line]
# A partly-read file is cached with partial: True, which load_cached treats as a MISS,
# so the next --update re-dispatches it instead of serving a truncated extraction forever
# (#2225). Same contract the library path uses for a truncated LLM response (#933/#1950).
partial = [line for line in Path('graphify-out/.graphify_partial.txt').read_text(encoding=\"utf-8\").splitlines() if line] if Path('graphify-out/.graphify_partial.txt').exists() else []
saved = save_semantic_cache(new.get('nodes', []), new.get('edges', []), new.get('hyperedges', []), root='INPUT_PATH', allowed_source_files=uncached, prompt_file='SPEC_PATH', partial_source_files=partial)
note = f' ({len(partial)} left partial for retry)' if partial else ''
print(f'Cached {saved} files' + note)
"
```

Merge cached + new results into `graphify-out/.graphify_semantic.json`:
```bash
$(cat graphify-out/.graphify_python) -c "
import json
from pathlib import Path

cached = json.loads(Path('graphify-out/.graphify_cached.json').read_text(encoding=\"utf-8\")) if Path('graphify-out/.graphify_cached.json').exists() else {'nodes':[],'edges':[],'hyperedges':[]}
new = json.loads(Path('graphify-out/.graphify_semantic_new.json').read_text(encoding=\"utf-8\")) if Path('graphify-out/.graphify_semantic_new.json').exists() else {'nodes':[],'edges':[],'hyperedges':[]}

all_nodes = cached['nodes'] + new.get('nodes', [])
all_edges = cached['edges'] + new.get('edges', [])
all_hyperedges = cached.get('hyperedges', []) + new.get('hyperedges', [])
seen = set()
deduped = []
for n in all_nodes:
    if n['id'] not in seen:
        seen.add(n['id'])
        deduped.append(n)

merged = {
    'nodes': deduped,
    'edges': all_edges,
    'hyperedges': all_hyperedges,
    'input_tokens': new.get('input_tokens', 0),
    'output_tokens': new.get('output_tokens', 0),
}
Path('graphify-out/.graphify_semantic.json').write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding=\"utf-8\")
print(f'Extraction complete - {len(deduped)} nodes, {len(all_edges)} edges ({len(cached[\"nodes\"])} from cache, {len(new.get(\"nodes\",[]))} new)')
"
```
Clean up temp files: `rm -f graphify-out/.graphify_cached.json graphify-out/.graphify_uncached.txt graphify-out/.graphify_semantic_new.json`
