# Reference copy of the patched Open WebUI custom tool (v2.1.0).
# Paste this file into Open WebUI (Settings > Tools > New Tool).
# NOT used by the pi obsidian-search skill — that skill runs obsidian_search.py.
# Changes vs v2.0.0: one-pass vault index reused across search steps,
# integer-bounded fuzzy candidate pre-filter, memoized fuzz.ratio,
# suffix-only .md stripping in obsidian:// links, vault_name default
# "Documents", _attachments excluded, higher AI-extraction token budget.
"""
title: Obsidian Vault Search
author: Sascha Metzger
description: Multi-step Obsidian vault search for Open WebUI. Supports AI-assisted keyword extraction, iterative search refinement, visible search strategy summaries, contextual snippets, citations, and Obsidian links.
required_open_webui_version: 0.4.0
requirements: rapidfuzz, httpx
version: 2.1.0
licence: MIT
"""

import json
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field
from rapidfuzz import fuzz

WORD_RE = re.compile(r"\b[\w\-äöüÄÖÜß]+\b")


class EventEmitter:
    def __init__(self, event_emitter: Optional[Callable[[dict], Any]] = None):
        self.event_emitter = event_emitter

    async def progress_update(self, description: str):
        await self.emit(description)

    async def error_update(self, description: str):
        await self.emit(description, "error", True)

    async def success_update(self, description: str):
        await self.emit(description, "success", True)

    async def emit(
        self,
        description: str = "Searching...",
        status: str = "in_progress",
        done: bool = False,
    ):
        if self.event_emitter:
            await self.event_emitter(
                {
                    "type": "status",
                    "data": {
                        "status": status,
                        "description": description,
                        "done": done,
                    },
                }
            )


@dataclass
class SearchStep:
    query: str
    keywords: List[str]
    reason: str


