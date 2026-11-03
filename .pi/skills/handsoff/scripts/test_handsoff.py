#!/usr/bin/env python3
"""Tests for handsoff.py. Run: python3 -I .pi/skills/handsoff/scripts/test_handsoff.py"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HO = Path(__file__).with_name("handsoff.py")


def ho(*args, check=True):
    p = subprocess.run([sys.executable, "-I", str(HO), *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise AssertionError(f"handsoff {' '.join(args)} exited {p.returncode}\n{p.stderr}")
    return p


def out(p):
    return json.loads(p.stdout.strip().splitlines()[-1])


class HandsoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.run_dir = str(Path(self.tmp.name) / "run")

    def tearDown(self):
        self.tmp.cleanup()

    def init(self, *extra):
        return out(ho("init", "--run", self.run_dir, "--task", "demo", "--budget-seconds", "600", *extra))

    def test_help_has_no_side_effects(self):
        ho("--help")
        self.assertFalse(Path(self.run_dir).exists())

    def test_init_creates_run_and_refuses_twice(self):
        r = self.init("--baseline-sha", "abc123")
        self.assertEqual(r["task"], "demo")
        self.assertEqual(r["baseline_sha"], "abc123")
        self.assertTrue((Path(self.run_dir) / "run.json").exists())
        p = ho("init", "--run", self.run_dir, "--task", "demo", "--budget-seconds", "600", check=False)
        self.assertEqual(p.returncode, 2)
        self.assertIn("--force", p.stderr)
        ho("init", "--run", self.run_dir, "--task", "demo", "--budget-seconds", "600", "--force")

    def test_init_rejects_bad_task_slug(self):
        p = ho("init", "--run", self.run_dir, "--task", "Bad Slug", "--budget-seconds", "600", check=False)
        self.assertEqual(p.returncode, 2)
        self.assertIn("slug", p.stderr)

    def test_package_upsert_and_invalid_state(self):
        self.init()
        r = out(ho("package", "--run", self.run_dir, "--name", "api", "--worktree", "/wt/api", "--branch", "handsoff/demo/api"))
        self.assertEqual(r["packages"]["api"]["state"], "planned")
        self.assertEqual(r["packages"]["api"]["worktree"], "/wt/api")
        r = out(ho("package", "--run", self.run_dir, "--name", "api", "--state", "running", "--stage", "grill"))
        self.assertEqual(r["packages"]["api"]["state"], "running")
        self.assertEqual(r["packages"]["api"]["stage"], "grill")
        self.assertEqual(r["packages"]["api"]["branch"], "handsoff/demo/api")  # unchanged fields survive
        p = ho("package", "--run", self.run_dir, "--name", "api", "--state", "bogus", check=False)
        self.assertEqual(p.returncode, 2)
        self.assertIn("running", p.stderr)
        self.assertIn("bogus", p.stderr)

    def test_done_requires_stop_reason(self):
        self.init()
        p = ho("package", "--run", self.run_dir, "--name", "api", "--state", "done", check=False)
        self.assertEqual(p.returncode, 2)
        self.assertIn("--stop", p.stderr)
        r = out(ho("package", "--run", self.run_dir, "--name", "api", "--state", "done", "--stop", "targets_met"))
        self.assertEqual(r["packages"]["api"]["stop"], "targets_met")

    def test_respawn_limit(self):
        self.init()
        ho("package", "--run", self.run_dir, "--name", "api")
        r = out(ho("package", "--run", self.run_dir, "--name", "api", "--respawn"))
        self.assertEqual(r["packages"]["api"]["respawns"], 1)
        p = ho("package", "--run", self.run_dir, "--name", "api", "--respawn", check=False)
        self.assertEqual(p.returncode, 2)
        self.assertIn("failed", p.stderr)

    def test_issue_appends(self):
        self.init()
        ho("package", "--run", self.run_dir, "--name", "api")
        out(ho("issue", "--run", self.run_dir, "--package", "api", "--text", "refused: git push"))
        r = out(ho("issue", "--run", self.run_dir, "--package", "api", "--text", "review MEDIUM: naming"))
        self.assertEqual([i["text"] for i in r["issues"]], ["refused: git push", "review MEDIUM: naming"])
        p = ho("issue", "--run", self.run_dir, "--package", "nope", "--text", "x", check=False)
        self.assertEqual(p.returncode, 2)

    def test_status_stop_and_merge_order(self):
        self.init()
        ho("package", "--run", self.run_dir, "--name", "b", "--state", "running")
        ho("package", "--run", self.run_dir, "--name", "a", "--state", "running")
        s = out(ho("status", "--run", self.run_dir))
        self.assertIsNone(s["stop"])
        self.assertFalse(s["all_settled"])
        ho("package", "--run", self.run_dir, "--name", "b", "--state", "done", "--stop", "targets_met")
        ho("package", "--run", self.run_dir, "--name", "a", "--state", "failed", "--stop", "lead_lost")
        s = out(ho("status", "--run", self.run_dir))
        self.assertTrue(s["all_settled"])
        self.assertEqual(s["stop"], "all_settled")
        self.assertEqual(s["merge_order"], ["b"])
        self.assertIn("| b |", ho("status", "--run", self.run_dir, "--markdown").stdout)

    def test_status_budget(self):
        self.init("--t0", "1")  # started at epoch 1: the budget is long gone
        ho("package", "--run", self.run_dir, "--name", "a", "--state", "running")
        s = out(ho("status", "--run", self.run_dir))
        self.assertTrue(s["over_budget"])
        self.assertEqual(s["stop"], "budget")
        self.assertEqual(s["remaining_seconds"], 0)

    def test_ts_format(self):
        self.init()
        line = ho("ts", "--run", self.run_dir).stdout.strip()
        self.assertRegex(line, r"^\[time: \d+s elapsed of 600s budget\]$")


if __name__ == "__main__":
    unittest.main()
