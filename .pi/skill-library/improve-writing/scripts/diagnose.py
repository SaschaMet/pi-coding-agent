#!/usr/bin/env python3
"""
diagnose.py - mechanical diagnostics for the improve-writing skill.

Runs the checks that are countable so the model does not have to do them by
hand. It measures; it does not judge. Every number here is a pointer to a place
worth reading, not a verdict. Read references/01-diagnose.md to interpret.

Usage:
    python3 diagnose.py DRAFT.md
    python3 diagnose.py DRAFT.md --json
    python3 diagnose.py DRAFT.md --full     # do not truncate long lists

Stdlib only. No network. Works on .md, .txt, or plain stdin ("-").
"""

import argparse
import json
import re
import sys
from collections import Counter

# ---------------------------------------------------------------- vocabularies

ABBREV = {"mr", "mrs", "ms", "dr", "prof", "st", "e.g", "i.e", "etc", "vs",
          "fig", "no", "vol", "cf", "al", "inc", "ltd", "jr", "sr"}

VERB_CUES = {
    "is", "are", "was", "were", "be", "been", "being", "am",
    "has", "have", "had", "do", "does", "did",
    "can", "could", "will", "would", "shall", "should", "may", "might", "must",
    "seems", "seem", "becomes", "become", "remains", "remain", "makes", "make",
    "gives", "give", "gets", "get", "goes", "go", "comes", "come", "shows",
    "show", "means", "mean", "needs", "need", "wants", "want", "works", "work",
    "helps", "help", "tells", "tell", "says", "say", "knows", "know", "takes",
    "take", "puts", "put", "uses", "use", "finds", "find", "keeps", "keep",
}

IRREGULAR_PARTICIPLES = {
    "seen", "made", "done", "taken", "given", "written", "held", "told",
    "known", "shown", "built", "found", "kept", "left", "sent", "brought",
    "thought", "bought", "caught", "taught", "understood", "driven", "chosen",
    "forgotten", "hidden", "broken", "spoken", "drawn", "grown", "born",
    "begun", "run", "set", "put", "read", "cut", "let", "met", "paid", "said",
}

BE_FORMS = {"is", "are", "was", "were", "be", "been", "being", "am",
            "get", "gets", "got", "gotten", "becomes", "became"}

NOMINALIZATION_SUFFIX = ("tion", "sion", "ment", "ance", "ence", "ity", "ness",
                         "ancy", "ency", "ure", "ism", "ation")

# Words that carry these suffixes but read as ordinary things, not buried verbs.
NOMINALIZATION_SAFE = {
    "information", "question", "section", "position", "condition", "nature",
    "picture", "future", "culture", "structure", "literature", "temperature",
    "opportunity", "community", "quality", "quantity", "university", "city",
    "ability", "reality", "security", "activity", "authority", "majority",
    "minority", "identity", "capacity", "density", "priority", "utility",
    "business", "witness", "government", "moment", "document", "instrument",
    "environment", "equipment", "element", "argument", "experience", "science",
    "audience", "evidence", "difference", "sentence", "distance", "instance",
    "performance", "importance", "balance", "chance", "finance", "insurance",
    "marketing", "meeting", "morning", "nation", "station", "generation",
    "population", "corporation", "organization", "operation", "relation",
    "tradition", "solution", "vision", "decision", "version", "mission",
}

METADISCOURSE = [
    r"\bthis (?:chapter|section|subsection|article|post|essay|paper|piece|note|document|guide) (?:discusses|explains|explores|examines|describes|covers|will|argues|shows|presents|raises|analyz)",
    r"\bin this (?:chapter|section|article|post|essay|paper|piece|note|document|guide)\b",
    r"\bthe (?:previous|preceding|following|next|last|above|foregoing) (?:chapter|section|paragraph|part)\b",
    r"\bas (?:mentioned|noted|stated|discussed|described|explained) (?:above|earlier|previously|before)\b",
    r"\bwill be (?:discussed|examined|explored|explained|presented|addressed|covered)\b",
    r"\bthe (?:first|second|third|final|last) (?:topic|point|section|part) (?:to be |we will |i will )",
    r"\bit (?:is|should be) (?:important|worth|useful|necessary) to (?:note|mention|remember|point out)\b",
    r"\bi will (?:now )?(?:discuss|explain|explore|examine|argue|show|describe|cover)\b",
    r"\bwe will (?:now )?(?:discuss|explain|explore|examine|see|turn|look at)\b",
    r"\bin (?:conclusion|summary)\b",
    r"\bto (?:sum up|summarize|conclude)\b",
    r"\bthis (?:brings us to|leads us to)\b",
]

