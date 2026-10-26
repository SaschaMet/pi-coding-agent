#!/usr/bin/env python3
"""Stick-figure animation renderer: JSON scene -> MP4/GIF and inspection images.

Exit codes: 0 ok, 2 invalid scene or arguments, 3 missing dependency, 4 render failed.
Coordinates are screen pixels (y points down); angles are degrees.
"""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

USAGE = """usage:
  stickanim.py check
  stickanim.py validate <scene.json>
  stickanim.py render  <scene.json> --out <dir> [--formats mp4,gif] [--name <stem>]
  stickanim.py inspect <scene.json> --out <dir>
  stickanim.py joints  <scene.json> --at <seconds|key:N>
"""
COMMANDS = ('check', 'validate', 'render', 'inspect', 'joints')
FORMATS = ('mp4', 'gif')
EXIT_INPUT, EXIT_SETUP, EXIT_RENDER = 2, 3, 4
MAX_SECONDS, MAX_KEYS = 120, 600

# Bone lengths (px). Fixed: IK never stretches a limb.
TORSO, SHOULDER, UARM, FARM, THIGH, SHIN, FOOT, HEAD_R = 60, 54, 32, 30, 40, 40, 10, 17
ANGLES = ('torso', 'nu', 'nf', 'fu', 'ff', 'nt', 'ns', 'ft', 'fs', 'nfoot', 'ffoot')
CONTACTS = {'near_hand': 'nha', 'far_hand': 'fha', 'near_foot': 'nan', 'far_foot': 'fan'}
PIN_GROUPS = {'hands': ('near_hand', 'far_hand'), 'feet': ('near_foot', 'far_foot'),
              'near_hand': ('near_hand',), 'far_hand': ('far_hand',),
              'near_foot': ('near_foot',), 'far_foot': ('far_foot',)}


class Fail(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def scene_error(path, message):
    return Fail(EXIT_INPUT, f'scene error at {path}: {message}')


# ---- geometry ----------------------------------------------------------------
def vec(a, length):
    r = math.radians(a)
    return (length * math.cos(r), length * math.sin(r))


def add(p, q):
    return (p[0] + q[0], p[1] + q[1])


def angle_to(p, q):
    return math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))


def ik(origin, target, l1, l2, bend):
    """Two-bone IK for a right-facing figure. bend=+1 puts the middle joint clockwise of
    origin->target on screen (elbows behind), bend=-1 counter-clockwise (knees in front).
    An unreachable target straightens the limb toward it."""
    dx, dy = target[0] - origin[0], target[1] - origin[1]
    d = min(max(math.hypot(dx, dy), abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3)
    inner = math.degrees(math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)))
    a1 = math.degrees(math.atan2(dy, dx)) + bend * inner
    return a1, angle_to(add(origin, vec(a1, l1)), target)


def mirror_x(p, axis):
    return (2 * axis - p[0], p[1])


def solve(rig):
    """Rig (world targets) -> pose (right-facing angles + root). Left-facing rigs are solved
    in mirrored space so the same bend signs hold."""
    hip, facing = rig['hip'], rig['facing']
    local = (lambda p: p) if facing > 0 else (lambda p: mirror_x(p, hip[0]))
    sh = add(hip, vec(rig['torso'], SHOULDER))
    pose = {'x': hip[0], 'y': hip[1], 'torso': rig['torso'], 'facing': facing,
            'nfoot': rig['feet'][0], 'ffoot': rig['feet'][1]}
    pose['nu'], pose['nf'] = ik(sh, local(rig['hands'][0]), UARM, FARM, rig['arm_bend'])
    pose['fu'], pose['ff'] = ik(sh, local(rig['hands'][1]), UARM, FARM, rig['arm_bend'])
    pose['nt'], pose['ns'] = ik(hip, local(rig['ankles'][0]), THIGH, SHIN, rig['knee_bend'])
    pose['ft'], pose['fs'] = ik(hip, local(rig['ankles'][1]), THIGH, SHIN, rig['knee_bend'])
    return pose


def forward(pose):
    """Pose -> world joint positions."""
    hip = (pose['x'], pose['y'])
    j = {'hip': hip, 'sh': add(hip, vec(pose['torso'], SHOULDER)),
         'neck': add(hip, vec(pose['torso'], TORSO)),
         'head': add(hip, vec(pose['torso'], TORSO + HEAD_R + 2))}
    for s in 'nf':
        j[s + 'el'] = add(j['sh'], vec(pose[s + 'u'], UARM))
        j[s + 'ha'] = add(j[s + 'el'], vec(pose[s + 'f'], FARM))
        j[s + 'kn'] = add(hip, vec(pose[s + 't'], THIGH))
        j[s + 'an'] = add(j[s + 'kn'], vec(pose[s + 's'], SHIN))
        j[s + 'to'] = add(j[s + 'an'], vec(pose[s + 'foot'], FOOT))
    if pose['facing'] < 0:
        j = {k: mirror_x(v, hip[0]) for k, v in j.items()}
    return j


def lowest(j):
    return max(v[1] for k, v in j.items() if k != 'head')


def shifted(j, dy):
    return {k: (v[0], v[1] + dy) for k, v in j.items()}


# ---- scene parsing -----------------------------------------------------------
def num(value, path, lo=-math.inf, hi=math.inf):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise scene_error(path, f'got {json.dumps(value)}, expected a number')
    if not lo <= value <= hi:
        raise scene_error(path, f'got {value}, expected a number in [{lo}, {hi}]')
    return float(value)


def point(value, path):
    if not isinstance(value, list) or len(value) != 2:
        raise scene_error(path, f'got {json.dumps(value)}, expected [x, y]')
    return (num(value[0], f'{path}[0]'), num(value[1], f'{path}[1]'))


def choice(value, path, accepted):
    if value not in accepted:
        raise scene_error(path, f'got {json.dumps(value)}, accepted: {", ".join(accepted)}')
    return value


