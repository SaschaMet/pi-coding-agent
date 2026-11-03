#!/usr/bin/env python3
"""Tests for hc.py. Run: python3 -I scripts/test_hc.py"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HC = Path(__file__).with_name("hc.py")

# A verifier that reads its score from a file in the candidate cwd, so tests
# can simulate better and worse candidates without real work.
FAKE_VERIFIER = """\
import json, pathlib
print("noise line that must be ignored")
print(json.dumps(json.loads(pathlib.Path("scores.json").read_text())))
"""

MATRIX = {
    "verifier": "verify.py",
    "budget_rounds": 3,
    "plateau_rounds": 2,
    "max_workers": 2,
    "criteria": [
        {"name": "ms", "measure": "wall ms", "unit": "ms", "direction": "lower", "target": 50, "weight": 2},
        {"name": "passing", "measure": "tests", "unit": "count", "direction": "higher", "target": 10, "weight": 1, "floor": 10},
    ],
}


def hc(*args, check=True):
    p = subprocess.run([sys.executable, "-I", str(HC), *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise AssertionError(f"hc {' '.join(args)} exited {p.returncode}\n{p.stderr}")
    return p


class HcTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.run = self.tmp / "run"
        self.run.mkdir()
        (self.run / "verify.py").write_text(FAKE_VERIFIER)
        (self.tmp / "matrix.json").write_text(json.dumps(MATRIX))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def candidate(self, name, ms, passing):
        d = self.tmp / name
        d.mkdir(exist_ok=True)
        (d / "scores.json").write_text(json.dumps({"ms": ms, "passing": passing}))
        return str(d)

    def init(self, ms=100, passing=10):
        base = self.candidate("base", ms, passing)
        return json.loads(hc("init", "--run", str(self.run), "--matrix", str(self.tmp / "matrix.json"), "--cwd", base).stdout)

    def test_help_has_no_side_effects(self):
        hc("--help")
        self.assertFalse((self.run / "run.json").exists())

    def test_init_records_baseline_and_checksum(self):
        out = self.init()
        self.assertEqual(out["baseline"], {"ms": 100.0, "passing": 10.0})
        # `passing` already meets its target at baseline, so the baseline aggregate is 1/3, not 0.
        self.assertAlmostEqual(out["baseline_aggregate"], 1 / 3, places=5)
        self.assertEqual(len(out["verifier_sha256"]), 64)
        self.assertIsNone(out["stop"])

    def test_init_rejects_subjective_matrix(self):
        bad = dict(MATRIX, criteria=[{"name": "looks_nice", "direction": "higher", "target": 1}])
        (self.tmp / "matrix.json").write_text(json.dumps(bad))
        p = hc("init", "--run", str(self.run), "--matrix", str(self.tmp / "matrix.json"), "--cwd", str(self.tmp), check=False)
        self.assertEqual(p.returncode, 2)
        self.assertIn("missing measure", p.stderr)
        self.assertIn("missing unit", p.stderr)

    def test_score_better_candidate_is_candidate(self):
        self.init()
        out = json.loads(hc("score", "--run", str(self.run), "--round", "1", "--worker", "w1", "--cwd", self.candidate("w1", 75, 10)).stdout)
        self.assertEqual(out["verdict"], "candidate")
        self.assertAlmostEqual(out["aggregate"], (2 * 0.5 + 1 * 1.0) / 3, places=5)

    def test_floor_breaks_invalidate_even_with_better_sum(self):
        self.init()
        out = json.loads(hc("score", "--run", str(self.run), "--round", "1", "--worker", "w1", "--cwd", self.candidate("w1", 50, 9)).stdout)
        self.assertEqual(out["verdict"], "invalid_floor")
        self.assertEqual(out["floors_broken"], ["passing"])

    def test_tampered_verifier_is_refused(self):
        self.init()
        (self.run / "verify.py").write_text(FAKE_VERIFIER + "\n# tampered\n")
        p = hc("score", "--run", str(self.run), "--round", "1", "--worker", "w1", "--cwd", self.candidate("w1", 1, 10), check=False)
        self.assertEqual(p.returncode, 4)
        self.assertIn("checksum changed", p.stderr)

    def test_round_loop_targets_met(self):
        self.init()
        hc("score", "--run", str(self.run), "--round", "1", "--worker", "w1", "--cwd", self.candidate("w1", 80, 10))
        hc("score", "--run", str(self.run), "--round", "1", "--worker", "w2", "--cwd", self.candidate("w2", 40, 10))
        out = json.loads(hc("close-round", "--run", str(self.run), "--round", "1").stdout)
        self.assertEqual(out["winner"], "w2")
        self.assertTrue(out["gained"])
        self.assertEqual(out["stop"], "targets_met")
        p = hc("close-round", "--run", str(self.run), "--round", "2", check=False)
        self.assertEqual(p.returncode, 2)

    def test_unchanged_candidate_is_not_a_gain(self):
        self.init()
        out = json.loads(hc("score", "--run", str(self.run), "--round", "1", "--worker", "w1", "--cwd", self.candidate("w1", 100, 10)).stdout)
        self.assertEqual(out["verdict"], "discard")

    def test_plateau_stops_after_n_rounds_without_gain(self):
        self.init()
        for r in (1, 2):
            hc("score", "--run", str(self.run), "--round", str(r), "--worker", "w1", "--cwd", self.candidate(f"r{r}", 100, 10))
            out = json.loads(hc("close-round", "--run", str(self.run), "--round", str(r)).stdout)
        self.assertEqual(out["plateau"], 2)
        self.assertEqual(out["stop"], "plateau")
        self.assertEqual(out["best"]["worker"], "baseline")

    def test_budget_stops_when_rounds_exhausted(self):
        self.init()
        for r in (1, 2, 3):
            hc("score", "--run", str(self.run), "--round", str(r), "--worker", "w1", "--cwd", self.candidate(f"r{r}", 100 - 5 * r, 10))
            out = json.loads(hc("close-round", "--run", str(self.run), "--round", str(r)).stdout)
        self.assertEqual(out["stop"], "budget")
        self.assertEqual(out["best"]["round"], 3)

    def test_status_markdown_lists_every_attempt(self):
        self.init()
        hc("score", "--run", str(self.run), "--round", "1", "--worker", "w1", "--cwd", self.candidate("w1", 90, 10))
        hc("close-round", "--run", str(self.run), "--round", "1")
        md = hc("status", "--run", str(self.run), "--markdown").stdout
        self.assertIn("| 0 | baseline |", md)
        self.assertIn("| 1 | w1 |", md)
        self.assertIn("gain", md)

    def test_verifier_failure_is_exit_3(self):
        self.init()
        p = hc("score", "--run", str(self.run), "--round", "1", "--worker", "w1", "--cwd", str(self.tmp), check=False)
        self.assertEqual(p.returncode, 3)

    def test_repeat_uses_median(self):
        m = json.loads(json.dumps(MATRIX))
        m["criteria"][0]["repeat"] = 3
        (self.tmp / "matrix.json").write_text(json.dumps(m))
        counter = self.run / "verify.py"
        counter.write_text(
            "import json, pathlib\n"
            "p = pathlib.Path('n.txt'); n = int(p.read_text()) if p.exists() else 0; p.write_text(str(n + 1))\n"
            "print(json.dumps({'ms': [100, 10, 1000][n % 3], 'passing': 10}))\n"
        )
        out = self.init()
        self.assertEqual(out["baseline"]["ms"], 100.0)


if __name__ == "__main__":
    os.environ.pop("PYTHONPATH", None)
    unittest.main(verbosity=1)
