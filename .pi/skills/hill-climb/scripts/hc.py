#!/usr/bin/env python3
"""hc.py - bookkeeping for a hill-climb run.

Owns the run folder: matrix, baseline, verifier checksum, per-round scores,
best state, plateau and budget counters. The verifier itself is task-specific
and written per run; this script only executes it and scores its output.

Verifier contract: non-interactive, run with cwd = the artifact directory,
exit 0, last stdout line is one JSON object with one number per criterion
name. Anything else is a verifier error, never a score.

Commands (all print one JSON object on stdout; diagnostics go to stderr):

  init        record matrix, verifier checksum and baseline scores
  score       run the verifier for one candidate, record and judge it
  close-round pick the round's best candidate, update best, decide stop/continue
  status      print the run summary (--markdown gives the report table)
  example     print an example matrix.json

Exit codes: 0 ok, 2 invalid input, 3 verifier failure, 4 verifier tampered.
Stdlib only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shlex
import statistics
import subprocess
import sys
from pathlib import Path

RUN_FILE = "run.json"
LOG_FILE = "log.jsonl"
DIRECTIONS = ("higher", "lower")
AGGREGATES = ("weighted-sum", "custom")
# A candidate must beat the best by more than this to count as a gain; it
# filters floating-point noise, not measurement noise (use `repeat` for that).
MIN_GAIN = 1e-9
# Progress per criterion is capped at 1.0: a target met is met, overshooting
# one criterion must not pay for regressions on another beyond the trade-off
# the weights already express.
PROGRESS_CAP = 1.0
# Default verifier timeout in seconds; a build plus an e2e run fits, a hang does not.
VERIFIER_TIMEOUT = 1800
DEFAULT_BUDGET = 10
DEFAULT_PLATEAU = 3
DEFAULT_MAX_WORKERS = 5

EXAMPLE_MATRIX = {
    "artifact": "path or one-line description of what is being improved",
    "verifier": "verify.py",
    "verifier_cmd": "python3 -I {verifier}",
    "aggregate": "weighted-sum",
    "budget_rounds": DEFAULT_BUDGET,
    "plateau_rounds": DEFAULT_PLATEAU,
    "max_workers": DEFAULT_MAX_WORKERS,
    "criteria": [
        {
            "name": "test_wall_ms",
            "measure": "wall time of `bun run test` in ms, median of 3 runs",
            "unit": "ms",
            "direction": "lower",
            "target": 20000,
            "weight": 2,
            "repeat": 3,
        },
        {
            "name": "tests_passing",
            "measure": "count of passing tests from the JSON reporter",
            "unit": "count",
            "direction": "higher",
            "target": 412,
            "weight": 1,
            "floor": 412,
        },
    ],
}


def fail(code: int, msg: str) -> None:
    print(f"hc: {msg}", file=sys.stderr)
    sys.exit(code)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path, what: str) -> dict:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        fail(2, f"{what} not found: {path}")
    except json.JSONDecodeError as e:
        fail(2, f"{what} is not valid JSON ({path}): {e}")
    return {}


def is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate_matrix(m: dict) -> list[str]:
    errors: list[str] = []
    for key in ("verifier", "criteria"):
        if key not in m:
            errors.append(f"missing key: {key}")
    agg = m.get("aggregate", "weighted-sum")
    if agg not in AGGREGATES:
        errors.append(f"aggregate must be one of {AGGREGATES}, got {agg!r}")
    if agg == "custom" and not m.get("aggregate_cmd"):
        errors.append("aggregate=custom needs aggregate_cmd (reads scores JSON on stdin, prints one number)")
    for key in ("budget_rounds", "plateau_rounds", "max_workers"):
        v = m.get(key)
        if v is not None and (not isinstance(v, int) or isinstance(v, bool) or v < 1):
            errors.append(f"{key} must be a positive integer, got {v!r}")
    names: set[str] = set()
    for i, c in enumerate(m.get("criteria") or []):
        where = f"criteria[{i}]"
        name = c.get("name")
        if not name:
            errors.append(f"{where}: missing name")
            continue
        if name in names:
            errors.append(f"{where}: duplicate name {name!r}")
        names.add(name)
        for key in ("measure", "unit"):
            if not c.get(key):
                errors.append(f"{where} {name}: missing {key} (every criterion needs a measurement and a unit)")
        if c.get("direction") not in DIRECTIONS:
            errors.append(f"{where} {name}: direction must be one of {DIRECTIONS}, got {c.get('direction')!r}")
        if not is_number(c.get("target")):
            errors.append(f"{where} {name}: target must be a number, got {c.get('target')!r}")
        w = c.get("weight", 1)
        if not is_number(w) or w <= 0:
            errors.append(f"{where} {name}: weight must be > 0, got {w!r}")
        r = c.get("repeat", 1)
        if not isinstance(r, int) or isinstance(r, bool) or r < 1:
            errors.append(f"{where} {name}: repeat must be a positive integer, got {r!r}")
        if c.get("floor") is not None and not is_number(c["floor"]):
            errors.append(f"{where} {name}: floor must be a number or null, got {c['floor']!r}")
    if not names and "criteria" in m:
        errors.append("criteria is empty")
    return errors


def verifier_cmd(m: dict, verifier: Path) -> list[str]:
    tpl = m.get("verifier_cmd") or "python3 -I {verifier}"
    return [part.replace("{verifier}", str(verifier)) for part in shlex.split(tpl)]


def run_verifier(m: dict, verifier: Path, cwd: Path, repeats: int, timeout: int) -> dict[str, float]:
    """Run the verifier `repeats` times; return the per-criterion median."""
    samples: dict[str, list[float]] = {c["name"]: [] for c in m["criteria"]}
    cmd = verifier_cmd(m, verifier)
    for n in range(repeats):
        try:
            p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        except FileNotFoundError as e:
            fail(3, f"verifier command not runnable: {e}")
        except subprocess.TimeoutExpired:
            fail(3, f"verifier timed out after {timeout}s (run {n + 1}/{repeats})")
        if p.returncode != 0:
            print(p.stderr[-4000:], file=sys.stderr)
            fail(3, f"verifier exited {p.returncode} (run {n + 1}/{repeats}); stderr above")
        lines = p.stdout.strip().splitlines()
        try:
            out = json.loads(lines[-1]) if lines else None
        except json.JSONDecodeError:
            out = None
        if not isinstance(out, dict):
            print(p.stdout[-2000:], file=sys.stderr)
            fail(3, "verifier stdout's last line must be one JSON object")
        for name in samples:
            v = out.get(name)
            if not is_number(v):
                fail(3, f"verifier output lacks a numeric value for criterion {name!r}: {v!r}")
            samples[name].append(float(v))
        extra = set(out) - set(samples)
        if extra:
            print(f"hc: verifier printed unknown criteria (ignored): {sorted(extra)}", file=sys.stderr)
    return {name: statistics.median(vals) for name, vals in samples.items()}


def progress(c: dict, baseline: float, value: float) -> float:
    """0 at baseline, 1 at target, negative below baseline, capped at PROGRESS_CAP."""
    span = c["target"] - baseline
    if span == 0:
        # Baseline already meets the target: regression is negative, otherwise met.
        delta = value - baseline if c["direction"] == "higher" else baseline - value
        return PROGRESS_CAP if delta >= 0 else -abs(delta) / (abs(baseline) or 1.0)
    return min(PROGRESS_CAP, (value - baseline) / span)


def target_met(c: dict, value: float) -> bool:
    return value >= c["target"] if c["direction"] == "higher" else value <= c["target"]


def floor_ok(c: dict, value: float) -> bool:
    f = c.get("floor")
    if f is None:
        return True
    return value >= f if c["direction"] == "higher" else value <= f


def aggregate(m: dict, baseline: dict, scores: dict) -> tuple[float, dict]:
    per = {}
    total = 0.0
    wsum = 0.0
    for c in m["criteria"]:
        name = c["name"]
        p = progress(c, baseline[name], scores[name])
        w = float(c.get("weight", 1))
        per[name] = {
            "value": scores[name],
            "baseline": baseline[name],
            "target": c["target"],
            "progress": round(p, 6),
            "met": target_met(c, scores[name]),
            "floor_ok": floor_ok(c, scores[name]),
        }
        total += w * p
        wsum += w
    if m.get("aggregate", "weighted-sum") == "custom":
        payload = json.dumps({"criteria": m["criteria"], "baseline": baseline, "scores": scores, "per": per})
        p = subprocess.run(shlex.split(m["aggregate_cmd"]), input=payload, capture_output=True, text=True)
        if p.returncode != 0:
            print(p.stderr[-2000:], file=sys.stderr)
            fail(3, f"aggregate_cmd exited {p.returncode}")
        try:
            return float(p.stdout.strip().splitlines()[-1]), per
        except (ValueError, IndexError):
            fail(3, f"aggregate_cmd must print one number, got {p.stdout!r}")
    return total / wsum, per


def all_met(per: dict) -> bool:
    return all(v["met"] for v in per.values())


def floors_broken(per: dict) -> list[str]:
    return [k for k, v in per.items() if not v["floor_ok"]]


def run_dir(args) -> Path:
    return Path(args.run).expanduser().resolve()


def load_run(args) -> tuple[Path, dict]:
    d = run_dir(args)
    return d, load_json(d / RUN_FILE, "run file (did you run `hc.py init`?)")


def save_run(d: Path, run: dict) -> None:
    (d / RUN_FILE).write_text(json.dumps(run, indent=2) + "\n")


def append_log(d: Path, entry: dict) -> None:
    with (d / LOG_FILE).open("a") as fh:
        fh.write(json.dumps(entry) + "\n")


def read_log(d: Path) -> list[dict]:
    p = d / LOG_FILE
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


def check_verifier(d: Path, run: dict) -> None:
    v = d / run["verifier"]
    if not v.exists():
        fail(4, f"verifier missing from run folder: {v}")
    if sha256(v) != run["verifier_sha256"]:
        fail(4, f"verifier checksum changed since init: {v}. Scores are not trusted. Restore the file, then score again; re-baseline only with the operator's approval.")


def emit(obj: dict) -> None:
    print(json.dumps(obj, indent=2))


# ---------------------------------------------------------------- commands


def cmd_init(args) -> None:
    d = run_dir(args)
    d.mkdir(parents=True, exist_ok=True)
    if (d / RUN_FILE).exists() and not args.force:
        fail(2, f"{d / RUN_FILE} exists; pass --force to re-baseline (this discards the run history)")
    m = load_json(Path(args.matrix), "matrix")
    errors = validate_matrix(m)
    if errors:
        fail(2, "matrix invalid:\n  - " + "\n  - ".join(errors))
    verifier = d / m["verifier"]
    if not verifier.exists():
        fail(2, f"verifier not found in run folder: {verifier} (copy it there first; workers never write there)")
    cwd = Path(args.cwd).resolve()
    if not cwd.is_dir():
        fail(2, f"--cwd is not a directory: {cwd}")
    repeats = max(int(c.get("repeat", 1)) for c in m["criteria"])
    if args.dry_run:
        emit({"dry_run": True, "verifier_cmd": verifier_cmd(m, verifier), "cwd": str(cwd), "repeats": repeats})
        return
    baseline = run_verifier(m, verifier, cwd, repeats, args.timeout)
    # The baseline's own aggregate is not 0 when a criterion already meets its
    # target (progress is capped at 1 there); record the real value as best.
    base_agg, per = aggregate(m, baseline, baseline)
    run = {
        "matrix": m,
        "verifier": m["verifier"],
        "verifier_sha256": sha256(verifier),
        "baseline": baseline,
        "baseline_cwd": str(cwd),
        "best": {"round": 0, "worker": "baseline", "cwd": str(cwd), "aggregate": base_agg, "scores": baseline},
        "rounds": [],
        "plateau": 0,
        "stop": "targets_met" if all_met(per) else None,
    }
    (d / "matrix.json").write_text(json.dumps(m, indent=2) + "\n")
    (d / LOG_FILE).write_text("")
    save_run(d, run)
    append_log(d, {"event": "init", "baseline": baseline, "verifier_sha256": run["verifier_sha256"]})
    emit({"run": str(d), "baseline": baseline, "baseline_aggregate": round(base_agg, 6), "per": per, "verifier_sha256": run["verifier_sha256"], "stop": run["stop"]})


def cmd_score(args) -> None:
    d, run = load_run(args)
    m = run["matrix"]
    check_verifier(d, run)
    cwd = Path(args.cwd).resolve()
    if not cwd.is_dir():
        fail(2, f"--cwd is not a directory: {cwd}")
    if args.round < 1:
        fail(2, "--round must be >= 1")
    repeats = max(int(c.get("repeat", 1)) for c in m["criteria"])
    scores = run_verifier(m, d / run["verifier"], cwd, repeats, args.timeout)
    agg, per = aggregate(m, run["baseline"], scores)
    broken = floors_broken(per)
    best = run["best"]["aggregate"]
    valid = not broken
    improves = valid and agg > best + MIN_GAIN
    entry = {
        "event": "score",
        "round": args.round,
        "worker": args.worker,
        "cwd": str(cwd),
        "direction": args.direction,
        # Stored unrounded: MIN_GAIN comparisons across commands must see the same float.
        "aggregate": agg,
        "scores": scores,
        "per": per,
        "floors_broken": broken,
        "valid": valid,
        "improves_best": improves,
        "best_before": best,
    }
    append_log(d, entry)
    verdict = "invalid_floor" if broken else ("candidate" if improves else "discard")
    emit({**entry, "verdict": verdict})


def cmd_close_round(args) -> None:
    d, run = load_run(args)
    m = run["matrix"]
    if run.get("stop"):
        fail(2, f"run already stopped: {run['stop']}")
    cands = [e for e in read_log(d) if e.get("event") == "score" and e.get("round") == args.round]
    if not cands:
        fail(2, f"no scored candidates for round {args.round}; run `hc.py score` first")
    max_workers = m.get("max_workers", DEFAULT_MAX_WORKERS)
    if len(cands) > max_workers:
        print(f"hc: round {args.round} has {len(cands)} candidates, max_workers is {max_workers}", file=sys.stderr)
    valid = [e for e in cands if e["valid"]]
    winner = max(valid, key=lambda e: e["aggregate"]) if valid else None
    gained = bool(winner) and winner["aggregate"] > run["best"]["aggregate"] + MIN_GAIN
    if gained:
        run["best"] = {k: winner[k] for k in ("round", "worker", "cwd", "aggregate", "scores")}
        run["plateau"] = 0
    else:
        run["plateau"] += 1
    _, per = aggregate(m, run["baseline"], run["best"]["scores"])
    budget = m.get("budget_rounds", DEFAULT_BUDGET)
    plateau_limit = m.get("plateau_rounds", DEFAULT_PLATEAU)
    stop = None
    if all_met(per):
        stop = "targets_met"
    elif run["plateau"] >= plateau_limit:
        stop = "plateau"
    elif args.round >= budget:
        stop = "budget"
    run["stop"] = stop
    summary = {
        "round": args.round,
        "candidates": len(cands),
        "valid": len(valid),
        "winner": winner["worker"] if winner else None,
        "gained": gained,
        "best": run["best"],
        "plateau": run["plateau"],
        "plateau_limit": plateau_limit,
        "rounds_left": max(0, budget - args.round),
        "stop": stop,
        "next": "stop and report" if stop else "dispatch the next round from best.cwd",
    }
    run["rounds"].append({k: summary[k] for k in ("round", "candidates", "valid", "winner", "gained", "plateau", "stop")})
    save_run(d, run)
    append_log(d, {"event": "close_round", **{k: summary[k] for k in ("round", "winner", "gained", "plateau", "stop")}})
    emit(summary)


def baseline_aggregate(m: dict, run: dict) -> float:
    return aggregate(m, run["baseline"], run["baseline"])[0]


def cmd_status(args) -> None:
    d, run = load_run(args)
    m = run["matrix"]
    if not args.markdown:
        emit({k: run[k] for k in ("baseline", "best", "rounds", "plateau", "stop", "verifier_sha256")})
        return
    names = [c["name"] for c in m["criteria"]]
    sign = {c["name"]: ("≥" if c["direction"] == "higher" else "≤") for c in m["criteria"]}
    lines = [
        f"Run `{d}` · stop: **{run['stop'] or 'running'}** · best: round {run['best']['round']}, {run['best']['worker']}",
        "",
        "| round | worker | " + " | ".join(names) + " | aggregate | verdict |",
        "|---|---|" + "---|" * len(names) + "---|---|",
        "| 0 | baseline | " + " | ".join(f"{run['baseline'][n]:g}" for n in names) + f" | {baseline_aggregate(m, run):.4f} | baseline |",
    ]
    for e in read_log(d):
        if e.get("event") != "score":
            continue
        verdict = "floor broken" if e["floors_broken"] else ("gain" if e["improves_best"] else "no gain")
        lines.append(f"| {e['round']} | {e['worker']} | " + " | ".join(f"{e['scores'][n]:g}" for n in names) + f" | {e['aggregate']:.4f} | {verdict} |")
    lines.append("")
    lines.append("Targets: " + ", ".join(f"{c['name']} {sign[c['name']]} {c['target']:g} {c['unit']} (w={c.get('weight', 1)})" for c in m["criteria"]))
    print("\n".join(lines))


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="hc.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def add_run(p):
        p.add_argument("--run", required=True, help="run folder, e.g. $TMPDIR/pi-reports/hill-climb/<run>")

    p = sub.add_parser("init", help="validate matrix, checksum verifier, measure baseline")
    add_run(p)
    p.add_argument("--matrix", required=True, help="matrix.json (see `hc.py example`)")
    p.add_argument("--cwd", required=True, help="artifact directory to measure the baseline in")
    p.add_argument("--timeout", type=int, default=VERIFIER_TIMEOUT, help="verifier timeout in seconds per run")
    p.add_argument("--dry-run", action="store_true", help="validate and print the verifier command without running it")
    p.add_argument("--force", action="store_true", help="overwrite an existing run (discards history)")
    p.set_defaults(fn=cmd_init)

    p = sub.add_parser("score", help="run the verifier for one candidate and judge it against best")
    add_run(p)
    p.add_argument("--round", type=int, required=True)
    p.add_argument("--worker", required=True, help="candidate label, e.g. w1")
    p.add_argument("--cwd", required=True, help="candidate worktree or directory")
    p.add_argument("--direction", default="", help="one line: what this candidate tried (for the log)")
    p.add_argument("--timeout", type=int, default=VERIFIER_TIMEOUT)
    p.set_defaults(fn=cmd_score)

    p = sub.add_parser("close-round", help="pick the round winner, update best, decide stop/continue")
    add_run(p)
    p.add_argument("--round", type=int, required=True)
    p.set_defaults(fn=cmd_close_round)

    p = sub.add_parser("status", help="print the run summary")
    add_run(p)
    p.add_argument("--markdown", action="store_true", help="markdown table for the final report")
    p.set_defaults(fn=cmd_status)

    p = sub.add_parser("example", help="print an example matrix.json")
    p.set_defaults(fn=lambda a: emit(EXAMPLE_MATRIX))

    args = ap.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