def check_keys(obj, path, allowed):
    if not isinstance(obj, dict):
        raise scene_error(path, f'got {json.dumps(obj)}, expected an object')
    for k in obj:
        if k not in allowed:
            raise scene_error(f'{path}.{k}', f'unknown field, accepted: {", ".join(allowed)}')


class Ctx:
    """Compile-time state shared by pose builders."""

    def __init__(self, scene):
        self.w, self.h = scene['canvas']
        self.ground = scene['ground']
        self.facing = scene['facing']
        self.props = scene['props']          # id -> {'kind', 'r', 'at', 'pos', 'events'}
        self.prev = None                     # previous compiled key
        self.index = 0                       # index of the key being compiled
        self.dir = 1                         # +1 facing right, -1 facing left


def ahead(ctx, base, dx, dy=0.0):
    """Offset from base with dx measured in the facing direction."""
    return (base[0] + dx * ctx.dir, base[1] + dy)


def along(ctx, base, angle, length):
    """Point along a body angle given for a right-facing figure, mirrored when facing left."""
    v = vec(angle, length)
    return ahead(ctx, base, v[0], v[1])


def hand_pair(value, path, ctx, base, default):
    """Hands as [dx,dy] / {near, far} relative to `base` (dx toward the facing side), or absolute
    points when base is None, or "prop:<id>"."""
    def one(v, p):
        if isinstance(v, str):
            return prop_target(v, p, ctx)
        rel = point(v, p)
        return ahead(ctx, base, rel[0], rel[1]) if base else rel
    if value is None:
        value = default
    if isinstance(value, dict):
        check_keys(value, path, ('near', 'far'))
        near = one(value.get('near', default), f'{path}.near')
        return (near, one(value.get('far', value.get('near', default)), f'{path}.far'))
    h = one(value, path)
    return (h, h)


def prop_target(value, path, ctx):
    if not value.startswith('prop:') or value[5:] not in ctx.props:
        raise scene_error(path, f'got {json.dumps(value)}, expected "prop:<id>" with one of: '
                                f'{", ".join(ctx.props) or "(no props)"}')
    return ctx.props[value[5:]]['pos']


def prev_hip_x(ctx):
    return ctx.prev['pose']['x'] if ctx.prev else ctx.w / 2


def build_stand(p, path, ctx):
    check_keys(p, path, ('type', 'x', 'hands', 'torso', 'crouch', 'step', 'lift'))
    x = num(p['x'], f'{path}.x', 0, ctx.w) if 'x' in p else prev_hip_x(ctx)
    torso = num(p.get('torso', -88), f'{path}.torso', -180, 180)
    crouch = num(p.get('crouch', 0), f'{path}.crouch', 0, 60)
    step = num(p.get('step', 0), f'{path}.step', -40, 40)
    hip = (x, ctx.ground - (THIGH + SHIN - 1) + crouch)
    sh = along(ctx, hip, torso, SHOULDER)
    hands = hand_pair(p.get('hands'), f'{path}.hands', ctx, sh, [4, 60])
    ankles = (ahead(ctx, (x, ctx.ground), step), ahead(ctx, (x, ctx.ground), -step))
    return {'hip': hip, 'torso': torso, 'hands': hands, 'ankles': ankles,
            'arm_bend': 1, 'knee_bend': -1, 'feet': (0.0, 0.0)}


def build_targets(p, path, ctx):
    check_keys(p, path, ('type', 'hip', 'torso', 'hands', 'feet', 'arm_bend', 'knee_bend', 'foot', 'lift'))
    if 'hip' not in p or 'hands' not in p or 'feet' not in p:
        raise scene_error(path, 'targets needs hip, hands and feet')
    hip = point(p['hip'], f'{path}.hip')
    feet = hand_pair(p['feet'], f'{path}.feet', ctx, None, None)
    foot = num(p.get('foot', 0), f'{path}.foot', -180, 180)
    return {'hip': hip, 'torso': num(p.get('torso', -88), f'{path}.torso', -180, 180),
            'hands': hand_pair(p['hands'], f'{path}.hands', ctx, None, None), 'ankles': feet,
            'arm_bend': choice(p.get('arm_bend', 1), f'{path}.arm_bend', (1, -1)),
            'knee_bend': choice(p.get('knee_bend', -1), f'{path}.knee_bend', (1, -1)),
            'feet': (foot, foot)}


def require_prev(path, ctx, kind):
    if ctx.prev is None:
        raise scene_error(path, f'a {kind} builds on the previous key\'s hands and feet, so it cannot come first')
    return ctx.prev


def build_plank(p, path, ctx):
    """Rigid plank on the toes; h = shoulder height above the floor; hands under the shoulders."""
    check_keys(p, path, ('type', 'h', 'toe_x', 'lift'))
    h = num(p.get('h', 60), f'{path}.h', 12, 70)
    if 'toe_x' in p:
        toe_x = num(p['toe_x'], f'{path}.toe_x', 0, ctx.w)
    else:
        toe_x = ctx.prev['joints']['nto'][0] if ctx.prev else ctx.w / 4
    body = THIGH + SHIN + SHOULDER
    th = math.asin(min(1.0, (h - FOOT) / body))
    for _ in range(6):                      # shoulder height = foot rise + body rise
        th = math.asin(min(1.0, (h - FOOT * math.cos(th)) / body))
    toe = (toe_x, ctx.ground)
    ankle = ahead(ctx, toe, -FOOT * math.sin(th), -FOOT * math.cos(th))
    torso = -math.degrees(th)
    hip = along(ctx, ankle, torso, THIGH + SHIN)
    sh = along(ctx, hip, torso, SHOULDER)
    hand = (ahead(ctx, sh, -2)[0], ctx.ground)
    foot = 90 - math.degrees(th)             # toes on the floor, perpendicular to the legs
    return {'hip': hip, 'torso': torso, 'hands': (hand, hand), 'ankles': (ankle, ankle),
            'arm_bend': 1, 'knee_bend': -1, 'feet': (foot, foot)}


