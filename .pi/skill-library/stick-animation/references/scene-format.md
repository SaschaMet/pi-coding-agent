# Scene format

## Contents

- Coordinates · Scene fields · Keys · Pose types · Pins · Props · Repeat · Walk · Errors

A scene is one JSON file. `validate` checks it and names the exact field on any error.

## Coordinates

- Screen pixels; **y points down**; `ground` is the floor's y (default `canvas height - 48`).
- Angles are degrees for a **right-facing** figure: `0` = forward, `-90` = straight up, `90` = down. Facing left mirrors them, so write every pose as if facing right.
- Relative offsets (`hands` on `stand`, `step`) are measured forward from the body; absolute points (`targets`, `squat` hands, props) are plain screen points.
- Fixed bone lengths: torso 60 (shoulder at 54), upper arm 32, forearm 30, thigh 40, shin 40, foot 10, head radius 17. Arm reach 62, leg reach 80. A target out of reach straightens the limb toward it.

## Scene fields

| Field | Default | Meaning |
| --- | --- | --- |
| `canvas` | `[640, 360]` | width, height (64–1920 × 64–1080) |
| `fps` | `30` | 1–60 |
| `ground` | `h - 48` | floor y |
| `facing` | `"right"` | start direction |
| `mat` | none | `[x0, x1]`: a floor mat strip |
| `props` | `[]` | see Props |
| `timeline` | required | keys, `repeat` blocks, `walk` items |

## Keys

```json
{ "dur": 0.6, "pose": { "type": "plank", "h": 17 }, "pin": ["hands", "feet"], "label": "PUSH-UPS 1/3" }
```

| Field | Meaning |
| --- | --- |
| `dur` | seconds from the previous key to this one (the first key's `dur` is ignored) |
| `pose` | one pose type, below |
| `pin` | contacts that stay exactly where the previous key had them: `hands`, `feet`, `near_hand`, `far_hand`, `near_foot`, `far_foot` |
| `ground` | default `true`: the figure is kept on the floor. `false` on an airborne key (jumps) |
| `facing` | `"right"` / `"left"`; default: the previous key's facing. Turning is instant |
| `label` | caption (≤ 40 chars), shown from the move into this key; `{i}`/`{n}` inside `repeat` |
| `grab` / `drop` | prop id: the near hand holds it from this key on / sets it on the floor here |

Motion between keys is eased (slow-in, slow-out). The floor clamp keeps unpinned motion on the floor; pinned contacts define the floor themselves, and free feet then step (lift, travel, set down) instead of sliding.

## Pose types

| Type | Fields (default) | Use for |
| --- | --- | --- |
| `stand` | `x` hip x (previous), `hands` relative to the shoulder `[dx, dy]` or `{near, far}` or `"prop:<id>"` (`[4, 60]` = arms down), `torso` (-88), `crouch` px hip drop (0–60), `step` near foot forward / far foot back (−40–40) | standing, arm moves, lifts, crouches, jump take-off and landing |
| `plank` | `h` shoulder height above the floor (60; 12–70), `toe_x` (previous toe x) | push-up top (`h` 60) and bottom (`h` 17) |
| `pike` | `h` hip height (70) | hips up with hands and feet planted: the way out of a plank |
| `crouch` | none | hands stay down, feet step in behind them: before standing up from the floor |
| `squat` | `x` feet x (previous hip x), `hands` absolute `[x, y]` or `"prop:<id>"`, `depth` hip height (42; 25–75), `torso` (-38) | picking something up, deadlift start |
| `targets` | `hip` `[x, y]`, `torso`, `hands` and `feet` absolute (`{near, far}` or one point), `arm_bend`/`knee_bend` (1 / -1), `foot` angle | anything the other types cannot express |

Every pose also takes `lift` (px): raise the whole pose. Use it with `ground: false`.

## Pins

- A pin copies the contact from the **previous key**, so pin on every key of a planted stretch (each push-up key pins `hands` and `feet`).
- The first key cannot pin.
- `pike` and `crouch` need a previous key; they reuse its hand and foot positions.

## Props

```json
"props": [{ "id": "plate", "kind": "plate", "r": 15, "at": [500, 297] }]
```

- `kind`: `plate` (a weight seen from the side). `r` 4–60. Rest it on the floor with `at[1] = ground - r`.
- Reach it with `"hands": "prop:plate"` on a `squat` or `stand`; add `"grab": "plate"` on the key where the hand closes (repeat the same pose with a short `dur` to show the grip).

## Repeat

```json
{ "repeat": 3, "keys": [ { … "label": "CURLS {i}/{n}" }, { … } ] }
```

One level only. `{i}` is the 1-based repetition, `{n}` the count.

## Walk

```json
{ "walk": { "to_x": 470, "step": 46, "step_dur": 0.36 }, "label": "WALK" }
```

Expands into passing and contact keys from the previous key's position; the planted foot is pinned, the figure faces the walking direction, and the feet end together at `to_x`. `step` 10–80 px, `step_dur` 0.1–3 s per step. Put a `stand` key before it.

## Errors

Exit 2 names the path, the value, and what is accepted, e.g. `scene error at timeline[2].keys[0].pose.h: got 90, expected a number in [12, 70]`. Fix that field; do not restructure the scene.
