#!/usr/bin/env python3
"""Search an Obsidian vault with fuzzy keyword matching.

Stdlib-only, deterministic, read-only, non-interactive.
Ported from the Open WebUI "Obsidian Vault Search" tool core.
Iterative refinement is done by the calling agent, not this script.

Exit codes:
  0  matches found
  1  no matches
  2  vault missing or empty
  3  invalid input
"""

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import quote

IGNORED_PARTS = {".obsidian", ".trash", ".git", "node_modules", "_attachments"}
WORD_RE = re.compile(r"\b[\w\-äöüÄÖÜß]+\b")
SORT_MODES = ("score", "similarity", "file_name", "matches_count", "position")
DEFAULT_VAULT = (
    os.environ.get("OBSIDIAN_VAULT") or str(Path.home() / "Documents" / "Documents")
)
DEFAULT_VAULT_NAME = "Documents"

STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of",
    "with", "by", "from", "as", "is", "was", "are", "been", "be", "have", "has",
    "had", "do", "does", "did", "will", "would", "could", "should", "may",
    "might", "can", "this", "that", "these", "those", "i", "you", "he", "she",
    "it", "we", "they", "what", "which", "who", "when", "where", "why", "how",
    "all", "each", "every", "both", "few", "more", "most", "other", "some",
    "such", "no", "nor", "not", "only", "same", "so", "than", "too", "very",
    "just", "now",
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem",
    "eines", "einer", "und", "oder", "aber", "im", "an", "am", "auf", "aus",
    "bei", "mit", "nach", "von", "vom", "zu", "zum", "zur", "für", "über",
    "unter", "durch", "gegen", "ohne", "um", "ist", "sind", "war", "waren",
    "sein", "haben", "hat", "hatte", "hatten", "werden", "wird", "wurde",
    "wurden", "kann", "können", "könnte", "könnten", "muss", "müssen", "soll",
    "sollen", "sollte", "sollten", "dies", "diese", "dieser", "dieses",
    "welche", "welcher", "welches", "ich", "du", "er", "sie", "es", "wir",
    "ihr", "was", "wer", "wann", "wo", "warum", "wie", "alle", "jede", "jeder",
    "jedes", "kein", "keine", "nur", "auch", "sehr", "jetzt", "dass", "ob",
    "wenn", "weil", "seit", "bis", "während",
}

_ratio_cache: dict[tuple[str, str], float] = {}


def _indel_distance(a: str, b: str) -> int:
    """Indel distance: insertions/deletions only; a substitution costs 2."""
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    if la < lb:
        a, b = b, a
        la, lb = lb, la
    prev = list(range(lb + 1))
    for i in range(1, la + 1):
        ca = a[i - 1]
        cur = [i]
        for j in range(1, lb + 1):
            cost = 0 if ca == b[j - 1] else 2
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost))
        prev = cur
    return prev[lb]


def fuzz_ratio(a: str, b: str) -> float:
    """rapidfuzz-compatible fuzz.ratio (indel-based), 0-100, memoized."""
    la, lb = len(a), len(b)
    if la == 0 and lb == 0:
        return 100.0
    key = (a, b)
    cached = _ratio_cache.get(key)
    if cached is None:
        matched = (la + lb - _indel_distance(a, b)) / 2
        cached = (2 * matched / (la + lb)) * 100
        _ratio_cache[key] = cached
    return cached


_char_counts: dict[str, Counter] = {}


def _char_count(word: str) -> Counter:
    cached = _char_counts.get(word)
    if cached is None:
        cached = Counter(word)
        _char_counts[word] = cached
    return cached


def build_index(
    files: list[Path], vault: Path
) -> tuple[dict[str, str], dict[str, dict[str, list[int]]], dict[int, set[str]]]:
    """One pass over the vault: file texts, per-file word positions, global length buckets."""
    file_texts: dict[str, str] = {}
    file_words: dict[str, dict[str, list[int]]] = {}
    words_by_len: dict[int, set[str]] = {}
    for md_file in files:
        try:
            content = md_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        relative_path = str(md_file.relative_to(vault))
        file_texts[relative_path] = content
        words: dict[str, list[int]] = {}
        for m in WORD_RE.finditer(content.lower()):
            words.setdefault(m.group(), []).append(m.start())
        file_words[relative_path] = words
        for word in words:
            words_by_len.setdefault(len(word), set()).add(word)
    return file_texts, file_words, words_by_len


def fuzzy_candidates(
    keyword: str, threshold: int, words_by_len: dict[int, set[str]]
) -> list[str]:
    """Distinct vault words that can reach the threshold, sorted for determinism.

    Exact integer bounds (no float error at the threshold boundary):
    - length: |la-lb|*100 <= (100-threshold)*(la+lb)
      which is equivalent to la*threshold/(200-threshold) <= lb <= la*(200-threshold)/threshold
    - character multiset: indel distance >= sum_c |count_a(c) - count_b(c)|
    """
    if threshold <= 0:
        return sorted({word for words in words_by_len.values() for word in words})
    la = len(keyword)
    kw_chars = _char_count(keyword)
    rhs = 100 - threshold
    lo = (la * threshold + 199 - threshold) // (200 - threshold)
    hi = (la * (200 - threshold)) // threshold
    out: list[str] = []
    for length in range(lo, hi + 1):
        for word in words_by_len.get(length, ()):
            word_chars = _char_count(word)
            delta = sum((kw_chars - word_chars).values()) + sum(
                (word_chars - kw_chars).values()
            )
            if delta * 100 > rhs * (la + length):
                continue
            out.append(word)
    return sorted(out)


