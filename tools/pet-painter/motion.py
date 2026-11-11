"""Render the DeepSeek whale animations as 60 fps animated WebP clips.

Why a second format: the sprite sheet is the Petdex contract (8 columns, one cell
per frame) and its frame delays come from Petdex (idle 280/110/110/140/140/320 ms),
i.e. about 5 fps with two long freezes — that is what makes the whale look jerky.
Qoder's own built-in pets ship 256x277 animated WebP at 30 fps (75 frames over 2.5 s),
so the island and the desktop pet play a WebP clip when one is registered for the
motion and fall back to the sprite sheet otherwise (third-party Petdex pets keep the
sheet).

Two levers make the motion smooth:

* 60 fps. Frames are 16/16/17 ms so the loop keeps its original length while fast
  motions (the jump, flippers) get twice the samples.
* The slow vertical breathing of the front-facing clips is **not** baked into the
  frames. A 2.4 px bob only has a handful of distinct positions at any sane scale,
  so baked frames can never step faster than ~10 positions per second — no matter how
  many fps. Instead the renderer animates the `#brand` layer with a CSS keyframe, which runs at
  the display refresh rate (60/120 Hz) and costs no bytes. `jumping` keeps its travel
  baked in because a jump is a real vertical move, not breathing.

Each clip is rendered at 3x (288x314) with NEAREST upscaling so the pixel art keeps
hard edges.

    python tools/pet-painter/motion.py <output-dir>
"""
import importlib.util
import math
import pathlib
import sys

import numpy as np
from PIL import Image

HERE = pathlib.Path(__file__).with_name


def _load(name):
    spec = importlib.util.spec_from_file_location(name, str(HERE(f'{name}.py')))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


whale = _load('whale')
front = _load('front')

W, H = whale.W, whale.H
SCALE = 3
FPS = 60
FRAME_MS = (16, 16, 17)
# 这些动作的上下位移是动作本身（跳跃/跑动），留在帧里；其余正面动作的呼吸位移交给 CSS。
BAKED_BOB = {'jumping', 'runningRight', 'runningLeft'}


def frames_for(milliseconds):
    return int(round(milliseconds * FPS / 1000))


def _upscale(frame, sub):
    """NEAREST-upscale one 1x frame and nudge it down by `sub` 3x pixels (sub-pixel bob)."""
    big = Image.fromarray(frame, 'RGBA').resize((W * SCALE, H * SCALE), Image.NEAREST)
    canvas = Image.new('RGBA', (W * SCALE, H * SCALE + SCALE - 1), (0, 0, 0, 0))
    canvas.paste(big, (0, sub), big)
    return canvas


def _quantise(bob):
    whole = math.floor(bob)
    return whole, int(round((bob - whole) * SCALE))


def _clip(images, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    # 像素画只有很少的颜色，无损压缩比有损小得多（整套 9 个动作约 110 KB）。
    durations = [FRAME_MS[index % len(FRAME_MS)] for index in range(len(images))]
    images[0].save(path, save_all=True, append_images=images[1:], duration=durations,
                   loop=0, lossless=True, method=6)
    return path


def idle(count=frames_for(2000)):
    eyes, subs = [], []
    for i in range(count):
        whole, sub = 0, 0
        blink = i in range(int(count * .93), int(count * .93) + frames_for(100))
        eyes.append(front.front_frame(bob=whole, eye_mode='closed' if blink else 'open'))
        subs.append(sub)
    return eyes, subs


def running(count=frames_for(2000)):
    eyes, subs = [], []
    for i in range(count):
        phase = 2 * math.pi * i / count
        whole, sub = 0, 0
        eyes.append(front.front_frame(bob=whole, flap=round(2 + 2 * math.sin(phase * 2))))
        subs.append(sub)
    return eyes, subs


def waiting(count=frames_for(2000)):
    eyes, subs = [], []
    for i in range(count):
        whole, sub = 0, 0
        eyes.append(front.front_frame(bob=whole, eye_mode='look-up'))
        subs.append(sub)
    return eyes, subs


def failed(count=frames_for(1800)):
    eyes, subs = [], []
    for i in range(count):
        whole, sub = 0, 0
        eyes.append(front.front_frame(bob=whole, eye_mode='x', dim=True, mouth_sad=True))
        subs.append(sub)
    return eyes, subs


def review(count=frames_for(2000)):
    eyes, subs = [], []
    for i in range(count):
        whole, sub = 0, 0
        eyes.append(front.front_frame(bob=whole, eye_mode='look-up', spout_stage=i * 4 // count % 4))
        subs.append(sub)
    return eyes, subs


def waving(count=frames_for(2000)):
    eyes, subs = [], []
    for i in range(count):
        phase = 2 * math.pi * i / count
        whole, sub = 0, 0
        eyes.append(front.front_frame(bob=whole, spout_stage=int((i * 4 // count) % 4), flap=round(2 + 2 * math.sin(phase))))
        subs.append(sub)
    return eyes, subs


def jumping(count=frames_for(792)):
    eyes, subs = [], []
    for i in range(count):
        whole, sub = _quantise(-11 + 11 * math.cos(2 * math.pi * i / count))
        eyes.append(front.front_frame(bob=whole, spout_stage=3 if whole < -2 else 1))
        subs.append(sub)
    return eyes, subs


def side(direction, count=frames_for(2000)):
    eyes, subs = [], []
    for i in range(count):
        phase = 2 * math.pi * i / count
        whole, sub = _quantise(0.8 - 0.8 * math.cos(phase))
        eyes.append(whale.frame(bob=whole, flick=0.5 + 0.5 * math.sin(phase), speed=1 + (i * 2 // count), flip=direction < 0))
        subs.append(sub)
    return eyes, subs


CLIPS = {
    'idle': idle,
    'running': running,
    'waiting': waiting,
    'failed': failed,
    'review': review,
    'waving': waving,
    'jumping': jumping,
    'runningRight': lambda count=frames_for(2000): side(1, count),
    'runningLeft': lambda count=frames_for(2000): side(-1, count),
}


def render(name, factory):
    eyes, subs = factory()
    return [_upscale(frame, sub) for frame, sub in zip(eyes, subs)]


def main():
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
    total = 0
    for name, factory in CLIPS.items():
        path = _clip(render(name, factory), out / f'{name}.webp')
        size = path.stat().st_size
        total += size
        print(f'{name:13s} {size:7d} B  {path}')
    print(f'total        {total:7d} B  at {W * SCALE}x{H * SCALE + SCALE - 1}, {FPS} fps, baked bob: {sorted(BAKED_BOB)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