def build_pike(p, path, ctx):
    """Hips up, hands and feet where the previous key had them: the bridge out of a plank."""
    check_keys(p, path, ('type', 'h', 'lift'))
    prev = require_prev(path, ctx, 'pike')
    h = num(p.get('h', 70), f'{path}.h', 30, 90)
    c = prev['contacts']
    hand_x, ankle_x = c['near_hand'][0], c['near_foot'][0]
    hip = ahead(ctx, ((hand_x + ankle_x) / 2, ctx.ground - h), -8)
    lean = (hand_x + 6 * ctx.dir - hip[0]) * ctx.dir   # torso aims just past the hands
    return {'hip': hip, 'torso': math.degrees(math.atan2(12, lean)),
            'hands': (c['near_hand'], c['far_hand']), 'ankles': (c['near_foot'], c['far_foot']),
            'arm_bend': 1, 'knee_bend': -1, 'feet': prev['rig']['feet']}


def build_crouch(p, path, ctx):
    """Hands stay on the floor, feet step in behind them: the step before standing up."""
    check_keys(p, path, ('type', 'lift'))
    prev = require_prev(path, ctx, 'crouch')
    hand_x = prev['contacts']['near_hand'][0]
    hand = (hand_x, ctx.ground)
    ankle = ahead(ctx, hand, -30)
    return {'hip': ahead(ctx, hand, -34, -50), 'torso': -12, 'hands': (hand, hand),
            'ankles': (ankle, ankle), 'arm_bend': 1, 'knee_bend': -1, 'feet': (0.0, 0.0)}


def build_squat(p, path, ctx):
    """Hip-back squat with feet at x; hands reach an absolute point or a prop."""
    check_keys(p, path, ('type', 'x', 'hands', 'depth', 'torso', 'lift'))
    x = num(p['x'], f'{path}.x', 0, ctx.w) if 'x' in p else prev_hip_x(ctx)
    depth = num(p.get('depth', 42), f'{path}.depth', 25, 75)
    torso = num(p.get('torso', -38), f'{path}.torso', -180, 180)
    hip = ahead(ctx, (x, ctx.ground - depth), -24)
    sh = along(ctx, hip, torso, SHOULDER)
    reach = ahead(ctx, sh, 6, 55)
    hands = hand_pair(p.get('hands'), f'{path}.hands', ctx, None, [reach[0], reach[1]])
    ankle = (x, ctx.ground)
    return {'hip': hip, 'torso': torso, 'hands': hands, 'ankles': (ankle, ankle),
            'arm_bend': 1, 'knee_bend': -1, 'feet': (0.0, 0.0)}


BUILDERS = {'stand': build_stand, 'plank': build_plank, 'pike': build_pike, 'crouch': build_crouch,
            'squat': build_squat, 'targets': build_targets}
KEY_FIELDS = ('dur', 'pose', 'label', 'pin', 'ground', 'facing', 'grab', 'drop')


def compile_key(item, path, ctx, rep=None):
    check_keys(item, path, KEY_FIELDS)
    if 'pose' not in item:
        raise scene_error(path, 'a key needs a pose')
    dur = num(item.get('dur', 0), f'{path}.dur', 0, MAX_SECONDS)
    pose_spec = item['pose']
    if not isinstance(pose_spec, dict):
        raise scene_error(f'{path}.pose', f'got {json.dumps(pose_spec)}, expected an object')
    kind = choice(pose_spec.get('type'), f'{path}.pose.type', tuple(BUILDERS))
    inherited = ctx.prev['rig']['facing'] if ctx.prev else (1 if ctx.facing == 'right' else -1)
    if 'facing' in item:
        ctx.dir = 1 if choice(item['facing'], f'{path}.facing', ('right', 'left')) == 'right' else -1
    else:
        ctx.dir = inherited
    rig = BUILDERS[kind](pose_spec, f'{path}.pose', ctx)
    rig['facing'] = ctx.dir
    lift = num(pose_spec.get('lift', 0), f'{path}.pose.lift', 0, ctx.h)
    pins = pin_list(item.get('pin', []), f'{path}.pin', ctx)
    if pins:
        prev_contacts = ctx.prev['contacts']
        hands, ankles = list(rig['hands']), list(rig['ankles'])
        for c in pins:
            target = prev_contacts[c]
            if c.endswith('hand'):
                hands[0 if c.startswith('near') else 1] = target
            else:
                ankles[0 if c.startswith('near') else 1] = target
        rig['hands'], rig['ankles'] = tuple(hands), tuple(ankles)
    ground = item.get('ground', True)
    if not isinstance(ground, bool):
        raise scene_error(f'{path}.ground', f'got {json.dumps(ground)}, expected true or false')
    pose = solve(rig)
    pose['y'] -= lift                        # before pinning: pinned contacts must not rise with the body
    if pins:
        pin_limbs(pose, {'rig': rig, 'pins': pins, 'contacts': ctx.prev['contacts']})
    joints = forward(pose)
    if ground and not pins:                  # pinned contacts define the floor themselves
        dy = ctx.ground - lowest(joints)
        pose['y'] += dy
        joints = shifted(joints, dy)
    label = item.get('label')
    if label is not None and (not isinstance(label, str) or len(label) > 40):
        raise scene_error(f'{path}.label', 'expected a string of at most 40 characters')
    if label is not None and rep:
        label = label.replace('{i}', str(rep[0])).replace('{n}', str(rep[1]))
    contacts = {c: joints[j] for c, j in CONTACTS.items()}
    for event in ('grab', 'drop'):
        if event in item:
            prop = ctx.props.get(item[event]) if isinstance(item[event], str) else None
            if prop is None:
                raise scene_error(f'{path}.{event}', f'got {json.dumps(item[event])}, known props: '
                                                     f'{", ".join(ctx.props) or "(none)"}')
            if event == 'drop':
                prop['pos'] = (contacts['near_hand'][0], ctx.ground - prop['r'])
            prop['events'].append((ctx.index, event, prop['pos']))
    key = {'dur': dur, 'pose': pose, 'rig': rig, 'pins': pins, 'ground': ground, 'label': label,
           'contacts': contacts, 'joints': joints, 'path': path}
    ctx.prev = key
    ctx.index += 1
    return key


