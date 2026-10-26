---
name: stick-animation
description: Animates a 2D side-view stick figure from a JSON scene of key poses and renders it to MP4 and GIF with Python, Pillow and ffmpeg, no browser. Use when the user asks for a stick figure, stickman, or Pivot-style animation, clip, or GIF (exercise, walking, waving, jumping, lifting). Not for 3D, character art, several interacting figures, front-facing gestures, editing .piv/.styk files, or web/CSS animation.
---

# Stick Animation

Write the motion as **key poses** in a scene file; the bundled script solves the limbs, keeps planted hands and feet **pinned**, eases between keys, draws the approved style, and encodes the video. Judge your work from the **onion skins** before rendering, not after.

## Definition of Done

- `inspect` images looked at, every key pose and every move reads as the request intends.
- Video rendered; the reply gives the file paths, length in seconds, and the limits that apply.

## Workflow

`<skill-dir>` is this file's folder; `<out>` is `<project>/animations/<slug>/` unless the user names a place.

1. **Check the setup.** `python3 <skill-dir>/scripts/stickanim.py check`. Exit 3: give the user the install command it printed, run in a normal terminal, and stop. Do not install anything yourself.
2. **Scope it.** If the request needs more than one figure, a front view, 3D, or editing an existing file, say so and offer the closest one-figure side-view version before writing anything.
3. **Plan the beats.** List the moves, seconds each, and captions (one line each). Read `references/motion-recipes.md` and copy the recipe for every move it covers.
4. **Write `<out>/scene.json`.** Read `references/scene-format.md` the first time in a session. Rules:
   - Pin hands and feet on every key of a planted stretch (push-ups, a squat with hands on a prop).
   - Add a key wherever a hand or foot starts or stops touching something (getting up, gripping, landing).
   - Move across the floor only with `walk`.
5. **Validate.** `python3 <skill-dir>/scripts/stickanim.py validate <out>/scene.json`. Exit 2 names the field: fix that field and re-run.
6. **Inspect.** `python3 <skill-dir>/scripts/stickanim.py inspect <out>/scene.json --out <out>/inspect`. Open every image the stdout JSON lists: `keys.png` (plus `keys-2.png`… for scenes over 36 keys) and every `onion-*.png` (faint = start of the move, full ink = end). Check: each key matches its beat, rep counts are right, no limb flips the long way round, contacts stay put, nothing floats or sinks. For a number instead of a picture: `joints <scene> --at key:N` or `--at 1.2,1.4`.
7. **Fix and repeat** steps 5–6 until the images read right, at most 3 rounds. Still wrong after 3: render, and name the defect in the reply.
8. **Render.** `python3 <skill-dir>/scripts/stickanim.py render <out>/scene.json --out <out>` (MP4 + GIF by default; `--formats mp4` or `--formats gif` when the user names one format).
9. **Reply** with the stdout JSON's `files` and `seconds`, what the clip shows, and any limit that applies.

## Gotchas

| Symptom in the onion skin | Cause | Do this |
| --- | --- | --- |
| Hands or feet skate during push-ups | Key without `pin` | `"pin": ["hands", "feet"]` on every plank key |
| Body swings through the floor getting up | Plank straight to stand | `pike` → `crouch` → `stand` |
| Feet skate across the floor | `stand` keys with different `x` | Use a `walk` item |
| Figure stuck to the floor in a jump | `ground` left `true` | `"ground": false` plus `lift` on airborne keys |
| Hand stops short of the target | Target beyond reach (arm 62, leg 80 px) | Move the target or the body closer |
| Motion looks floaty | Long `dur` on fast actions | 0.14–0.2 s for take-off and landing |
| A knee or elbow looks reversed in a small thumbnail | Thumbnail too small to tell | `joints <scene> --at key:N`: a knee should sit forward of the hip-ankle line (larger x when facing right) |

## Script exit codes

`0` ok · `2` invalid scene or arguments (stderr names the field) · `3` missing Pillow or ffmpeg · `4` ffmpeg failed. Output is one JSON line on stdout; messages go to stderr.

## References

- `references/scene-format.md` — every field, pose type, pin, prop, repeat and walk rule. Read before writing the first scene of a session, and whenever `validate` rejects a field you do not recognise.
- `references/motion-recipes.md` — tested key sequences and timing for push-ups, getting up, walking, picking up, curls, press, waving and jumping. Read in step 3.
- `examples/workout.json` — a complete 18 s scene chaining several recipes. Open it when a request combines three or more moves.