SUBORDINATORS = {"since", "because", "although", "though", "while", "when",
                 "whenever", "if", "unless", "after", "before", "as", "given",
                 "despite", "whereas", "whether", "until", "once", "having",
                 "following", "during", "throughout", "in", "for", "with",
                 "by", "on", "at", "from", "under", "through", "without"}

FLABBY = [
    (r"\bthere (?:is|are|was|were|has been|have been)\b", "there is/are"),
    (r"\bwas (?:undertaken|conducted|performed|carried out)\b", "flabby passive verb"),
    (r"\btook place\b", "took place"),
    (r"\boccurred\b", "occurred"),
    (r"\bresulted in\b", "resulted in"),
    (r"\bthe fact that\b", "the fact that"),
    (r"\bthe idea that\b", "the idea that"),
    (r"\bin order to\b", "in order to"),
    (r"\bis able to\b", "is able to"),
    (r"\bmake use of\b", "make use of"),
    (r"\bon the part of\b", "on the part of"),
    (r"\bwith regard to\b|\bwith respect to\b|\bin terms of\b", "vague connector"),
    (r"\bit is (?:clear|obvious|evident) that\b", "it is X that"),
]

HEDGES = {"very", "really", "quite", "rather", "somewhat", "fairly", "pretty",
          "basically", "essentially", "actually", "arguably", "perhaps",
          "maybe", "possibly", "generally", "typically", "often", "just",
          "simply", "literally", "certainly", "obviously", "clearly"}

STOPWORDS = set("""a an the and or but if then than that this these those of in on at to for
from by with without about into over under again further once here there when where why how all
any both each few more most other some such no nor not only own same so too very can will just
should now i you he she it we they them his her its our your their my me him us do does did done
be been being am is are was was were have has had having would could shall may might must as
what which who whom while because until although though however therefore thus also even still
one two three first second third new like get got go went make made say said see seen know knew""".split())

# ---------------------------------------------------------------- segmentation


def read_text(path):
    if path == "-":
        return sys.stdin.read()
    with open(path, encoding="utf-8", errors="replace") as fh:
        return fh.read()


def headings(text):
    return [m.group(2).strip() for m in
            re.finditer(r"^\s{0,3}(#{1,6})\s+(.+)$", text, flags=re.M)]


def strip_markup(text):
    text = re.sub(r"```.*?```", " ", text, flags=re.S)          # fenced code
    text = re.sub(r"`[^`]*`", " ", text)                        # inline code
    text = re.sub(r"!\[\[?[^\]]*\]\]?", " ", text)              # embeds
    text = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", text)  # wikilinks
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)        # md links
    text = re.sub(r"^\s{0,3}#{1,6}\s+.*$", "", text, flags=re.M)  # headings (kept separately)
    text = re.sub(r"^\s{0,3}>\s?", "", text, flags=re.M)        # quotes
    text = re.sub(r"[*_~]{1,3}", "", text)                      # emphasis
    return text


def paragraphs(text):
    out = []
    for block in re.split(r"\n\s*\n", text):
        block = " ".join(block.split())
        if len(block.split()) >= 3:
            out.append(block)
    return out


def sentences(para):
    parts, buf = [], ""
    for chunk in re.split(r"(?<=[.!?])\s+", para):
        buf = (buf + " " + chunk).strip() if buf else chunk
        last = buf.rstrip(".!?\"')").split()
        tail = last[-1].lower().strip(".,;:") if last else ""
        if tail in ABBREV or re.fullmatch(r"[A-Z]", tail or "x"):
            continue
        parts.append(buf)
        buf = ""
    if buf:
        parts.append(buf)
    return [p for p in parts if p.split()]


def words(s):
    return re.findall(r"[A-Za-z][A-Za-z'-]*", s)

# ------------------------------------------------------------------- the checks