def walk_items(item, path, ctx):
    """Expand a walk into plain keys. Each step: a passing key (swing foot lifted beside the
    planted one) and a contact key (swing foot lands a stride ahead). The planted foot is
    pinned throughout; a last step brings the feet together at to_x."""
    check_keys(item, path, ('walk', 'label'))
    spec = item['walk']
    check_keys(spec, f'{path}.walk', ('to_x', 'step', 'step_dur'))
    prev = require_prev(f'{path}.walk', ctx, 'walk')
    to_x = num(spec.get('to_x'), f'{path}.walk.to_x', 0, ctx.w)
    stride = num(spec.get('step', 46), f'{path}.walk.step', 10, 80)
    half_dur = num(spec.get('step_dur', 0.32), f'{path}.walk.step_dur', 0.1, 3) / 2
    x0, g = prev['pose']['x'], ctx.ground
    if abs(to_x - x0) < 1:
        return []
    d = 1 if to_x > x0 else -1
    n = max(1, round(abs(to_x - x0) / stride))
    landings = [x0 + d * abs(to_x - x0) * k / n for k in range(1, n + 1)] + [to_x]
    feet = {'near': prev['contacts']['near_foot'][0], 'far': prev['contacts']['far_foot'][0]}
    facing = 'right' if d > 0 else 'left'
    torso = -86.0

    def key(hip, swing, swing_at, stance, arm_swing):
        sh = (hip[0] + math.cos(math.radians(torso)) * SHOULDER * d, hip[1] + math.sin(math.radians(torso)) * SHOULDER)
        hands = {'near': [sh[0] - arm_swing * d, sh[1] + 57], 'far': [sh[0] + arm_swing * d, sh[1] + 57]}
        ankles = {stance: [feet[stance], g], swing: [swing_at[0], swing_at[1]]}
        out = {'dur': half_dur, 'facing': facing, 'pin': [f'{stance}_foot'],
               'pose': {'type': 'targets', 'hip': [hip[0], hip[1]], 'torso': torso,
                        'hands': hands, 'feet': ankles}}
        if 'label' in item:
            out['label'] = item['label']
        return out

    items, swing = [], 'near'
    for land in landings:
        stance = 'far' if swing == 'near' else 'near'
        st = feet[stance]
        items.append(key((st, g - (THIGH + SHIN - 1)), swing, (st, g - 16), stance, 0))
        half = min(abs(land - st) / 2, THIGH + SHIN - 2)
        hip_y = g - math.sqrt((THIGH + SHIN - 0.5) ** 2 - half ** 2)
        arm = 14 if land != st else 0
        items.append(key(((st + land) / 2, hip_y), swing, (land, g), stance, arm if swing == 'near' else -arm))
        feet[swing] = land
        swing = stance
    return items


def expand(timeline):
    """Flatten repeat blocks into (item, path, (i, n)) entries."""
    for i, item in enumerate(timeline):
        path = f'timeline[{i}]'
        if isinstance(item, dict) and 'repeat' in item:
            check_keys(item, path, ('repeat', 'keys'))
            n = int(num(item['repeat'], f'{path}.repeat', 1, 100))
            inner = item.get('keys')
            if not isinstance(inner, list) or not inner:
                raise scene_error(f'{path}.keys', 'expected a non-empty list of keys')
            for r in range(1, n + 1):
                for j, sub in enumerate(inner):
                    yield sub, f'{path}.keys[{j}]', (r, n)
        else:
            yield item, path, None


def pin_list(value, path, ctx):
    if not isinstance(value, list):
        raise scene_error(path, f'got {json.dumps(value)}, expected a list of: {", ".join(PIN_GROUPS)}')
    if value and ctx.prev is None:
        raise scene_error(path, 'the first key cannot pin: there is no earlier position')
    out = []
    for i, v in enumerate(value):
        for c in PIN_GROUPS[choice(v, f'{path}[{i}]', tuple(PIN_GROUPS))]:
            if c not in out:
                out.append(c)
    return out


def load_scene(file):
    try:
        with open(file, encoding='utf-8') as fh:
            raw = json.load(fh)
    except OSError as e:
        raise Fail(EXIT_INPUT, f'cannot read scene {file}: {e.strerror}') from None
    except json.JSONDecodeError as e:
        raise Fail(EXIT_INPUT, f'scene is not valid JSON: {e.msg} (line {e.lineno}, column {e.colno})') from None
    check_keys(raw, 'scene', ('canvas', 'fps', 'ground', 'facing', 'mat', 'props', 'timeline'))
    canvas = point(raw.get('canvas', [640, 360]), 'canvas')
    w, h = int(num(canvas[0], 'canvas[0]', 64, 1920)), int(num(canvas[1], 'canvas[1]', 64, 1080))
    scene = {'canvas': (w, h), 'fps': int(num(raw.get('fps', 30), 'fps', 1, 60)),
             'ground': num(raw.get('ground', h - 48), 'ground', 0, h),
             'facing': choice(raw.get('facing', 'right'), 'facing', ('right', 'left')),
             'mat': None, 'props': {}}
    if 'mat' in raw:
        scene['mat'] = point(raw['mat'], 'mat')
    props = raw.get('props', [])
    if not isinstance(props, list):
        raise scene_error('props', 'expected a list')
    for i, p in enumerate(props):
        path = f'props[{i}]'
        check_keys(p, path, ('id', 'kind', 'r', 'at'))
        pid = p.get('id')
        if not isinstance(pid, str) or not pid or pid in scene['props']:
            raise scene_error(f'{path}.id', f'got {json.dumps(pid)}, expected a unique non-empty string')
        choice(p.get('kind', 'plate'), f'{path}.kind', ('plate',))
        at = point(p.get('at'), f'{path}.at')
        scene['props'][pid] = {'kind': 'plate', 'r': num(p.get('r', 15), f'{path}.r', 4, 60),
                               'at': at, 'pos': at, 'events': []}
    timeline = raw.get('timeline')
    if not isinstance(timeline, list) or not timeline:
        raise scene_error('timeline', 'expected a non-empty list of keys')
    ctx = Ctx(scene)
    keys = []
    for item, path, rep in expand(timeline):
        if isinstance(item, dict) and 'walk' in item:
            keys.extend(compile_key(sub, f'{path}.walk', ctx, rep) for sub in walk_items(item, path, ctx))
        else:
            keys.append(compile_key(item, path, ctx, rep))
        if len(keys) > MAX_KEYS:
            raise scene_error('timeline', f'more than {MAX_KEYS} keys')
    keys[0]['dur'] = 0.0
    t = 0.0
    for k in keys:
        t += k['dur']
        k['t'] = t
    if t > MAX_SECONDS:
        raise scene_error('timeline', f'total {t:.1f}s, expected at most {MAX_SECONDS}s')
    scene['keys'], scene['seconds'] = keys, t
    return scene


