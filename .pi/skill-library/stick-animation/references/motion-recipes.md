# Motion recipes

## Contents

- Timing · Push-ups · Getting up · Walking · Picking something up · Curls · Overhead press · Waving · Jumping · Limits

Every recipe below was rendered and checked with `inspect`. Copy the numbers, then adjust `x` and timing. `examples/workout.json` chains push-ups, get-up, walk, pick-up, curls and press.

## Timing

- A full rep (down + up) is 1.0–1.3 s; a weight lift 1.0–1.2 s; a hold 0.3–0.9 s.
- Add a short hold key (same pose, `dur` 0.2–0.5) at the start, at the end, and where something is gripped.
- Fast actions (take-off, landing) take 0.14–0.2 s; slow ones look floaty above 0.6 s.
- Squat depth on `stand`: `crouch` 20–28 reads as a dip, 45–50 with `torso` -62 as a full squat.

## Push-ups

```json
{ "dur": 0, "pose": { "type": "plank", "h": 60, "toe_x": 150 } },
{ "repeat": 3, "keys": [
  { "dur": 0.6,  "pose": { "type": "plank", "h": 17 }, "pin": ["hands", "feet"], "label": "PUSH-UPS {i}/{n}" },
  { "dur": 0.55, "pose": { "type": "plank", "h": 60 }, "pin": ["hands", "feet"], "label": "PUSH-UPS {i}/{n}" } ] }
```

## Getting up

From a plank: `pike` (hands and feet pinned), `crouch` (hands pinned), then `stand`. Skipping the pike makes the body swing through the floor.

```json
{ "dur": 0.5,  "pose": { "type": "pike" },   "pin": ["hands", "feet"] },
{ "dur": 0.45, "pose": { "type": "crouch" }, "pin": ["hands"] },
{ "dur": 0.7,  "pose": { "type": "stand" } }
```

## Walking

Always the `walk` item from a `stand` key; never slide a `stand` across `x` (the feet skate).

## Picking something up

Prop resting at `[x + 30, ground - r]`; the lifter's feet at `x`.

```json
{ "dur": 0.7,  "pose": { "type": "squat", "x": 470, "hands": "prop:plate" } },
{ "dur": 0.25, "pose": { "type": "squat", "x": 470, "hands": "prop:plate" }, "grab": "plate" },
{ "dur": 0.8,  "pose": { "type": "stand", "x": 470, "hands": [8, 58] } }
```

## Curls

Hang `[8, 58]` ↔ top `[17, 4]` with `torso: -91`, 0.5–0.55 s each way.

## Overhead press

Rack `[13, -3]` ↔ lockout `[3, -60]` with `torso: -90`, 0.55–0.6 s each way. The arms pass beside the head; that is correct for a side view.

## Waving

Keep the elbow still in front at shoulder height; swing only the forearm. Near hand `[43, -42]` ↔ `[13, -42]`, 0.3 s each, far hand `[4, 60]`.

```json
{ "dur": 0.45, "pose": { "type": "stand", "hands": { "near": [43, -42], "far": [4, 60] } } },
{ "repeat": 3, "keys": [
  { "dur": 0.3, "pose": { "type": "stand", "hands": { "near": [13, -42], "far": [4, 60] } } },
  { "dur": 0.3, "pose": { "type": "stand", "hands": { "near": [43, -42], "far": [4, 60] } } } ] }
```

## Jumping

Load, take off, fly (`ground: false` with `lift`), land soft, recover. For a plain hop use `crouch` 28 and `torso` -70 on the load key.

```json
{ "dur": 0.45, "pose": { "type": "stand", "crouch": 48, "torso": -62, "hands": [22, 30] } },
{ "dur": 0.14, "pose": { "type": "stand", "hands": [6, -58] } },
{ "dur": 0.22, "pose": { "type": "stand", "hands": [6, -58], "lift": 46 }, "ground": false },
{ "dur": 0.2,  "pose": { "type": "stand", "crouch": 4, "hands": [14, 10] } },
{ "dur": 0.16, "pose": { "type": "stand", "crouch": 22, "torso": -75, "hands": [20, 30] } },
{ "dur": 0.3,  "pose": { "type": "stand" } }
```

## Limits

- Side view only: a wave toward the camera, a turn of the head, or a front-facing figure cannot be shown.
- One figure; props are plates.
- No rotation in the air (flips): `lift` raises the pose but the body stays upright.