def topic_strip(sent, cap=8):
    toks = words(sent)
    strip, gap = [], None
    for i, t in enumerate(toks[:20]):
        if t.lower() in VERB_CUES and i > 0:
            gap = i
            break
        strip.append(t)
        if len(strip) >= cap:
            break
    return " ".join(strip), gap


def check_nominalizations(sent):
    hits = []
    for w in words(sent):
        low = w.lower()
        if low in NOMINALIZATION_SAFE or len(low) < 7:
            continue
        if low.endswith(NOMINALIZATION_SUFFIX):
            hits.append(w)
        elif low.endswith("tions") or low.endswith("ments") or low.endswith("ities"):
            hits.append(w)
    return hits


def check_passive(sent):
    toks = [t.lower() for t in words(sent)]
    out = []
    for i in range(len(toks) - 1):
        if toks[i] in BE_FORMS:
            nxt = toks[i + 1]
            cand = nxt
            if nxt in {"not", "also", "then", "being"} and i + 2 < len(toks):
                cand = toks[i + 2]
            if cand.endswith("ed") and len(cand) > 4 or cand in IRREGULAR_PARTICIPLES:
                out.append(f"{toks[i]} {cand}")
    return out


def check_long_intro(sent):
    toks = words(sent)
    if not toks:
        return None
    if toks[0].lower() not in SUBORDINATORS:
        return None
    m = re.search(r",", sent)
    if not m:
        return None
    n = len(words(sent[:m.start()]))
    return n if n >= 8 else None


def content_words(s):
    return [w.lower() for w in words(s)
            if w.lower() not in STOPWORDS and len(w) > 3]


PRONOUN_LINKS = {"it", "its", "they", "them", "their", "he", "his", "she", "her",
                 "this", "that", "these", "those", "such", "both", "each",
                 "one", "another", "the", "there"}

LEAD_SKIP = {"but", "and", "so", "then", "yet", "however", "instead", "still",
             "meanwhile", "therefore", "thus", "also", "in", "of", "for", "at",
             "on", "by", "fact", "addition", "contrast", "short", "other",
             "words", "course", "turn"}


def handoff(prev, nxt, tail=12, head=10):
    """Does the start of nxt pick up the end of prev?

    Three ways a real writer makes this link, all of which count:
      - repetition   : the same content word appears again
      - a shared stem: plural, verb form, or close analog
      - a pronoun    : 'it', 'they', 'this' pointing back

    Synonyms ('his computer' -> 'the machine') cannot be caught without a
    lexicon, so a reported break is a place to LOOK, never a confirmed fault.
    """
    a = set(content_words(" ".join(words(prev)[-tail:])))
    b_tokens = [w.lower() for w in words(nxt)[:head]]
    b = set(content_words(" ".join(words(nxt)[:head])))

    shared = a & b
    if shared:
        return True, "repetition", sorted(shared)

    for x in a:
        for y in b:
            if len(x) > 4 and x[:5] == y[:5]:
                return True, "stem", [f"{x}/{y}"]

    for tok in b_tokens[:3]:
        if tok in LEAD_SKIP:
            continue
        if tok in PRONOUN_LINKS:
            return True, "pronoun", [tok]
        break

    return False, "none", []


# ------------------------------------------------------------------ the report