# ---- sampling ----------------------------------------------------------------
def ease(s):
    return s * s * (3 - 2 * s)


def segment(scene, t):
    keys = scene['keys']
    i = 0
    while i + 1 < len(keys) and keys[i + 1]['t'] <= t + 1e-9:
        i += 1
    return i


def sample(scene, t):
    """Joints at time t: blend angles along the shortest arc, re-solve pinned limbs onto
    their contact, and clamp unpinned grounded motion to the floor."""
    keys = scene['keys']
    i = segment(scene, t)
    a = keys[i]
    if i + 1 == len(keys) or keys[i + 1]['t'] - a['t'] <= 1e-9:
        return forward(a['pose']), a, a
    b = keys[i + 1]
    s = ease((t - a['t']) / (b['t'] - a['t']))
    pa, pb = a['pose'], b['pose']
    pose = {k: pa[k] + (((pb[k] - pa[k] + 180) % 360) - 180) * s for k in ANGLES}
    pose['x'] = pa['x'] + (pb['x'] - pa['x']) * s
    pose['y'] = pa['y'] + (pb['y'] - pa['y']) * s
    pose['facing'] = pb['facing'] if s > 0 else pa['facing']
    if b['pins']:
        pin_limbs(pose, b)
        if a['ground'] and b['ground']:
            step_free_feet(pose, a, b, (t - a['t']) / (b['t'] - a['t']), scene['ground'])
    joints = forward(pose)
    if a['ground'] and b['ground'] and not b['pins']:
        joints = shifted(joints, scene['ground'] - lowest(joints))
    elif a['ground'] and b['ground']:
        joints = feet_above_floor(pose, b, scene['ground'], joints)
    return joints, a, b


def clamp01(v):
    return min(1.0, max(0.0, v))


def step_free_feet(pose, a, b, u, ground):
    """Move each unpinned foot that changes place along a stepping path: it rises before it
    travels and finishes travelling before it sets down, so it never skids on the floor."""
    hip = (pose['x'], pose['y'])
    local = (lambda p: p) if pose['facing'] > 0 else (lambda p: mirror_x(p, hip[0]))
    for side, contact in (('n', 'near_foot'), ('f', 'far_foot')):
        start, end = a['contacts'][contact], b['contacts'][contact]
        if contact in b['pins'] or math.hypot(end[0] - start[0], end[1] - start[1]) < 0.5:
            continue
        lifts, lands = start[1] >= ground - 0.5, end[1] >= ground - 0.5
        travel = ease(clamp01((u - (0.2 if lifts else 0.0)) / (1.0 - (0.2 if lifts else 0.0) - (0.2 if lands else 0.0))))
        arc = min(16.0, 0.3 * abs(end[0] - start[0])) if lifts and lands else 0.0
        target = (start[0] + (end[0] - start[0]) * travel,
                  min(ground, start[1] + (end[1] - start[1]) * ease(u) - arc * math.sin(math.pi * u)))
        pose[side + 't'], pose[side + 's'] = ik(hip, local(target), THIGH, SHIN, b['rig']['knee_bend'])


def feet_above_floor(pose, key, ground, joints):
    """With pins the floor clamp is off, so a free foot could pass through the floor while it
    swings. Re-solve such a leg onto the floor instead."""
    hip = (pose['x'], pose['y'])
    local = (lambda p: p) if pose['facing'] > 0 else (lambda p: mirror_x(p, hip[0]))
    changed = False
    for side, contact in (('n', 'near_foot'), ('f', 'far_foot')):
        ankle = joints[side + 'an']
        if contact not in key['pins'] and ankle[1] > ground:
            pose[side + 't'], pose[side + 's'] = ik(hip, local((ankle[0], ground)), THIGH, SHIN, key['rig']['knee_bend'])
            changed = True
    return forward(pose) if changed else joints


def fit_reach(pose, targets):
    """Blending can carry the body out of reach of a planted contact. Pull the hip toward
    out-of-reach feet, then turn the torso about the hip (the smallest turn) until every
    planted hand is reachable, so pinned contacts never slide."""
    arm_reach, leg_reach = UARM + FARM - 0.05, THIGH + SHIN - 0.05
    hip = (pose['x'], pose['y'])
    for c, target in targets.items():
        d = math.hypot(hip[0] - target[0], hip[1] - target[1])
        if c.endswith('foot') and d > leg_reach:
            k = leg_reach / d
            hip = (target[0] + (hip[0] - target[0]) * k, target[1] + (hip[1] - target[1]) * k)
    pose['x'], pose['y'] = hip
    hands = [t for c, t in targets.items() if c.endswith('hand')]

    def worst(a):
        sh = add(hip, vec(a, SHOULDER))
        return max((math.hypot(sh[0] - h[0], sh[1] - h[1]) for h in hands), default=0.0)

    if worst(pose['torso']) <= arm_reach:
        return
    for step in range(1, 721):
        for a in (pose['torso'] + step * 0.25, pose['torso'] - step * 0.25):
            if worst(a) <= arm_reach:
                pose['torso'] = a
                return