class Tools:
    def __init__(self):
        self.citation = False
        self.valves = self.Valves()
        self._ratio_cache: Dict[tuple, float] = {}

    class Valves(BaseModel):
        obsidian_path: str = Field(
            default="/app/backend/data/obsidian",
            description="Path to Obsidian vault inside the Open WebUI container",
        )
        vault_name: str = Field(
            default="Documents",
            description="Obsidian vault name used for obsidian:// links",
        )
        planner_api_base: str = Field(
            default="http://host.docker.internal:1234/v1",
            description="OpenAI-compatible API base URL for iterative search planning",
        )
        planner_model: str = Field(
            default="default",
            description="Model name for iterative search planning",
        )
        planner_timeout_seconds: int = Field(
            default=15,
            description="Timeout for AI keyword extraction and search planning",
        )

    class UserValves(BaseModel):
        context_chars: int = Field(
            default=500,
            description="Characters before and after each match to include",
        )
        max_results: int = Field(
            default=20,
            description="Maximum final results to return",
        )
        fuzzy_threshold: int = Field(
            default=80,
            description="Fuzzy matching threshold from 0-100",
        )
        sort_by: str = Field(
            default="score",
            description="Sort by: score, similarity, file_name, matches_count, or position",
        )
        use_ai_extraction: bool = Field(
            default=True,
            description="Use AI to extract initial keywords, with rule-based fallback",
        )
        lm_api_base: str = Field(
            default="http://host.docker.internal:1234/v1",
            description="OpenAI-compatible API base URL for keyword extraction",
        )
        enable_iterative_search: bool = Field(
            default=True,
            description="Run multiple search steps with refined keywords",
        )
        use_ai_refinement: bool = Field(
            default=True,
            description="Use AI to refine later search steps, with rule-based fallback",
        )
        max_search_steps: int = Field(
            default=3,
            description="Maximum search/refinement steps, from 1-5",
        )
        max_keywords_per_step: int = Field(
            default=8,
            description="Maximum keywords per search step",
        )
        show_search_strategy: bool = Field(
            default=True,
            description="Show concise search strategy/status updates",
        )
        include_strategy_in_response: bool = Field(
            default=True,
            description="Include the executed search steps in the final result",
        )

    async def search_obsidian(
        self,
        query: str,
        keywords: Optional[str] = None,
        context_chars: Optional[int] = None,
        max_results: Optional[int] = None,
        fuzzy_threshold: Optional[int] = None,
        sort_by: Optional[str] = None,
        max_search_steps: Optional[int] = None,
        __event_emitter__: Optional[Callable[[dict], Any]] = None,
        __user__: Optional[dict] = None,
        __model__: Optional[dict] = None,
    ) -> str:
        """
        Search an Obsidian vault with optional multi-step refinement.

        :param query: Natural-language question or search query.
        :param keywords: Optional comma-separated keywords for the first search step.
        :param context_chars: Override context size around matches.
        :param max_results: Override final result count.
        :param fuzzy_threshold: Override fuzzy threshold 0-100.
        :param sort_by: Override sort: score, similarity, file_name, matches_count, position.
        :param max_search_steps: Override number of search/refinement steps.
        :return: Search results with context and Obsidian links.
        """
        emitter = EventEmitter(__event_emitter__)
        user_valves = self._get_user_valves(__user__)

        cfg = {
            "context_chars": self._clamp_int(
                context_chars, user_valves.context_chars, 0, 2000
            ),
            "max_results": self._clamp_int(max_results, user_valves.max_results, 1, 50),
            "fuzzy_threshold": self._clamp_int(
                fuzzy_threshold, user_valves.fuzzy_threshold, 0, 100
            ),
            "sort_by": sort_by or user_valves.sort_by,
            "max_search_steps": self._clamp_int(
                max_search_steps, user_valves.max_search_steps, 1, 5
            ),
        }

        if not user_valves.enable_iterative_search:
            cfg["max_search_steps"] = 1

        vault_path = Path(self.valves.obsidian_path)
        if not vault_path.exists():
            await emitter.error_update(
                f"Vault not found at {self.valves.obsidian_path}"
            )
            return f"Error: Obsidian vault not found at {self.valves.obsidian_path}"

        if user_valves.show_search_strategy:
            await emitter.progress_update(
                f"Search config: steps={cfg['max_search_steps']}, context={cfg['context_chars']}, results={cfg['max_results']}, sort={cfg['sort_by']}"
            )

        initial_keywords = await self._initial_keywords(
            query=query,
            keywords=keywords,
            user_valves=user_valves,
            __model__=__model__,
            emitter=emitter,
        )

        if not initial_keywords:
            await emitter.error_update("Could not extract meaningful keywords")
            return "Could not extract meaningful keywords. Rephrase the query or pass comma-separated keywords."

        markdown_files = self._markdown_files(vault_path)
        file_texts, file_words, words_by_len = self._build_index(
            markdown_files, vault_path
        )
        if not file_texts:
            await emitter.error_update("No markdown files found in vault")
            return f"No markdown files found in Obsidian vault at {self.valves.obsidian_path}"

        executed_steps: List[SearchStep] = []
        all_matches: List[Dict[str, Any]] = []
        used_keyword_sets: List[List[str]] = []

        current_step = SearchStep(
            query=query,
            keywords=initial_keywords[: user_valves.max_keywords_per_step],
            reason="Initial search from provided or extracted keywords.",
        )

        for step_index in range(cfg["max_search_steps"]):
            if self._keyword_set_seen(current_step.keywords, used_keyword_sets):
                break

            used_keyword_sets.append(current_step.keywords)
            executed_steps.append(current_step)

            if user_valves.show_search_strategy:
                await emitter.progress_update(
                    f"Step {step_index + 1}/{cfg['max_search_steps']}: {', '.join(current_step.keywords[:6])}"
                )

            candidates = {
                kw: self._fuzzy_candidates(kw, cfg["fuzzy_threshold"], words_by_len)
                for kw in current_step.keywords
                if " " not in kw
            }
            step_matches = self._search_files(
                file_texts=file_texts,
                file_words=file_words,
                candidates=candidates,
                keywords=current_step.keywords,
                context_chars=cfg["context_chars"],
                fuzzy_threshold=cfg["fuzzy_threshold"],
                step_index=step_index + 1,
                step_reason=current_step.reason,
            )
            all_matches.extend(step_matches)

            if step_index + 1 >= cfg["max_search_steps"]:
                break

            next_step = await self._next_search_step(
                original_query=query,
                previous_step=current_step,
                previous_matches=step_matches,
                all_matches=all_matches,
                user_valves=user_valves,
                __model__=__model__,
            )
            if not next_step:
                break

            current_step = next_step

        all_matches = self._dedupe_matches(all_matches)

        if not all_matches:
            searched = sorted({kw for step in executed_steps for kw in step.keywords})
            await emitter.error_update(f"No matches found for: {', '.join(searched)}")
            return f"No matches found in Obsidian vault for keywords: {', '.join(searched)}"

        all_matches = self._sort_results(all_matches, cfg["sort_by"])
        top_results = all_matches[: cfg["max_results"]]

        await self._emit_citations(top_results, __event_emitter__)

        await emitter.success_update(
            f"Found {len(all_matches)} matches across {len(executed_steps)} step(s), showing {len(top_results)}"
        )

        return self._format_response(
            all_matches=all_matches,
            top_results=top_results,
            executed_steps=executed_steps,
            include_strategy=user_valves.include_strategy_in_response,
        )

    async def get_obsidian_note(
        self,
        path: str,
        max_chars: Optional[int] = 50000,
        __event_emitter__: Optional[Callable[[dict], Any]] = None,
    ) -> str:
        """
        Fetch one full Obsidian note by vault-relative path.

        :param path: Vault-relative note path. Example: "Folder/Note.md" or "Folder/Note"
        :param max_chars: Maximum characters to return. Use 0 for no truncation.
        :return: Full note content with an Obsidian link.
        """
        emitter = EventEmitter(__event_emitter__)
        vault_path = Path(self.valves.obsidian_path)

        if not vault_path.exists():
            await emitter.error_update(
                f"Vault not found at {self.valves.obsidian_path}"
            )
            return f"Error: Obsidian vault not found at {self.valves.obsidian_path}"

        vault_root = vault_path.resolve()
        note_path = self._resolve_note_path(vault_root, path)
        if not note_path:
            await emitter.error_update(f"Note not found: {path}")
            return f"Error: Note not found: {path}"

        try:
            content = note_path.read_text(encoding="utf-8")
        except Exception as e:
            await emitter.error_update(f"Could not read note: {str(e)}")
            return f"Error: Could not read note: {str(e)}"

        relative_path = str(note_path.relative_to(vault_root))
        obsidian_link = self._obsidian_link(relative_path)
        truncated = False

        if max_chars and max_chars > 0 and len(content) > max_chars:
            content = content[:max_chars].rstrip()
            truncated = True

        if __event_emitter__:
            await __event_emitter__(
                {
                    "type": "citation",
                    "data": {
                        "document": [content],
                        "metadata": [
                            {
                                "date_accessed": datetime.now().isoformat(),
                                "source": note_path.name,
                                "path": relative_path,
                                "type": "obsidian_note_full",
                                "truncated": truncated,
                            }
                        ],
                        "source": {"name": note_path.name, "url": obsidian_link},
                    },
                }
            )

        await emitter.success_update(f"Fetched note: {relative_path}")

        suffix = "\n\n_Note truncated by max_chars._" if truncated else ""
        return (
            f"**{note_path.name}** ([open in Obsidian]({obsidian_link}))\n\n"
            f"Path: `{relative_path}`\n\n"
            f"```markdown\n{content}\n```"
            f"{suffix}"
        )

    def _get_user_valves(self, __user__: Optional[dict]) -> UserValves:
        valves = (__user__ or {}).get("valves")
        if isinstance(valves, self.UserValves):
            return valves
        if isinstance(valves, dict):
            return self.UserValves(**valves)
        return self.UserValves()

    def _clamp_int(
        self, override: Optional[int], default: int, minimum: int, maximum: int
    ) -> int:
        value = default if override is None else override
        try:
            value = int(value)
        except (TypeError, ValueError):
            return default
        return max(minimum, min(maximum, value))

    async def _initial_keywords(
        self,
        query: str,
        keywords: Optional[str],
        user_valves: UserValves,
        __model__: Optional[dict],
        emitter: EventEmitter,
    ) -> List[str]:
        if keywords:
            search_keywords = self._normalize_keywords(keywords.split(","))
            await emitter.progress_update(
                f"Using provided keywords: {', '.join(search_keywords[:6])}"
            )
            return search_keywords

        search_keywords = []
        if user_valves.use_ai_extraction:
            await emitter.progress_update("Extracting initial keywords with AI")
            search_keywords = await self._extract_keywords_ai(
                query=query,
                api_base=user_valves.lm_api_base,
                model=self.valves.planner_model,
                __model__=__model__,
            )

        if not search_keywords:
            await emitter.progress_update("Extracting initial keywords locally")
            search_keywords = self._extract_keywords(query)

        return search_keywords

    async def _extract_keywords_ai(
        self,
        query: str,
        api_base: str,
        model: str,
        __model__: Optional[dict] = None,
    ) -> List[str]:
        prompt = (
            "Extract 5-10 precise search keywords or short phrases from the text. "
            'Return JSON only: {"keywords":["keyword"]}.\n\n'
            f"Text: {query}"
        )

        if __model__ and callable(__model__.get("call_model")):
            try:
                response = await __model__["call_model"](
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.2,
                    max_tokens=300,
                )
                content = response.get("content", "")
                return self._parse_keywords_response(content)
            except Exception:
                pass

        try:
            content = await self._chat_completion(
                api_base=api_base,
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=300,
            )
            return self._parse_keywords_response(content)
        except Exception:
            return []

    async def _next_search_step(
        self,
        original_query: str,
        previous_step: SearchStep,
        previous_matches: List[Dict[str, Any]],
        all_matches: List[Dict[str, Any]],
        user_valves: UserValves,
        __model__: Optional[dict],
    ) -> Optional[SearchStep]:
        if user_valves.use_ai_refinement:
            ai_step = await self._refine_step_ai(
                original_query=original_query,
                previous_step=previous_step,
                previous_matches=previous_matches,
                all_matches=all_matches,
                max_keywords=user_valves.max_keywords_per_step,
                __model__=__model__,
            )
            if ai_step:
                return ai_step

        return self._refine_step_local(
            original_query=original_query,
            previous_step=previous_step,
            previous_matches=previous_matches,
            max_keywords=user_valves.max_keywords_per_step,
        )

    async def _refine_step_ai(
        self,
        original_query: str,
        previous_step: SearchStep,
        previous_matches: List[Dict[str, Any]],
        all_matches: List[Dict[str, Any]],
        max_keywords: int,
        __model__: Optional[dict],
    ) -> Optional[SearchStep]:
        summary = self._matches_summary(previous_matches or all_matches)
        prompt = f"""You are planning the next Obsidian vault search.

Original user query:
{original_query}

Previous search keywords:
{", ".join(previous_step.keywords)}

Previous result summary:
{summary}

Return JSON only with a refined next search:
{{
  "query": "short refined search query",
  "reason": "one concise reason",
  "keywords": ["keyword or short phrase"]
}}

Rules:
- Use 3-{max_keywords} keywords.
- Prefer synonyms, related concepts, German/English variants, or narrower terms.
- Do not repeat the same keyword set.
- If no useful refinement exists, return {{"keywords":[]}}.
"""

        try:
            if __model__ and callable(__model__.get("call_model")):
                response = await __model__["call_model"](
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.2,
                    max_tokens=300,
                )
                content = response.get("content", "")
            else:
                content = await self._chat_completion(
                    api_base=self.valves.planner_api_base,
                    model=self.valves.planner_model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.2,
                    max_tokens=300,
                )
        except Exception:
            return None

        data = self._parse_json_object(content)
        keywords = self._normalize_keywords(data.get("keywords", []))[:max_keywords]
        if not keywords:
            return None

        return SearchStep(
            query=str(data.get("query") or original_query),
            keywords=keywords,
            reason=str(data.get("reason") or "AI-refined follow-up search."),
        )

    def _refine_step_local(
        self,
        original_query: str,
        previous_step: SearchStep,
        previous_matches: List[Dict[str, Any]],
        max_keywords: int,
    ) -> Optional[SearchStep]:
        candidates: List[str] = []
        for match in previous_matches[:20]:
            candidates.extend(self._extract_keywords(match.get("context", ""))[:5])

        if not candidates:
            candidates = self._extract_keywords(original_query)

        previous = set(previous_step.keywords)
        keywords = [
            kw for kw in self._normalize_keywords(candidates) if kw not in previous
        ]
        if not keywords:
            return None

        return SearchStep(
            query=original_query,
            keywords=keywords[:max_keywords],
            reason="Local refinement from previous result context.",
        )

    async def _chat_completion(
        self,
        api_base: str,
        model: str,
        messages: List[Dict[str, str]],
        temperature: float,
        max_tokens: int,
    ) -> str:
        async with httpx.AsyncClient(
            timeout=self.valves.planner_timeout_seconds
        ) as client:
            response = await client.post(
                f"{api_base.rstrip('/')}/chat/completions",
                json={
                    "model": model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()

    def _parse_keywords_response(self, content: str) -> List[str]:
        data = self._parse_json_object(content)
        if isinstance(data.get("keywords"), list):
            return self._normalize_keywords(data["keywords"])
        return self._normalize_keywords(content.split(","))

    def _parse_json_object(self, content: str) -> Dict[str, Any]:
        try:
            return json.loads(content)
        except Exception:
            pass

        match = re.search(r"\{.*\}", content, flags=re.DOTALL)
        if not match:
            return {}

        try:
            return json.loads(match.group(0))
        except Exception:
            return {}

    def _extract_keywords(self, query: str) -> List[str]:
        stopwords = {
            "the",
            "a",
            "an",
            "and",
            "or",
            "but",
            "in",
            "on",
            "at",
            "to",
            "for",
            "of",
            "with",
            "by",
            "from",
            "as",
            "is",
            "was",
            "are",
            "been",
            "be",
            "have",
            "has",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
            "may",
            "might",
            "can",
            "this",
            "that",
            "these",
            "those",
            "i",
            "you",
            "he",
            "she",
            "it",
            "we",
            "they",
            "what",
            "which",
            "who",
            "when",
            "where",
            "why",
            "how",
            "all",
            "each",
            "every",
            "both",
            "few",
            "more",
            "most",
            "other",
            "some",
            "such",
            "no",
            "nor",
            "not",
            "only",
            "same",
            "so",
            "than",
            "too",
            "very",
            "just",
            "now",
            "der",
            "die",
            "das",
            "den",
            "dem",
            "des",
            "ein",
            "eine",
            "einen",
            "einem",
            "eines",
            "einer",
            "und",
            "oder",
            "aber",
            "im",
            "an",
            "am",
            "auf",
            "aus",
            "bei",
            "mit",
            "nach",
            "von",
            "vom",
            "zu",
            "zum",
            "zur",
            "für",
            "über",
            "unter",
            "durch",
            "gegen",
            "ohne",
            "um",
            "ist",
            "sind",
            "war",
            "waren",
            "sein",
            "haben",
            "hat",
            "hatte",
            "hatten",
            "werden",
            "wird",
            "wurde",
            "wurden",
            "kann",
            "können",
            "könnte",
            "könnten",
            "muss",
            "müssen",
            "soll",
            "sollen",
            "sollte",
            "sollten",
            "dies",
            "diese",
            "dieser",
            "dieses",
            "welche",
            "welcher",
            "welches",
            "ich",
            "du",
            "er",
            "sie",
            "es",
            "wir",
            "ihr",
            "was",
            "wer",
            "wann",
            "wo",
            "warum",
            "wie",
            "alle",
            "jede",
            "jeder",
            "jedes",
            "kein",
            "keine",
            "nur",
            "auch",
            "sehr",
            "jetzt",
            "dass",
            "ob",
            "wenn",
            "weil",
            "seit",
            "bis",
            "während",
        }

        tokens = re.findall(r"\b[\w\-äöüÄÖÜß]+\b", query.lower())
        keywords = [t for t in tokens if t not in stopwords and len(t) > 2]
        return sorted(set(keywords), key=lambda token: (-len(token), token))[:20]

    def _normalize_keywords(self, raw_keywords: Any) -> List[str]:
        if isinstance(raw_keywords, str):
            raw_keywords = [raw_keywords]

        normalized = []
        seen = set()
        for keyword in raw_keywords or []:
            keyword = re.sub(r"\s+", " ", str(keyword).strip().lower())
            keyword = keyword.strip(" ,.;:!?\"'`")
            if len(keyword) < 2 or keyword in seen:
                continue
            seen.add(keyword)
            normalized.append(keyword)
        return normalized

    def _markdown_files(self, vault_path: Path) -> List[Path]:
        ignored_parts = {".obsidian", ".trash", ".git", "node_modules", "_attachments"}
        files = []
        for md_file in sorted(vault_path.rglob("*.md")):
            if ignored_parts.intersection(md_file.relative_to(vault_path).parts):
                continue
            files.append(md_file)
        return files

    def _resolve_note_path(self, vault_path: Path, path: str) -> Optional[Path]:
        cleaned_path = path.strip().strip("/\\")
        if not cleaned_path:
            return None

        candidates = [cleaned_path]
        if not cleaned_path.lower().endswith(".md"):
            candidates.append(f"{cleaned_path}.md")

        for candidate in candidates:
            note_path = (vault_path / candidate).resolve()
            try:
                note_path.relative_to(vault_path.resolve())
            except ValueError:
                continue
            if note_path.is_file() and note_path.suffix.lower() == ".md":
                return note_path

        wanted_name = Path(cleaned_path).name
        if not wanted_name.lower().endswith(".md"):
            wanted_name = f"{wanted_name}.md"

        matches = [
            md_file
            for md_file in self._markdown_files(vault_path)
            if md_file.name.lower() == wanted_name.lower()
        ]
        if len(matches) == 1:
            return matches[0]

        return None

    def _build_index(
        self, files: List[Path], vault_path: Path
    ) -> tuple:
        """One pass over the vault: file texts, per-file word positions,
        global distinct words by length. Reused across all search steps."""
        file_texts: Dict[str, str] = {}
        file_words: Dict[str, Dict[str, List[int]]] = {}
        words_by_len: Dict[int, set] = {}
        for md_file in files:
            try:
                content = md_file.read_text(encoding="utf-8")
            except Exception:
                continue
            relative_path = str(md_file.relative_to(vault_path))
            file_texts[relative_path] = content
            words: Dict[str, List[int]] = {}
            for m in WORD_RE.finditer(content.lower()):
                words.setdefault(m.group(), []).append(m.start())
            file_words[relative_path] = words
            for word in words:
                words_by_len.setdefault(len(word), set()).add(word)
        return file_texts, file_words, words_by_len

    def _fuzzy_candidates(
        self, keyword: str, threshold: int, words_by_len: Dict[int, set]
    ) -> List[str]:
        """Distinct vault words that can reach the threshold, sorted for
        determinism. Exact integer bounds (no float boundary error):
        - length: |la-lb|*100 <= (100-threshold)*(la+lb)
        - character multiset: indel distance >= sum_c |count_a(c) - count_b(c)|
        """
        if threshold <= 0:
            return sorted({w for ws in words_by_len.values() for w in ws})
        la = len(keyword)
        kw_chars = Counter(keyword)
        rhs = 100 - threshold
        lo = (la * threshold + 199 - threshold) // (200 - threshold)
        hi = (la * (200 - threshold)) // threshold
        out: List[str] = []
        for length in range(lo, hi + 1):
            for word in words_by_len.get(length, ()):
                word_chars = Counter(word)
                delta = sum((kw_chars - word_chars).values()) + sum(
                    (word_chars - kw_chars).values()
                )
                if delta * 100 > rhs * (la + length):
                    continue
                out.append(word)
        return sorted(out)

    def _cached_ratio(self, a: str, b: str) -> float:
        key = (a, b)
        cached = self._ratio_cache.get(key)
        if cached is None:
            cached = fuzz.ratio(a, b)
            self._ratio_cache[key] = cached
        return cached

    def _search_files(
        self,
        file_texts: Dict[str, str],
        file_words: Dict[str, Dict[str, List[int]]],
        candidates: Dict[str, List[str]],
        keywords: List[str],
        context_chars: int,
        fuzzy_threshold: int,
        step_index: int,
        step_reason: str,
    ) -> List[Dict[str, Any]]:
        all_matches: List[Dict[str, Any]] = []

        for relative_path, content in file_texts.items():
            file_matches = self._find_matches(
                text=content,
                file_path=relative_path,
                keywords=keywords,
                fuzzy_threshold=fuzzy_threshold,
                file_words=file_words[relative_path],
                candidates=candidates,
            )

            for match in file_matches:
                context = self._extract_context(
                    content,
                    match["position"],
                    match["length"],
                    context_chars,
                )
                all_matches.append(
                    {
                        "file": Path(relative_path).name,
                        "path": relative_path,
                        "context": context,
                        "keyword": match["keyword"],
                        "matched_word": match["matched_word"],
                        "similarity": match["similarity"],
                        "score": match["score"],
                        "position": match["position"],
                        "step": step_index,
                        "step_reason": step_reason,
                    }
                )

        return all_matches

    def _find_matches(
        self,
        text: str,
        file_path: str,
        keywords: List[str],
        fuzzy_threshold: int,
        file_words: Dict[str, List[int]],
        candidates: Dict[str, List[str]],
    ) -> List[Dict[str, Any]]:
        matches: List[Dict[str, Any]] = []
        text_lower = text.lower()
        file_path_lower = file_path.lower()

        for keyword in keywords:
            if keyword in file_path_lower:
                matches.append(
                    {
                        "position": 0,
                        "length": min(120, len(text)),
                        "keyword": keyword,
                        "matched_word": file_path,
                        "similarity": 100,
                        "score": 130,
                    }
                )

            if " " in keyword:
                for match in re.finditer(re.escape(keyword), text_lower):
                    matches.append(
                        {
                            "position": match.start(),
                            "length": len(match.group()),
                            "keyword": keyword,
                            "matched_word": match.group(),
                            "similarity": 100,
                            "score": 125,
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
                    similarity = self._cached_ratio(keyword, word)
                    if similarity < fuzzy_threshold:
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

        seen_positions = set()
        unique_matches = []
        for match in sorted(matches, key=lambda item: item["score"], reverse=True):
            key = (match["position"], match["keyword"], match["matched_word"])
            if key in seen_positions:
                continue
            seen_positions.add(key)
            unique_matches.append(match)

        return unique_matches

    def _extract_context(
        self, text: str, match_pos: int, match_length: int, context_chars: int
    ) -> str:
        context_start = max(0, match_pos - context_chars)
        context_end = min(len(text), match_pos + match_length + context_chars)

        while context_start > 0 and text[context_start - 1].isalnum():
            context_start -= 1
        while context_end < len(text) and text[context_end].isalnum():
            context_end += 1

        context = text[context_start:context_end].strip()
        if context_start > 0:
            context = "..." + context
        if context_end < len(text):
            context = context + "..."
        return context

    def _dedupe_matches(self, matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        deduped: Dict[tuple, Dict[str, Any]] = {}
        for match in matches:
            context_key = re.sub(r"\s+", " ", match["context"][:160]).lower()
            key = (match["path"], context_key)
            existing = deduped.get(key)
            if not existing or match["score"] > existing["score"]:
                deduped[key] = match
        return list(deduped.values())

    def _sort_results(
        self, matches: List[Dict[str, Any]], sort_by: str
    ) -> List[Dict[str, Any]]:
        if sort_by == "file_name":
            return sorted(matches, key=lambda item: item["file"].lower())
        if sort_by == "matches_count":
            counts: Dict[str, int] = {}
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
        return sorted(
            matches,
            key=lambda item: (
                -item["score"],
                item["step"],
                item["path"],
                item["position"],
            ),
        )

    def _keyword_set_seen(
        self, keywords: List[str], seen_sets: List[List[str]]
    ) -> bool:
        normalized = set(keywords)
        return any(normalized == set(seen) for seen in seen_sets)

    def _matches_summary(self, matches: List[Dict[str, Any]]) -> str:
        if not matches:
            return "No matches."

        lines = []
        for match in self._sort_results(matches, "score")[:8]:
            snippet = re.sub(r"\s+", " ", match.get("context", ""))[:220]
            lines.append(
                f"- {match['path']}: keyword={match['keyword']}, matched={match['matched_word']}, snippet={snippet}"
            )
        return "\n".join(lines)

    async def _emit_citations(
        self,
        results: List[Dict[str, Any]],
        event_emitter: Optional[Callable[[dict], Any]],
    ):
        if not event_emitter:
            return

        for result in results:
            obsidian_link = self._obsidian_link(result["path"])
            await event_emitter(
                {
                    "type": "citation",
                    "data": {
                        "document": [result["context"]],
                        "metadata": [
                            {
                                "date_accessed": datetime.now().isoformat(),
                                "source": result["file"],
                                "path": result["path"],
                                "keyword": result["keyword"],
                                "matched_word": result["matched_word"],
                                "step": result["step"],
                                "type": "obsidian_note",
                            }
                        ],
                        "source": {"name": result["file"], "url": obsidian_link},
                    },
                }
            )

    def _format_response(
        self,
        all_matches: List[Dict[str, Any]],
        top_results: List[Dict[str, Any]],
        executed_steps: List[SearchStep],
        include_strategy: bool,
    ) -> str:
        response = (
            f"Found {len(all_matches)} matches in your Obsidian vault. "
            f"Showing top {len(top_results)} results.\n\n"
        )

        if include_strategy:
            response += "## Search strategy\n\n"
            for index, step in enumerate(executed_steps, 1):
                response += f"{index}. {step.reason}\n"
                response += f"   Keywords: {', '.join(step.keywords)}\n\n"

        response += "## Results\n\n"
        for index, result in enumerate(top_results, 1):
            obsidian_link = self._obsidian_link(result["path"])
            response += (
                f"**{index}. {result['file']}** ([open in Obsidian]({obsidian_link}))\n"
            )
            response += (
                f"_Step {result['step']}; matched: {result['matched_word']} "
                f"(keyword: {result['keyword']}, score: {result['score']})_\n\n"
            )
            response += f"```text\n{result['context']}\n```\n\n"

        return response

    def _obsidian_link(self, path: str) -> str:
        encoded_vault = quote(self.valves.vault_name)
        note = path[:-3] if path.endswith(".md") else path
        encoded_file = quote(note)
        return f"obsidian://open?vault={encoded_vault}&file={encoded_file}"