def analyse(raw):
    heads = headings(raw)
    text = strip_markup(raw)
    paras = paragraphs(text)
    sents_by_para = [sentences(p) for p in paras]
    flat = [s for group in sents_by_para for s in group]

    lengths = [len(words(s)) for s in flat]
    report = {
        "totals": {
            "paragraphs": len(paras),
            "sentences": len(flat),
            "words": sum(lengths),
            "mean_sentence_words": round(sum(lengths) / len(lengths), 1) if lengths else 0,
            "longest_sentence_words": max(lengths) if lengths else 0,
        },
        "outline": heads,
        "skim_test": [g[0] for g in sents_by_para if g],
        "topic_strip": [],
        "long_subject_verb_gap": [],
        "long_sentences": [],
        "nominalizations": [],
        "passive_candidates": [],
        "long_intro_clauses": [],
        "metadiscourse": [],
        "flabby": [],
        "hedges": [],
        "adverbs_ly": [],
        "handoff_breaks": [],
        "handoff_kinds": {},
        "key_terms": [],
        "paragraph_threading": [],
    }

    for i, s in enumerate(flat, 1):
        strip, gap = topic_strip(s)
        report["topic_strip"].append({"n": i, "topic": strip})
        if gap and gap >= 9:
            report["long_subject_verb_gap"].append({"n": i, "words_before_verb": gap,
                                                    "sentence": s[:160]})
        if len(words(s)) >= 40:
            report["long_sentences"].append({"n": i, "words": len(words(s)),
                                             "sentence": s[:160]})
        noms = check_nominalizations(s)
        if noms:
            report["nominalizations"].append({"n": i, "words": noms})
        pas = check_passive(s)
        if pas:
            report["passive_candidates"].append({"n": i, "forms": pas})
        li = check_long_intro(s)
        if li:
            report["long_intro_clauses"].append({"n": i, "words_before_comma": li,
                                                 "sentence": s[:160]})
        low = s.lower()
        for pat in METADISCOURSE:
            m = re.search(pat, low)
            if m:
                report["metadiscourse"].append({"n": i, "match": m.group(0)})
                break
        for pat, label in FLABBY:
            if re.search(pat, low):
                report["flabby"].append({"n": i, "label": label})
        h = [w for w in words(s) if w.lower() in HEDGES]
        if h:
            report["hedges"].append({"n": i, "words": h})
        adv = [w for w in words(s) if w.lower().endswith("ly") and len(w) > 5
               and w.lower() not in {"only", "early", "likely", "family", "reply", "apply"}]
        if adv:
            report["adverbs_ly"].append({"n": i, "words": adv})

    # cohesion handoffs, within paragraphs only
    n = 0
    for group in sents_by_para:
        for a, b in zip(group, group[1:]):
            n += 1
            ok, kind, shared = handoff(a, b)
            if ok:
                report["handoff_kinds"][kind] = report["handoff_kinds"].get(kind, 0) + 1
            else:
                report["handoff_breaks"].append({"from": a[-70:], "to": b[:70]})
    report["totals"]["handoff_pairs"] = n
    report["totals"]["handoff_breaks"] = len(report["handoff_breaks"])

    # key terms and whether each paragraph develops the terms its index announces
    freq = Counter(content_words(text))
    report["key_terms"] = [{"term": t, "count": c} for t, c in freq.most_common(15)]
    for i, group in enumerate(sents_by_para, 1):
        if len(group) < 2:
            continue
        idx = set(content_words(group[0]))
        body = set(content_words(" ".join(group[1:])))
        carried = sorted(idx & body)
        report["paragraph_threading"].append({
            "paragraph": i,
            "index_terms": sorted(idx)[:12],
            "carried_into_discussion": carried,
            "dropped": sorted(idx - body)[:12],
        })
    return report


def truncate(lst, full, k=12):
    return lst if full else lst[:k]