def pin_limbs(pose, key):
    axis = pose['x']
    local = (lambda p: p) if pose['facing'] > 0 else (lambda p: mirror_x(p, axis))
    fit_reach(pose, {c: local(key['contacts'][c]) for c in key['pins']})
    if pose['facing'] < 0:                  # fit_reach moved the hip in mirrored space
        pose['x'] = 2 * axis - pose['x']
    hip = (pose['x'], pose['y'])
    local = (lambda p: p) if pose['facing'] > 0 else (lambda p: mirror_x(p, hip[0]))
    sh = add(hip, vec(pose['torso'], SHOULDER))
    rig = key['rig']
    for c in key['pins']:
        target = local(key['contacts'][c])
        side = 'n' if c.startswith('near') else 'f'
        if c.endswith('hand'):
            pose[side + 'u'], pose[side + 'f'] = ik(sh, target, UARM, FARM, rig['arm_bend'])
        else:
            pose[side + 't'], pose[side + 's'] = ik(hip, target, THIGH, SHIN, rig['knee_bend'])


def prop_positions(scene, t, joints):
    """Each prop rests at its last drop spot (or start) unless its latest event is a grab."""
    keys, out = scene['keys'], {}
    for pid, prop in scene['props'].items():
        state, pos = None, prop['at']
        for index, event, where in prop['events']:
            if keys[index]['t'] <= t + 1e-9:
                state, pos = event, where
        out[pid] = joints['nha'] if state == 'grab' else pos
    return out


def label_at(scene, t):
    keys = scene['keys']
    i = segment(scene, t)
    for k in reversed(keys[:min(i + 2, len(keys))]):
        if k['label'] is not None:
            return k['label']
    return ''


# ---- drawing (approved style: bold one-ink limbs, doodle head, slight wobble) ----
INK, BG, FLOOR, MAT = (32, 32, 34), (238, 240, 242), (70, 72, 76), (205, 216, 228)
PLATE, HUB = (88, 90, 96), (200, 202, 208)
LIMB_W, TORSO_W, HEAD_LINE, WOBBLE, SS = 9, 10, 3.5, 0.8, 3


class Canvas:
    def __init__(self, Image, ImageDraw, ImageFont, w, h):
        self.Image, self.w, self.h = Image, w, h
        self.img = Image.new('RGB', (w * SS, h * SS), BG)
        self.d = ImageDraw.Draw(self.img)
        self.font = ImageFont.load_default(size=26 * SS)

    def S(self, p):
        return (p[0] * SS, p[1] * SS)

    def dot(self, c, r, fill, outline=None, width=2.0):
        x, y = self.S(c)
        self.d.ellipse([x - r * SS, y - r * SS, x + r * SS, y + r * SS], fill=fill,
                       outline=outline, width=int(width * SS))

    def stroke(self, a, b, w, color=INK, wobble=0.0):
        """Round-capped stroke; wobble bows it sideways by a fixed amount (no flicker)."""
        n = 8 if wobble else 1
        nx, ny = -(b[1] - a[1]), b[0] - a[0]
        ln = math.hypot(nx, ny) or 1.0
        pts = [(a[0] + (b[0] - a[0]) * i / n + nx / ln * wobble * math.sin(math.pi * i / n),
                a[1] + (b[1] - a[1]) * i / n + ny / ln * wobble * math.sin(math.pi * i / n))
               for i in range(n + 1)]
        self.d.line([self.S(q) for q in pts], fill=color, width=int(w * SS), joint='curve')
        self.dot(a, w / 2, color)
        self.dot(b, w / 2, color)

    def result(self):
        return self.img.resize((self.w, self.h), self.Image.LANCZOS)


def draw_limbs(cv, j, side):
    wob = WOBBLE if side == 'n' else -WOBBLE
    cv.stroke(j['sh'], j[side + 'el'], LIMB_W, wobble=wob)
    cv.stroke(j[side + 'el'], j[side + 'ha'], LIMB_W, wobble=-wob)
    cv.stroke(j['hip'], j[side + 'kn'], LIMB_W, wobble=wob)
    cv.stroke(j[side + 'kn'], j[side + 'an'], LIMB_W, wobble=-wob)
    cv.stroke(j[side + 'an'], j[side + 'to'], LIMB_W + 2)            # foot stub


def draw_head(cv, j, facing):
    c, up_dir = j['head'], angle_to(j['neck'], j['head'])
    tilt = (((up_dir + 90 + 180) % 360) - 180) * 0.5             # the face tilts half as far as the body
    up = vec(-90 + tilt, 1)
    fwd = (-up[1] * facing, up[0] * facing) if facing > 0 else (up[1], -up[0])

    def at(f, u):
        return (c[0] + fwd[0] * f + up[0] * u, c[1] + fwd[1] * f + up[1] * u)

    cv.dot(c, HEAD_R, (255, 255, 255), outline=INK, width=HEAD_LINE)
    cv.dot(at(4, 3.5), 1.9, INK)
    cv.dot(at(10, 3.5), 1.9, INK)
    cv.stroke(at(3.5, -5), at(11, -5), 1.8)


def draw_figure(cv, j, facing):
    draw_limbs(cv, j, 'f')
    cv.stroke(j['hip'], j['neck'], TORSO_W, wobble=0.6)
    neck_top = add(j['head'], vec(angle_to(j['head'], j['neck']), HEAD_R - 2))
    cv.stroke(j['neck'], neck_top, LIMB_W - 2)
    draw_head(cv, j, facing)


