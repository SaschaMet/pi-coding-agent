import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SKILL = path.join(import.meta.dirname, "..", ".pi", "skill-library", "stick-animation");
const SCRIPT = path.join(SKILL, "scripts", "stickanim.py");
const PYTHON = process.env.PYTHON ?? "python3";
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "stickanim-test-"));

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

interface RunResult {
	status: number;
	stdout: string;
	stderr: string;
}

function run(args: string[], env: Record<string, string> = {}): RunResult {
	const res = spawnSync(PYTHON, [SCRIPT, ...args], {
		encoding: "utf-8",
		env: { ...process.env, ...env },
		timeout: 120_000,
	});
	if (res.error) throw new Error(`failed to start ${PYTHON}: ${res.error.message}`);
	return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

let sceneCounter = 0;
function scene(body: unknown): string {
	const file = path.join(TMP, `scene-${++sceneCounter}.json`);
	fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
	return file;
}

function outDir(): string {
	return fs.mkdtempSync(path.join(TMP, "out-"));
}

function videoFrames(file: string): number {
	const res = spawnSync(
		"ffprobe",
		["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file],
		{ encoding: "utf-8" },
	);
	return Number(res.stdout.trim());
}

const standing = (extra: Record<string, unknown> = {}) => ({
	fps: 30,
	timeline: [
		{ dur: 0, pose: { type: "stand", x: 320 } },
		{ dur: 1, pose: { type: "stand", x: 320, hands: [10, -20] }, label: "UP" },
	],
	...extra,
});

describe("stickanim CLI basics", () => {
	it("prints usage on --help and exits 0", () => {
		const res = run(["--help"]);
		expect(res.status).toBe(0);
		expect(res.stdout).toMatch(/stickanim\.py render/);
	});

	it("reports the toolchain on check", () => {
		const res = run(["check"]);
		expect(res.status).toBe(0);
		expect(JSON.parse(res.stdout)).toMatchObject({ ok: true });
	});

	it("exits 3 with an install hint when ffmpeg is missing", () => {
		const res = run(["check"], { STICKANIM_FFMPEG: path.join(TMP, "no-such-ffmpeg") });
		expect(res.status).toBe(3);
		expect(res.stderr).toMatch(/ffmpeg/);
		expect(res.stderr).toMatch(/brew install ffmpeg/);
	});

	it("refuses to render when ffmpeg is missing and writes nothing", () => {
		const out = outDir();
		const res = run(["render", scene(standing()), "--out", out], { STICKANIM_FFMPEG: path.join(TMP, "nope") });
		expect(res.status).toBe(3);
		expect(fs.readdirSync(out)).toEqual([]);
	});

	it("exits 3 when Pillow is missing", () => {
		const fake = fs.mkdtempSync(path.join(TMP, "nopil-"));
		fs.mkdirSync(path.join(fake, "PIL"));
		fs.writeFileSync(path.join(fake, "PIL", "__init__.py"), "raise ImportError('simulated')\n");
		const res = run(["check"], { PYTHONPATH: fake });
		expect(res.status).toBe(3);
		expect(res.stderr).toMatch(/Pillow/);
	});

	it("exits 3 when Pillow is older than 10.1", () => {
		const fake = fs.mkdtempSync(path.join(TMP, "oldpil-"));
		fs.mkdirSync(path.join(fake, "PIL"));
		fs.writeFileSync(path.join(fake, "PIL", "__init__.py"), "__version__ = '9.5.0'\n");
		for (const m of ["Image", "ImageDraw", "ImageFont", "ImageChops"]) fs.writeFileSync(path.join(fake, "PIL", `${m}.py`), "");
		const res = run(["check"], { PYTHONPATH: fake });
		expect(res.status).toBe(3);
		expect(res.stderr).toMatch(/9\.5\.0/);
		expect(res.stderr).toMatch(/10\.1/);
	});

	it("leaves --out untouched when ffmpeg fails part-way", () => {
		const fake = path.join(TMP, "failing-ffmpeg");
		fs.writeFileSync(fake, '#!/bin/sh\nfor last; do :; done\necho partial > "$last"\nexit 1\n', { mode: 0o755 });
		const out = outDir();
		const res = run(["render", scene(standing()), "--out", out], { STICKANIM_FFMPEG: fake });
		expect(res.status).toBe(4);
		expect(fs.readdirSync(out)).toEqual([]);
	});

	it("rejects a --name that would leave --out", () => {
		const out = outDir();
		for (const name of ["../escaped", "/tmp/abs", "a/b", ".."]) {
			const res = run(["render", scene(standing()), "--out", out, "--name", name]);
			expect(res.status, name).toBe(2);
			expect(res.stderr).toMatch(/--name/);
		}
		expect(fs.existsSync(path.join(path.dirname(out), "escaped.mp4"))).toBe(false);
	});

	it("exits 2 on an unknown command", () => {
		const res = run(["dance"]);
		expect(res.status).toBe(2);
		expect(res.stderr).toMatch(/check, validate, render, inspect, joints/);
	});
});

describe("scene validation", () => {
	it("names the JSON path and the received value for a bad duration", () => {
		const res = run(["validate", scene({ timeline: [{ dur: 0, pose: { type: "stand" } }, { dur: -1, pose: { type: "stand" } }] })]);
		expect(res.status).toBe(2);
		expect(res.stderr).toMatch(/timeline\[1\]\.dur/);
		expect(res.stderr).toMatch(/-1/);
	});

	it("lists the accepted pose types for an unknown one", () => {
		const res = run(["validate", scene({ timeline: [{ dur: 0, pose: { type: "moonwalk" } }] })]);
		expect(res.status).toBe(2);
		expect(res.stderr).toMatch(/timeline\[0\]\.pose\.type/);
		expect(res.stderr).toMatch(/stand/);
		expect(res.stderr).toMatch(/moonwalk/);
	});

	it("rejects malformed JSON with exit 2", () => {
		const res = run(["validate", scene("{ not json")]);
		expect(res.status).toBe(2);
		expect(res.stderr).toMatch(/JSON/);
	});

	it("accepts a valid scene and reports its length", () => {
		const res = run(["validate", scene(standing())]);
		expect(res.status).toBe(0);
		expect(JSON.parse(res.stdout)).toMatchObject({ ok: true, keys: 2, seconds: 1 });
	});
});

describe("render", () => {
	it("writes an mp4 with fps x seconds + 1 frames and a gif", () => {
		const out = outDir();
		const res = run(["render", scene(standing()), "--out", out, "--name", "clip"]);
		expect(res.status, res.stderr).toBe(0);
		const report = JSON.parse(res.stdout);
		expect(report).toMatchObject({ ok: true, frames: 31, fps: 30, seconds: 1 });
		expect(videoFrames(path.join(out, "clip.mp4"))).toBe(31);
		expect(fs.statSync(path.join(out, "clip.gif")).size).toBeGreaterThan(0);
		expect(report.files).toHaveLength(2);
	});

	it("renders only the requested format", () => {
		const out = outDir();
		const res = run(["render", scene(standing()), "--out", out, "--formats", "gif", "--name", "only"]);
		expect(res.status, res.stderr).toBe(0);
		expect(fs.readdirSync(out)).toEqual(["only.gif"]);
	});

	it("rejects an unknown format with the accepted list", () => {
		const res = run(["render", scene(standing()), "--out", outDir(), "--formats", "avi"]);
		expect(res.status).toBe(2);
		expect(res.stderr).toMatch(/accepted: mp4, gif/);
	});
});

type Point = [number, number];
interface JointsReport {
	label: string;
	facing: "right" | "left";
	joints: Record<string, Point>;
	contacts: Record<"near_hand" | "far_hand" | "near_foot" | "far_foot", Point>;
	props: Record<string, Point>;
}

function jointsAt(file: string, at: string): JointsReport {
	const res = run(["joints", file, "--at", at]);
	if (res.status !== 0) throw new Error(`joints failed (${res.status}): ${res.stderr}`);
	return JSON.parse(res.stdout) as JointsReport;
}

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const pushUps = {
	fps: 30,
	timeline: [
		{ dur: 0, pose: { type: "plank", h: 60, toe_x: 150 }, label: "PUSH-UPS" },
		{
			repeat: 2,
			keys: [
				{ dur: 0.6, pose: { type: "plank", h: 17 }, pin: ["hands", "feet"], label: "PUSH-UPS {i}/{n}" },
				{ dur: 0.6, pose: { type: "plank", h: 60 }, pin: ["hands", "feet"], label: "PUSH-UPS {i}/{n}" },
			],
		},
		{ dur: 0.5, pose: { type: "pike" }, pin: ["hands", "feet"], label: "GET UP" },
		{ dur: 0.5, pose: { type: "crouch" }, pin: ["hands"] },
		{ dur: 0.6, pose: { type: "stand" } },
	],
};

describe("pose builders and pins", () => {
	it("keeps pinned hands and feet on their spot during every in-between frame", () => {
		const file = scene(pushUps);
		const start = jointsAt(file, "key:0").contacts;
		for (const t of [0.1, 0.3, 0.5, 0.9, 1.5, 2.3, 2.6]) {
			const now = jointsAt(file, String(t)).contacts;
			for (const c of ["near_hand", "far_hand", "near_foot", "far_foot"] as const) {
				expect(dist(now[c], start[c]), `${c} at ${t}s`).toBeLessThanOrEqual(0.5);
			}
		}
	});

	it("puts the plank's hands and toes on the floor and lowers the shoulders", () => {
		const file = scene(pushUps);
		const top = jointsAt(file, "key:0");
		const bottom = jointsAt(file, "key:1");
		expect(top.contacts.near_hand[1]).toBeCloseTo(312, 1);
		expect(312 - top.joints.sh[1]).toBeCloseTo(60, 0);
		expect(312 - bottom.joints.sh[1]).toBeCloseTo(17, 0);
	});

	it("expands repeat blocks and numbers their labels", () => {
		const file = scene(pushUps);
		expect(JSON.parse(run(["validate", file]).stdout)).toMatchObject({ keys: 8 });
		expect(jointsAt(file, "key:3").label).toBe("PUSH-UPS 2/2");
	});

	it("keeps pinned feet on the floor when the same key also lifts the body", () => {
		const file = scene({
			timeline: [
				{ dur: 0, pose: { type: "stand", x: 300 } },
				{ dur: 0.5, pose: { type: "stand", x: 300, lift: 20 }, pin: ["feet"] },
			],
		});
		const start = jointsAt(file, "key:0").contacts;
		const end = jointsAt(file, "key:1").contacts;
		expect(start.near_foot[1]).toBeCloseTo(312, 1);
		expect(dist(end.near_foot, start.near_foot)).toBeLessThanOrEqual(0.5);
		expect(dist(end.far_foot, start.far_foot)).toBeLessThanOrEqual(0.5);
	});

	it("rejects a pike as the first key because it builds on earlier contacts", () => {
		const res = run(["validate", scene({ timeline: [{ dur: 0, pose: { type: "pike" } }] })]);
		expect(res.status).toBe(2);
		expect(res.stderr).toMatch(/timeline\[0\]\.pose/);
	});
});

describe("props", () => {
	const lift = {
		props: [{ id: "plate", kind: "plate", r: 15, at: [430, 297] }],
		timeline: [
			{ dur: 0, pose: { type: "stand", x: 400 } },
			{ dur: 0.7, pose: { type: "squat", x: 400, hands: "prop:plate" } },
			{ dur: 0.2, pose: { type: "squat", x: 400, hands: "prop:plate" }, grab: "plate" },
			{ dur: 0.8, pose: { type: "stand", x: 400, hands: [8, 58] } },
			{ dur: 0.6, pose: { type: "stand", x: 400, hands: [8, 58] }, drop: "plate" },
		],
	};

	it("rests at its spot until grabbed, then follows the near hand, then rests where dropped", () => {
		const file = scene(lift);
		const before = jointsAt(file, "0.5");
		expect(before.props.plate).toEqual([430, 297]);
		const squat = jointsAt(file, "key:1");
		expect(dist(squat.contacts.near_hand, [430, 297])).toBeLessThanOrEqual(1);
		for (const at of ["key:2", "1.3", "key:3"]) {
			const r = jointsAt(file, at);
			expect(dist(r.props.plate, r.contacts.near_hand), at).toBeLessThanOrEqual(0.01);
		}
		const dropped = jointsAt(file, "key:4");
		expect(dropped.props.plate[1]).toBeCloseTo(297, 1);
	});

	it("rejects a grab that is not a prop id string with exit 2", () => {
		const bad = { ...lift, timeline: [lift.timeline[0], { ...lift.timeline[2], grab: ["plate"] }] };
		const res = run(["validate", scene(bad)]);
		expect(res.status).toBe(2);
		expect(res.stderr).toMatch(/timeline\[1\]\.grab/);
	});

	it("rejects grabbing an unknown prop with the known ids", () => {
		const bad = { ...lift, timeline: [lift.timeline[0], { ...lift.timeline[2], grab: "kettlebell" }] };
		const res = run(["validate", scene(bad)]);
		expect(res.status).toBe(2);
		expect(res.stderr).toMatch(/timeline\[1\]\.grab/);
		expect(res.stderr).toMatch(/plate/);
	});
});

function jointsMany(file: string, times: number[]): JointsReport[] {
	const res = run(["joints", file, "--at", times.map((t) => t.toFixed(4)).join(",")]);
	if (res.status !== 0) throw new Error(`joints failed (${res.status}): ${res.stderr}`);
	return (JSON.parse(res.stdout) as { samples: JointsReport[] }).samples;
}

describe("walk, jumps and facing", () => {
	const walk = {
		fps: 30,
		timeline: [
			{ dur: 0, pose: { type: "stand", x: 150 } },
			{ walk: { to_x: 400 }, label: "WALK" },
			{ dur: 0.4, pose: { type: "stand" } },
		],
	};

	it("never slides a foot that is on the floor, lifts the swing foot, and ends at to_x", () => {
		const file = scene(walk);
		const seconds = JSON.parse(run(["validate", file]).stdout).seconds as number;
		const times = Array.from({ length: Math.floor(seconds * 30) + 1 }, (_, i) => i / 30);
		const samples = jointsMany(file, times);
		let lifted = 0;
		const stanceStart: Record<string, number | null> = { near_foot: null, far_foot: null };
		for (let i = 0; i < samples.length; i++) {
			for (const foot of ["near_foot", "far_foot"] as const) {
				const [x, y] = samples[i].contacts[foot];
				expect(y, `${foot} below the floor at frame ${i}`).toBeLessThanOrEqual(312.5);
				if (y >= 311.5) {
					const start = stanceStart[foot] ?? x;
					stanceStart[foot] = start;
					expect(Math.abs(x - start), `${foot} drifts on the floor by frame ${i}`).toBeLessThan(1);
				} else {
					stanceStart[foot] = null;
				}
				if (y < 312 - 5) lifted++;
			}
		}
		expect(lifted).toBeGreaterThan(5);
		const end = samples[samples.length - 1].joints.hip[0];
		expect(Math.abs(end - 400)).toBeLessThanOrEqual(1);
	});

	it("faces the walking direction, including walking left", () => {
		const back = { ...walk, timeline: [{ dur: 0, pose: { type: "stand", x: 400 } }, { walk: { to_x: 200 } }] };
		const file = scene(back);
		const seconds = JSON.parse(run(["validate", file]).stdout).seconds as number;
		const mid = jointsAt(file, String(seconds / 2));
		expect(mid.facing).toBe("left");
		expect(mid.joints.hip[0]).toBeLessThan(400);
		expect(mid.joints.head[0]).toBeLessThan(mid.joints.hip[0] + 5);
		expect(Math.abs(jointsAt(file, `key:${JSON.parse(run(["validate", file]).stdout).keys - 1}`).joints.hip[0] - 200)).toBeLessThanOrEqual(1);
	});

	it("lets a ground: false key leave the floor, and clamps the same pose without it", () => {
		const jump = (ground: boolean) => ({
			timeline: [
				{ dur: 0, pose: { type: "stand", x: 300 } },
				{ dur: 0.3, pose: { type: "stand", x: 300, lift: 40 }, ground },
				{ dur: 0.3, pose: { type: "stand", x: 300 } },
			],
		});
		const lowestY = (r: JointsReport) => Math.max(...Object.entries(r.joints).filter(([k]) => k !== "head").map(([, p]) => p[1]));
		expect(lowestY(jointsAt(scene(jump(false)), "key:1"))).toBeLessThanOrEqual(312 - 5);
		expect(lowestY(jointsAt(scene(jump(false)), "0.15"))).toBeLessThan(312);
		expect(lowestY(jointsAt(scene(jump(true)), "key:1"))).toBeCloseTo(312, 0);
	});

	it("mirrors relative hands and steps when facing left", () => {
		const pose = (facing: string) => ({
			timeline: [{ dur: 0, pose: { type: "stand", x: 300, hands: [20, 30], step: 15 }, facing }],
		});
		const right = jointsAt(scene(pose("right")), "key:0");
		const left = jointsAt(scene(pose("left")), "key:0");
		expect(right.contacts.near_hand[0]).toBeGreaterThan(right.joints.sh[0]);
		expect(left.contacts.near_hand[0]).toBeLessThan(left.joints.sh[0]);
		expect(left.contacts.near_foot[0]).toBeCloseTo(285, 0);
		expect(left.contacts.near_hand[0] + right.contacts.near_hand[0]).toBeCloseTo(600, 0);
	});

	it("keeps absolute prop targets in place when facing left", () => {
		const file = scene({
			facing: "left",
			props: [{ id: "plate", r: 15, at: [270, 297] }],
			timeline: [{ dur: 0, pose: { type: "squat", x: 300, hands: "prop:plate" } }],
		});
		expect(dist(jointsAt(file, "key:0").contacts.near_hand, [270, 297])).toBeLessThanOrEqual(1);
	});
});

function pngWidth(file: string): number {
	return fs.readFileSync(file).readUInt32BE(16);
}

describe("inspect", () => {
	it("writes a numbered key grid and onion images that cover every move", () => {
		const out = outDir();
		const res = run(["inspect", scene(pushUps), "--out", out]);
		expect(res.status, res.stderr).toBe(0);
		const report = JSON.parse(res.stdout) as { ok: boolean; keys: string[]; onion: string[] };
		expect(report.keys).toEqual([path.join(out, "keys.png")]);
		expect(report.onion.map((f) => path.basename(f))).toEqual(["onion-0-6.png", "onion-6-7.png"]);
		for (const file of [...report.keys, ...report.onion]) {
			expect(fs.existsSync(file), file).toBe(true);
			expect(pngWidth(file)).toBeLessThanOrEqual(1920);
		}
		expect(fs.readdirSync(out).some((f) => f.endsWith(".mp4") || f.endsWith(".gif"))).toBe(false);
	});

	it("always names the first key page keys.png and pages long scenes", () => {
		const out = outDir();
		const keys = Array.from({ length: 40 }, (_, i) => ({ dur: i ? 0.1 : 0, pose: { type: "stand", x: 300, crouch: i % 2 ? 10 : 0 } }));
		const report = JSON.parse(run(["inspect", scene({ timeline: keys }), "--out", out]).stdout) as { keys: string[] };
		expect(report.keys.map((f) => path.basename(f))).toEqual(["keys.png", "keys-2.png"]);
	}, 60_000);

	it("skips zero-length moves in the onion images", () => {
		const out = outDir();
		const file = scene({ timeline: [{ dur: 0, pose: { type: "stand" } }, { dur: 0, pose: { type: "stand", crouch: 10 } }, { dur: 0.5, pose: { type: "stand" } }] });
		const report = JSON.parse(run(["inspect", file, "--out", out]).stdout) as { onion: string[] };
		expect(report.onion.map((f) => path.basename(f))).toEqual(["onion-1-2.png"]);
	});
});

describe("bundled example", () => {
	it("renders the workout scene", () => {
		const res = run(["render", path.join(SKILL, "examples", "workout.json"), "--out", outDir(), "--formats", "gif"]);
		expect(res.status, res.stderr).toBe(0);
		expect(JSON.parse(res.stdout).seconds).toBeGreaterThan(10);
	}, 60_000);
});