def render(r, full=False):
    t = r["totals"]
    L = []
    add = L.append
    add("=" * 72)
    add("MECHANICAL DIAGNOSIS")
    add("=" * 72)
    add(f"{t['paragraphs']} paragraphs | {t['sentences']} sentences | {t['words']} words")
    add(f"mean sentence {t['mean_sentence_words']} words | longest {t['longest_sentence_words']} words")
    add("")

    if r["outline"]:
        add("-- OUTLINE (your headings) " + "-" * 45)
        add("Headings set the context readers interpret each section in. Build them")
        add("from the key concepts that recur inside the section. Clear, not clever.")
        add("")
        for h in r["outline"]:
            add(f"  # {h}")
        add("")

    add("-- SKIM TEST (index sentence of each paragraph) " + "-" * 24)
    add("Read only these. If this skeleton does not outline the whole story,")
    add("the structure is broken no matter how good the sentences are.")
    add("")
    for i, s in enumerate(r["skim_test"], 1):
        add(f"  {i:>3}. {s[:150]}")
    add("")

    add("-- TOPIC STRIP (what each sentence is about) " + "-" * 27)
    add("Read only these. Do they name a small set of related, important")
    add("characters? Can you say what the passage is about from this list alone?")
    add("")
    for row in truncate(r["topic_strip"], full, 40):
        add(f"  {row['n']:>3}. {row['topic']}")
    if not full and len(r["topic_strip"]) > 40:
        add(f"  ... {len(r['topic_strip']) - 40} more (rerun with --full)")
    add("")

    def block(title, key, fmt, why):
        rows = r[key]
        add(f"-- {title}: {len(rows)} " + "-" * max(4, 60 - len(title)))
        add(f"   {why}")
        if not rows:
            add("   none found")
        for row in truncate(rows, full):
            add("   " + fmt(row))
        if not full and len(rows) > 12:
            add(f"   ... {len(rows) - 12} more (rerun with --full)")
        add("")

    kinds = ", ".join(f"{v} by {k}" for k, v in sorted(r["handoff_kinds"].items())) or "none"
    block("COHESION - POSSIBLE HANDOFF BREAKS", "handoff_breaks",
          lambda x: f"...{x['from']}  ||  {x['to']}...",
          f"{t['handoff_pairs'] - t['handoff_breaks']} of {t['handoff_pairs']} pairs link "
          f"({kinds}). The pairs below share no word, stem, or pointing pronoun. "
          "A synonym link cannot be detected here, so READ each one before changing it.")
    block("LONG SUBJECT-VERB GAP", "long_subject_verb_gap",
          lambda x: f"s{x['n']} ({x['words_before_verb']} words before the verb): {x['sentence']}",
          "Obstacles on the runway. The reader holds the subject in memory and waits.")
    block("SENTENCES 40+ WORDS", "long_sentences",
          lambda x: f"s{x['n']} ({x['words']}w): {x['sentence']}", "Candidates for splitting.")
    block("LONG INTRODUCTORY CLAUSES", "long_intro_clauses",
          lambda x: f"s{x['n']} ({x['words_before_comma']}w before the comma): {x['sentence']}",
          "Move to the end or split into its own sentence.")
    block("NOMINALIZATION CANDIDATES", "nominalizations",
          lambda x: f"s{x['n']}: " + ", ".join(x["words"]),
          "Zombie nouns. Keep only the ones that link back, replace 'the fact that', "
          "act as a concrete object, or are familiar to this reader.")
    block("PASSIVE VOICE (informational, not an error)", "passive_candidates",
          lambda x: f"s{x['n']}: " + ", ".join(x["forms"]),
          "Keep every passive that puts old information first. Cut the rest.")
    block("META-DISCOURSE", "metadiscourse",
          lambda x: f"s{x['n']}: \"{x['match']}\"",
          "Writing about writing. Replace with a question, 'as we have seen', or 'let us now'.")
    block("FLABBY CONSTRUCTIONS", "flabby",
          lambda x: f"s{x['n']}: {x['label']}", "Usually a buried character or action.")
    block("HEDGES AND FILLER", "hedges",
          lambda x: f"s{x['n']}: " + ", ".join(x["words"]),
          "Cut when trimming. Add deliberately when building an Opinionator voice.")
    block("-LY ADVERBS", "adverbs_ly",
          lambda x: f"s{x['n']}: " + ", ".join(x["words"]),
          "A voice dial: adverbs up for emphasis, down for a facts-first register.")

    add("-- KEY TERMS (most frequent content words) " + "-" * 29)
    add("   These are the threads the reader actually experiences as coherence.")
    add("   " + ", ".join(f"{k['term']} ({k['count']})" for k in r["key_terms"]))
    add("")

    add("-- PARAGRAPH THREADING " + "-" * 49)
    add("   Does each paragraph develop the terms its own index announced?")
    for row in truncate(r["paragraph_threading"], full):
        add(f"   p{row['paragraph']}: carried {row['carried_into_discussion'] or '[none]'}")
        if row["dropped"]:
            add(f"        dropped {row['dropped']}")
    add("")
    add("=" * 72)
    add("Counts are pointers, not verdicts. Read references/01-diagnose.md.")
    add("=" * 72)
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description="Mechanical diagnostics for a draft.")
    ap.add_argument("path", help="file to analyse, or - for stdin")
    ap.add_argument("--json", action="store_true", help="emit raw JSON")
    ap.add_argument("--full", action="store_true", help="do not truncate lists")
    a = ap.parse_args()
    raw = read_text(a.path)
    if not raw.strip():
        print("empty input", file=sys.stderr)
        return 1
    r = analyse(raw)
    print(json.dumps(r, indent=2) if a.json else render(r, a.full))
    return 0


if __name__ == "__main__":
    sys.exit(main())