def render_frame(pil, scene, t, caption=True):
    Image, ImageDraw, ImageFont = pil
    w, h = scene['canvas']
    g = scene['ground']
    cv = Canvas(Image, ImageDraw, ImageFont, w, h)
    if scene['mat']:
        cv.d.rectangle([cv.S((scene['mat'][0], g - 2)), cv.S((scene['mat'][1], g + 2))], fill=MAT)
    cv.stroke((0, g + 3), (w, g + 3), 2, FLOOR)
    joints, a, b = sample(scene, t)
    facing = b['pose']['facing'] if t > a['t'] else a['pose']['facing']
    draw_figure(cv, joints, facing)
    for pid, pos in prop_positions(scene, t, joints).items():
        r = scene['props'][pid]['r']
        cv.dot(pos, r, PLATE, outline=INK, width=2)
        cv.dot(pos, r * 0.3, HUB)
    draw_limbs(cv, joints, 'n')
    label = label_at(scene, t) if caption else ''
    if label:
        cv.d.text((24 * SS, 22 * SS), label, fill=INK, font=cv.font)
    return cv.result()


# ---- commands ----------------------------------------------------------------
def ffmpeg_path():
    # STICKANIM_FFMPEG pins the binary; shutil.which also rejects a non-executable path.
    return shutil.which(os.environ.get('STICKANIM_FFMPEG') or 'ffmpeg')