def extract_keywords(query: str, limit: int = 20) -> list[str]:
    """Local keyword extraction: tokenize, drop stopwords, rank by length."""
    tokens = WORD_RE.findall(query.lower())
    keywords = [t for t in tokens if t not in STOPWORDS and len(t) > 2]
    return sorted(set(keywords), key=lambda t: (-len(t), t))[:limit]


def normalize_keywords(raw: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for keyword in raw:
        keyword = re.sub(r"\s+", " ", keyword.strip().lower())
        keyword = keyword.strip(" ,.;:!?\"'`")
        if len(keyword) < 2 or keyword in seen:
            continue
        seen.add(keyword)
        normalized.append(keyword)
    return normalized


def markdown_files(vault: Path) -> list[Path]:
    files: list[Path] = []
    for md_file in sorted(vault.rglob("*.md")):
        if IGNORED_PARTS.intersection(md_file.relative_to(vault).parts):
            continue
        files.append(md_file)
    return files


def find_matches(
    text: str,
    file_path: str,
    keywords: list[str],
    threshold: int,
    file_words: dict[str, list[int]],
    candidates: dict[str, list[str]],
) -> list[dict]:
    matches: list[dict] = []
    text_lower = text.lower()
    path_lower = file_path.lower()

    for keyword in keywords:
        if keyword in path_lower:
            matches.append(
                {
                    "position": 0,
                    "length": min(120, len(text)),
                    "keyword": keyword,
                    "matched_word": file_path,
                    "similarity": 100.0,
                    "score": 130.0,
                }
            )
        if " " in keyword:
            for m in re.finditer(re.escape(keyword), text_lower):
                matches.append(
                    {
                        "position": m.start(),
                        "length": len(m.group()),
                        "keyword": keyword,
                        "matched_word": m.group(),
                        "similarity": 100.0,
                        "score": 125.0,
                    }
                )
            continue
        for word in candidates.get(keyword, ()):
            positions = file_words.get(word)
            if not positions:
                continue
            if word == keyword:
                similarity = 100.0
            else:
                similarity = fuzz_ratio(keyword, word)
                if similarity < threshold:
                    continue
            for position in positions:
                score = similarity
                if word == keyword:
                    score += 20
                if position < 1000:
                    score += 5
                matches.append(
                    {
                        "position": position,
                        "length": len(word),
                        "keyword": keyword,
                        "matched_word": word,
                        "similarity": similarity,
                        "score": score,
                    }
                )

    seen: set[tuple] = set()
    unique: list[dict] = []
    for match in sorted(matches, key=lambda item: item["score"], reverse=True):
        key = (match["position"], match["keyword"], match["matched_word"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(match)
    return unique


def extract_context(
    text: str, match_pos: int, match_length: int, context_chars: int
) -> str:
    start = max(0, match_pos - context_chars)
    end = min(len(text), match_pos + match_length + context_chars)
    while start > 0 and text[start - 1].isalnum():
        start -= 1
    while end < len(text) and text[end].isalnum():
        end += 1
    context = text[start:end].strip()
    if start > 0:
        context = "..." + context
    if end < len(text):
        context = context + "..."
    return context


def dedupe_matches(matches: list[dict]) -> list[dict]:
    deduped: dict[tuple, dict] = {}
    for match in matches:
        key = (match["path"], re.sub(r"\s+", " ", match["context"][:160]).lower())
        existing = deduped.get(key)
        if existing is None or match["score"] > existing["score"]:
            deduped[key] = match
    return list(deduped.values())


def sort_results(matches: list[dict], sort_by: str) -> list[dict]:
    if sort_by == "file_name":
        return sorted(matches, key=lambda item: item["file"].lower())
    if sort_by == "matches_count":
        counts: dict[str, int] = {}
        for match in matches:
            counts[match["path"]] = counts.get(match["path"], 0) + 1
        return sorted(
            matches,
            key=lambda item: (-counts[item["path"]], -item["score"], item["path"]),
        )
    if sort_by == "position":
        return sorted(matches, key=lambda item: (item["path"], item["position"]))
    if sort_by == "similarity":
        return sorted(matches, key=lambda item: item["similarity"], reverse=True)
    return sorted(matches, key=lambda item: (-item["score"], item["path"], item["position"]))


def obsidian_link(vault_name: str, path: str) -> str:
    note = path[:-3] if path.endswith(".md") else path
    return f"obsidian://open?vault={quote(vault_name)}&file={quote(note)}"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="obsidian_search.py",
        description="Search an Obsidian vault with fuzzy keyword matching.",
    )
    parser.add_argument(
        "--query",
        help="natural-language query; keywords are extracted locally",
    )
    parser.add_argument(
        "--keywords",
        help="comma-separated keywords (wins over --query)",
    )
    parser.add_argument(
        "--vault",
        default=DEFAULT_VAULT,
        help="vault root path (default: $OBSIDIAN_VAULT or ~/Documents/Documents)",
    )
    parser.add_argument(
        "--vault-name",
        default=DEFAULT_VAULT_NAME,
        help="vault name used for obsidian:// links (default: Documents)",
    )
    parser.add_argument(
        "--context",
        type=int,
        default=500,
        help="chars before/after each match, 0-2000 (default: 500)",
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=20,
        help="maximum results, 1-50 (default: 20)",
    )
    parser.add_argument(
        "--threshold",
        type=int,
        default=80,
        help="fuzzy matching threshold 0-100 (default: 80)",
    )
    parser.add_argument(
        "--sort",
        default="score",
        help="sort mode: " + ", ".join(SORT_MODES) + " (default: score)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit JSON instead of the markdown report",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    if not args.query and not args.keywords:
        print("error: nothing to search: pass --query and/or --keywords", file=sys.stderr)
        return 3
    if not 0 <= args.context <= 2000:
        print(f"error: --context must be 0-2000, got {args.context}", file=sys.stderr)
        return 3
    if not 1 <= args.max_results <= 50:
        print(f"error: --max-results must be 1-50, got {args.max_results}", file=sys.stderr)
        return 3
    if not 0 <= args.threshold <= 100:
        print(f"error: --threshold must be 0-100, got {args.threshold}", file=sys.stderr)
        return 3
    if args.sort not in SORT_MODES:
        print(
            f"error: --sort must be one of: {', '.join(SORT_MODES)}; got {args.sort!r}",
            file=sys.stderr,
        )
        return 3

    vault = Path(args.vault).expanduser()
    if not vault.is_dir():
        print(f"error: Vault not found at {vault}", file=sys.stderr)
        return 2

    keywords: list[str] = []
    if args.keywords:
        keywords = normalize_keywords(args.keywords.split(","))
    elif args.query:
        keywords = extract_keywords(args.query)
    if not keywords:
        print(
            "error: no usable keywords; pass --keywords explicitly",
            file=sys.stderr,
        )
        return 3

    files = markdown_files(vault)
    if not files:
        print(f"error: No markdown files found in vault at {vault}", file=sys.stderr)
        return 2

    file_texts, file_words, words_by_len = build_index(files, vault)
    candidates = {
        kw: fuzzy_candidates(kw, args.threshold, words_by_len)
        for kw in keywords
        if " " not in kw
    }

    all_matches: list[dict] = []
    for relative_path, content in file_texts.items():
        for match in find_matches(
            content,
            relative_path,
            keywords,
            args.threshold,
            file_words[relative_path],
            candidates,
        ):
            context = extract_context(
                content, match["position"], match["length"], args.context
            )
            all_matches.append(
                {
                    "file": Path(relative_path).name,
                    "path": relative_path,
                    "context": context,
                    "keyword": match["keyword"],
                    "matched_word": match["matched_word"],
                    "similarity": round(match["similarity"], 1),
                    "score": round(match["score"], 1),
                    "position": match["position"],
                    "obsidian_link": obsidian_link(args.vault_name, relative_path),
                }
            )

    all_matches = dedupe_matches(all_matches)
    if not all_matches:
        print(
            f"No matches found for keywords: {', '.join(keywords)}",
            file=sys.stderr,
        )
        if args.json:
            print(
                json.dumps(
                    {
                        "vault": str(vault),
                        "vault_name": args.vault_name,
                        "keywords": keywords,
                        "total_matches": 0,
                        "shown": 0,
                        "matches": [],
                    },
                    ensure_ascii=False,
                )
            )
        return 1

    all_matches = sort_results(all_matches, args.sort)
    top = all_matches[: args.max_results]

    if args.json:
        print(
            json.dumps(
                {
                    "vault": str(vault),
                    "vault_name": args.vault_name,
                    "keywords": keywords,
                    "total_matches": len(all_matches),
                    "shown": len(top),
                    "matches": top,
                },
                ensure_ascii=False,
            )
        )
        return 0

    print(f"Vault: {vault} ({len(files)} notes)")
    print(f"Keywords: {', '.join(keywords)}")
    print(f"Matches: {len(all_matches)} (showing top {len(top)})")
    print()
    for index, result in enumerate(top, 1):
        print(
            f'{index}. {result["file"]} | score {result["score"]} | '
            f'keyword "{result["keyword"]}" -> "{result["matched_word"]}" '
            f'(similarity {result["similarity"]})'
        )
        print(f'   path: {result["path"]}')
        print(f'   link: {result["obsidian_link"]}')
        print("   context:")
        for line in result["context"].splitlines():
            print(f"   > {line}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
