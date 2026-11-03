#!/usr/bin/env python3
"""handsoff.py - run registry for a handsoff run.

One run.json, outside every worktree, is the single source of truth the
orchestrator and every later reader use: task, clock budget, every package
with its lead pane, worktree, branch, state, stage, stop reason and respawn
count, plus the open issues (refused actions, accepted review findings).
Scores live in each package's hill-climb run (hc.py); this file only points
at them.

Commands (all print one JSON object on stdout; diagnostics go to stderr):

  init     create the run folder and run.json (refuses to overwrite without --force)
  package  add or update one package (upsert; unspecified fields keep their value)
  issue    append an open issue to the run
  status   clock, packages, stop decision, merge order (--markdown for the report)
  ts       print the cmux time signal for dispatch messages

Exit codes: 0 ok, 2 invalid input. Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

RUN_FILE = "run.json"
# One respawn per package: a lead that dies twice on the same package is a
# package problem, not a pane problem; the package is marked failed instead.
MAX_RESPAWNS = 1
STATES = ("planned", "running", "done", "failed", "unmerged", "merged")
# Lead stages in workflow order; free text is rejected so reports stay comparable.
STAGES = ("boot", "grill", "plan", "climb", "review", "preflight", "signal")
# Stop reasons a package may carry when it settles.
STOPS = ("targets_met", "plateau", "budget", "lead_lost", "refused", "merge_conflict")
SETTLED = ("done", "failed", "unmerged", "merged")
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def fail(code: int, msg: str) -> None:
    print(f"handsoff: {msg}", file=sys.stderr)
    sys.exit(code)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_run(run_dir: Path) -> dict:
    path = run_dir / RUN_FILE
    if not path.exists():
        fail(2, f"no {RUN_FILE} in {run_dir}; run `init` first")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as e:
        fail(2, f"{path} is not valid JSON: {e}")
    return {}


def save_run(run_dir: Path, run: dict) -> None:
    run["updated"] = now_iso()
    (run_dir / RUN_FILE).write_text(json.dumps(run, indent=2) + "\n")


def emit(obj: dict) -> None:
    print(json.dumps(obj))


def cmd_init(a: argparse.Namespace) -> None:
    if not SLUG.match(a.task):
        fail(2, f"--task must be a slug matching {SLUG.pattern}, got {a.task!r}")
    if a.budget_seconds <= 0:
        fail(2, f"--budget-seconds must be positive, got {a.budget_seconds}")
    run_dir = Path(a.run)
    if (run_dir / RUN_FILE).exists() and not a.force:
        fail(2, f"{run_dir / RUN_FILE} exists; pass --force to start over")
    run_dir.mkdir(parents=True, exist_ok=True)
    run = {
        "task": a.task,
        "created": now_iso(),
        "t0": a.t0 if a.t0 is not None else int(time.time()),
        "budget_seconds": a.budget_seconds,
        "artifact": a.artifact,
        "baseline_sha": a.baseline_sha,
        "handback_branch": f"handsoff/{a.task}",
        "packages": {},
        "issues": [],
    }
    save_run(run_dir, run)
    emit(run)


def cmd_package(a: argparse.Namespace) -> None:
    if not SLUG.match(a.name):
        fail(2, f"--name must be a slug matching {SLUG.pattern}, got {a.name!r}")
    run_dir = Path(a.run)
    run = load_run(run_dir)
    pkg = run["packages"].setdefault(
        a.name,
        {"state": "planned", "stage": None, "stop": None, "respawns": 0, "created": now_iso()},
    )
    for field in ("workspace", "surface", "worktree", "branch", "hc_run", "aggregate", "note"):
        value = getattr(a, field)
        if value is not None:
            pkg[field] = value
    if a.stage is not None:
        if a.stage not in STAGES:
            fail(2, f"--stage must be one of {', '.join(STAGES)}; got {a.stage!r}")
        pkg["stage"] = a.stage
    if a.stop is not None:
        if a.stop not in STOPS:
            fail(2, f"--stop must be one of {', '.join(STOPS)}; got {a.stop!r}")
        pkg["stop"] = a.stop
    if a.state is not None:
        if a.state not in STATES:
            fail(2, f"--state must be one of {', '.join(STATES)}; got {a.state!r}")
        if a.state in SETTLED and pkg.get("stop") is None and a.state != "merged":
            fail(2, f"state {a.state} needs a --stop reason ({', '.join(STOPS)})")
        pkg["state"] = a.state
    if a.respawn:
        if pkg["respawns"] >= MAX_RESPAWNS:
            fail(2, f"package {a.name} already respawned {MAX_RESPAWNS}x; mark it failed (--state failed --stop lead_lost)")
        pkg["respawns"] += 1
    save_run(run_dir, run)
    emit(run)


def cmd_issue(a: argparse.Namespace) -> None:
    run_dir = Path(a.run)
    run = load_run(run_dir)
    if a.package not in run["packages"]:
        fail(2, f"unknown package {a.package!r}; known: {', '.join(run['packages']) or 'none'}")
    if not a.text.strip():
        fail(2, "--text must not be empty")
    run["issues"].append({"package": a.package, "text": a.text.strip(), "at": now_iso()})
    save_run(run_dir, run)
    emit(run)


def clock(run: dict) -> dict:
    elapsed = max(0, int(time.time()) - int(run["t0"]))
    remaining = max(0, int(run["budget_seconds"]) - elapsed)
    return {"elapsed_seconds": elapsed, "remaining_seconds": remaining, "over_budget": remaining == 0}


def status(run: dict) -> dict:
    c = clock(run)
    pkgs = run["packages"]
    all_settled = bool(pkgs) and all(p["state"] in SETTLED for p in pkgs.values())
    stop = "all_settled" if all_settled else ("budget" if c["over_budget"] else None)
    merge_order = [n for n, p in pkgs.items() if p["state"] == "done"]
    return {
        "task": run["task"],
        "handback_branch": run["handback_branch"],
        "baseline_sha": run.get("baseline_sha"),
        **c,
        "all_settled": all_settled,
        "stop": stop,
        "merge_order": merge_order,
        "packages": pkgs,
        "issues": run["issues"],
    }


def markdown(s: dict) -> str:
    lines = [
        f"Run `{s['task']}`: {s['elapsed_seconds']}s elapsed, {s['remaining_seconds']}s left, stop={s['stop']}",
        "",
        "| package | state | stage | stop | respawns | branch | aggregate | note |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for name, p in s["packages"].items():
        lines.append(
            f"| {name} | {p['state']} | {p.get('stage') or ''} | {p.get('stop') or ''} | {p['respawns']} "
            f"| {p.get('branch') or ''} | {p.get('aggregate') if p.get('aggregate') is not None else ''} | {p.get('note') or ''} |"
        )
    lines += ["", "Open issues:"]
    lines += [f"- {i['package']}: {i['text']}" for i in s["issues"]] or ["- none"]
    return "\n".join(lines)


def cmd_status(a: argparse.Namespace) -> None:
    s = status(load_run(Path(a.run)))
    if a.markdown:
        print(markdown(s))
    else:
        emit(s)


def cmd_ts(a: argparse.Namespace) -> None:
    run = load_run(Path(a.run))
    c = clock(run)
    print(f"[time: {c['elapsed_seconds']}s elapsed of {run['budget_seconds']}s budget]")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init", help="create the run folder and run.json")
    p.add_argument("--run", required=True, help="run folder, outside every worktree")
    p.add_argument("--task", required=True, help="task slug; the handback branch is handsoff/<task>")
    p.add_argument("--budget-seconds", type=int, required=True, help="wall-clock budget for the whole run")
    p.add_argument("--artifact", help="path or one-line description of the artifact")
    p.add_argument("--baseline-sha", help="commit every package branches from")
    p.add_argument("--t0", type=int, help="override the start epoch (tests)")
    p.add_argument("--force", action="store_true", help="overwrite an existing run.json")
    p.set_defaults(fn=cmd_init)

    p = sub.add_parser("package", help="add or update one package")
    p.add_argument("--run", required=True)
    p.add_argument("--name", required=True, help="package slug")
    p.add_argument("--state", help=f"one of {', '.join(STATES)}")
    p.add_argument("--stage", help=f"one of {', '.join(STAGES)}")
    p.add_argument("--stop", help=f"one of {', '.join(STOPS)}")
    for field, h in (
        ("workspace", "cmux workspace ref of the lead"),
        ("surface", "cmux surface ref of the lead"),
        ("worktree", "lead worktree path"),
        ("branch", "package branch"),
        ("hc_run", "hill-climb run folder of the package"),
        ("note", "one-line note for the report"),
    ):
        p.add_argument(f"--{field}", help=h)
    p.add_argument("--aggregate", type=float, help="best aggregate score from hc.py status")
    p.add_argument("--respawn", action="store_true", help=f"count one lead respawn (max {MAX_RESPAWNS})")
    p.set_defaults(fn=cmd_package)

    p = sub.add_parser("issue", help="append an open issue")
    p.add_argument("--run", required=True)
    p.add_argument("--package", required=True)
    p.add_argument("--text", required=True)
    p.set_defaults(fn=cmd_issue)

    p = sub.add_parser("status", help="clock, packages, stop decision, merge order")
    p.add_argument("--run", required=True)
    p.add_argument("--markdown", action="store_true", help="table for the final report")
    p.set_defaults(fn=cmd_status)

    p = sub.add_parser("ts", help="print the cmux time signal")
    p.add_argument("--run", required=True)
    p.set_defaults(fn=cmd_ts)

    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