def require_tools():
    """Returns ((Image, ImageDraw, ImageFont), pillow_version, ffmpeg_path) or exits 3."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        from PIL import __version__ as pil_version
    except ImportError:
        Image = ImageDraw = ImageFont = pil_version = None
    ff = ffmpeg_path()
    problems = []
    if Image is None:
        problems.append('missing Pillow (install in a normal terminal: python3 -m pip install Pillow)')
    elif version_tuple(pil_version) < MIN_PILLOW:
        problems.append(f'Pillow {pil_version} is too old, need 10.1 or newer for sized fonts '
                        '(upgrade in a normal terminal: python3 -m pip install -U Pillow)')
    if ff is None:
        problems.append('missing ffmpeg (install in a normal terminal: brew install ffmpeg)')
    if problems or Image is None or ff is None:
        raise Fail(EXIT_SETUP, '; '.join(problems))
    return (Image, ImageDraw, ImageFont), pil_version, ff


MIN_PILLOW = (10, 1)                         # ImageFont.load_default(size=...) arrived in 10.1


def version_tuple(text):
    parts = []
    for piece in str(text).split('.')[:2]:
        digits = ''.join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


def cmd_check(_args):
    _pil, pil_version, ff = require_tools()
    return {'ok': True, 'python': sys.version.split()[0], 'pillow': pil_version, 'ffmpeg': ff}


def cmd_validate(args):
    scene = load_scene(args['scene'])
    return {'ok': True, 'keys': len(scene['keys']), 'seconds': round(scene['seconds'], 3),
            'fps': scene['fps'], 'frames': frame_count(scene)}


def frame_count(scene):
    return int(round(scene['seconds'] * scene['fps'])) + 1


def cmd_render(args):
    pil, _pil_version, ff = require_tools()
    scene = load_scene(args['scene'])
    formats = parse_formats(args.get('formats', 'mp4,gif'))
    name = output_name(args)
    out = output_dir(args)
    n = frame_count(scene)
    files = []
    # Encode into the temp dir and move into --out only after every format succeeded,
    # so a failure never leaves a partial or stale file behind.
    with tempfile.TemporaryDirectory(prefix='stickanim-') as tmp:
        for i in range(n):
            render_frame(pil, scene, i / scene['fps']).save(os.path.join(tmp, f'f{i:05d}.png'))
        src = ['-framerate', str(scene['fps']), '-i', os.path.join(tmp, 'f%05d.png')]
        jobs = {'mp4': ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18'],
                'gif': ['-vf', f'fps={min(scene["fps"], 15)},scale={min(scene["canvas"][0], 480)}:-1:flags=lanczos,'
                               'split[a][b];[a]palettegen[p];[b][p]paletteuse']}
        encoded = []
        for fmt in formats:
            staged = os.path.join(tmp, f'out.{fmt}')
            try:
                res = subprocess.run([ff, '-y', '-loglevel', 'error', *src, *jobs[fmt], staged],
                                     capture_output=True, text=True)
            except OSError as e:
                raise Fail(EXIT_RENDER, f'cannot run ffmpeg for {fmt}: {e.strerror}') from None
            if res.returncode != 0:
                raise Fail(EXIT_RENDER, f'ffmpeg failed for {fmt}: {res.stderr.strip()[-400:]}')
            encoded.append((staged, os.path.join(out, f'{name}.{fmt}')))
        try:
            for staged, target in encoded:
                shutil.move(staged, target)
                files.append(target)
        except OSError as e:
            for f in files:
                os.remove(f)
            raise Fail(EXIT_RENDER, f'cannot write into --out: {e.strerror}') from None
    return {'ok': True, 'files': files, 'frames': n, 'fps': scene['fps'],
            'seconds': round(scene['seconds'], 3)}


def output_name(args):
    name = args.get('name') or os.path.splitext(os.path.basename(args['scene']))[0]
    allowed = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-')
    if not name or set(name) - allowed or name.strip('.') == '':
        raise Fail(EXIT_INPUT, f'--name got {name!r}, expected a plain file name '
                               '(letters, digits, ".", "_", "-"; no folders)')
    return name


def parse_formats(value):
    formats = [f.strip() for f in value.split(',') if f.strip()]
    bad = [f for f in formats if f not in FORMATS]
    if bad or not formats:
        raise Fail(EXIT_INPUT, f'--formats got {value!r}, accepted: {", ".join(FORMATS)}')
    return formats


def output_dir(args):
    out = args.get('out')
    if not out:
        raise Fail(EXIT_INPUT, '--out <dir> is required')
    try:
        os.makedirs(out, exist_ok=True)
    except OSError as e:
        raise Fail(EXIT_INPUT, f'cannot create --out {out}: {e.strerror}') from None
    return out


def parse_args(argv):
    if not argv or argv[0] in ('-h', '--help', 'help'):
        return 'help', {}
    cmd = argv[0]
    if cmd not in COMMANDS:
        raise Fail(EXIT_INPUT, f'unknown command {cmd!r}, accepted: {", ".join(COMMANDS)}\n{USAGE}')
    args, rest = {}, argv[1:]
    while rest:
        tok = rest.pop(0)
        if tok.startswith('--'):
            if not rest:
                raise Fail(EXIT_INPUT, f'{tok} needs a value')
            args[tok[2:]] = rest.pop(0)
        elif 'scene' not in args:
            args['scene'] = tok
        else:
            raise Fail(EXIT_INPUT, f'unexpected argument {tok!r}\n{USAGE}')
    if cmd != 'check' and 'scene' not in args:
        raise Fail(EXIT_INPUT, f'{cmd} needs a <scene.json>\n{USAGE}')
    return cmd, args


def resolve_time(scene, at):
    if at is None:
        raise Fail(EXIT_INPUT, '--at <seconds|key:N> is required')
    if at.startswith('key:'):
        try:
            index = int(at[4:])
        except ValueError:
            index = -1
        if not 0 <= index < len(scene['keys']):
            raise Fail(EXIT_INPUT, f'--at got {at!r}, expected key:0 to key:{len(scene["keys"]) - 1}')
        return scene['keys'][index]['t'], index
    try:
        t = float(at)
    except ValueError:
        t = -1.0
    if not 0 <= t <= scene['seconds']:
        raise Fail(EXIT_INPUT, f'--at got {at!r}, expected seconds in [0, {scene["seconds"]:.3f}] or key:N')
    return t, None


def rounded(p):
    return [round(p[0], 3), round(p[1], 3)]


def cmd_joints(args):
    scene = load_scene(args['scene'])
    at = args.get('at')
    if at is not None and ',' in at:
        return {'ok': True, 'samples': [joints_report(scene, part.strip()) for part in at.split(',')]}
    return joints_report(scene, at)


def facing_at(a, b, t):
    return b['pose']['facing'] if t > a['t'] else a['pose']['facing']


def joints_report(scene, at):
    t, index = resolve_time(scene, at)
    joints, a, b = sample(scene, t)
    return {'ok': True, 't': round(t, 4), 'key': index, 'label': label_at(scene, t),
            'facing': 'right' if facing_at(a, b, t) > 0 else 'left',
            'joints': {k: rounded(v) for k, v in joints.items()},
            'contacts': {c: rounded(joints[j]) for c, j in CONTACTS.items()},
            'props': {k: rounded(v) for k, v in prop_positions(scene, t, joints).items()}}


KEY_CELL_W, KEYS_PER_PAGE, KEY_COLS = 320, 36, 6
ONION_CELL_W, MOVES_PER_PAGE, ONION_COLS, ONION_FRAMES = 640, 6, 3, 9
NOTE = (200, 30, 30)


def cell(pil, scene, t, width, caption):
    Image, ImageDraw, ImageFont = pil
    img = render_frame(pil, scene, t, caption=False)
    img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    ImageDraw.Draw(img).text((6, img.height - 22), caption, fill=NOTE, font=ImageFont.load_default(size=16))
    return img


def sheet(pil, cells, cols):
    Image = pil[0]
    w, h = cells[0].size
    rows = (len(cells) + cols - 1) // cols
    out = Image.new('RGB', (w * min(cols, len(cells)), h * rows), (255, 255, 255))
    for i, c in enumerate(cells):
        out.paste(c, ((i % cols) * w, (i // cols) * h))
    return out


def onion_cell(pil, scene, a, b):
    """All in-between frames of one move in one image: early frames faint, the last at full ink,
    darkest pixel wins, so the path and its direction show at once."""
    from PIL import ImageChops
    Image = pil[0]
    keys = scene['keys']
    def faded(k):
        t = keys[a]['t'] + (keys[b]['t'] - keys[a]['t']) * k / (ONION_FRAMES - 1)
        frame = cell(pil, scene, t, ONION_CELL_W, '')
        return Image.blend(frame, Image.new('RGB', frame.size, BG), 0.8 * (1 - k / (ONION_FRAMES - 1)))

    acc = faded(0)
    for k in range(1, ONION_FRAMES):
        acc = ImageChops.darker(acc, faded(k))
    pil[1].Draw(acc).text((6, acc.height - 22), f'move {a}->{b}', fill=NOTE, font=pil[2].load_default(size=16))
    return acc


def cmd_inspect(args):
    """Key-pose grid(s) and onion-skin pages for the agent to look at before rendering."""
    pil, _pil_version, _ff = require_tools()
    scene = load_scene(args['scene'])
    out = output_dir(args)
    keys = scene['keys']
    key_files = []
    pages = [range(i, min(i + KEYS_PER_PAGE, len(keys))) for i in range(0, len(keys), KEYS_PER_PAGE)]
    for p, page in enumerate(pages):
        cells = [cell(pil, scene, keys[i]['t'], KEY_CELL_W, f'#{i} {keys[i]["label"] or ""}'.strip())
                 for i in page]
        name = 'keys.png' if p == 0 else f'keys-{p + 1}.png'
        sheet(pil, cells, KEY_COLS).save(os.path.join(out, name))
        key_files.append(os.path.join(out, name))
    moves = [(i, i + 1) for i in range(len(keys) - 1) if keys[i + 1]['t'] - keys[i]['t'] > 1e-9]
    onion_files = []
    for start in range(0, len(moves), MOVES_PER_PAGE):
        group = moves[start:start + MOVES_PER_PAGE]
        name = f'onion-{group[0][0]}-{group[-1][1]}.png'
        sheet(pil, [onion_cell(pil, scene, a, b) for a, b in group], ONION_COLS).save(os.path.join(out, name))
        onion_files.append(os.path.join(out, name))
    return {'ok': True, 'keys': key_files, 'onion': onion_files}


HANDLERS = {'check': cmd_check, 'validate': cmd_validate, 'render': cmd_render, 'inspect': cmd_inspect,
            'joints': cmd_joints}


def main(argv):
    try:
        cmd, args = parse_args(argv)
        if cmd == 'help':
            sys.stdout.write(USAGE)
            return 0
        result = HANDLERS[cmd](args)
    except Fail as e:
        sys.stderr.write(f'stickanim: {e}\n')
        return e.code
    sys.stdout.write(json.dumps(result) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
