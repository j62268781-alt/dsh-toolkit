"""Compose the DeepSeek whale sprite sheet (8 columns x 9 rows, 96x104 cells)."""
import importlib.util
import pathlib
import sys

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('whale', str(pathlib.Path(__file__).with_name('whale.py')))
whale = importlib.util.module_from_spec(spec)
spec.loader.exec_module(whale)

fspec = importlib.util.spec_from_file_location('front', str(pathlib.Path(__file__).with_name('front.py')))
front = importlib.util.module_from_spec(fspec)
fspec.loader.exec_module(front)

W, H = whale.W, whale.H

# 正面视图负责静止与状态动作，左右移动仍用侧视（拖拽时能看出方向）。
ROWS = [
    # idle
    [front.front_frame(bob=b, eye_mode='closed' if b in (2,) else 'open') for b in (0, 1, 2, 2, 1, 0)],
    # runningRight
    [whale.frame(bob=b, flick=f, speed=s) for b, f, s in
     ((0, 0.0, 1), (0, 1.0, 2), (1, 0.5, 1), (1, 1.0, 2), (0, 0.0, 1), (0, 1.0, 2), (1, 0.5, 1), (1, 1.0, 2))],
    # runningLeft
    [whale.frame(bob=b, flick=f, speed=s, flip=True) for b, f, s in
     ((0, 0.0, 1), (0, 1.0, 2), (1, 0.5, 1), (1, 1.0, 2), (0, 0.0, 1), (0, 1.0, 2), (1, 0.5, 1), (1, 1.0, 2))],
    # waving
    [front.front_frame(bob=b, spout_stage=st, flap=fl) for b, st, fl in
     ((0, 0, 0), (1, 1, 1), (1, 2, 2), (0, 3, 1))],
    # jumping
    [front.front_frame(bob=b, spout_stage=st, flap=fl) for b, st, fl in
     ((-2, 3, 2), (-6, 3, 3), (-14, 2, 4), (-4, 1, 3), (2, 0, 1))],
    # failed
    [front.front_frame(bob=b, eye_mode='x', dim=True, mouth_sad=True) for b in (1, 1, 0, 1, 1, 0, 1, 1)],
    # waiting
    [front.front_frame(bob=b, eye_mode='look-up') for b in (0, 1, 0, 1, 0, 1)],
    # running
    [front.front_frame(bob=b, flap=fl) for b, fl in ((0, 0), (1, 1), (0, 2), (1, 1), (0, 0), (0, 1))],
    # review
    [front.front_frame(bob=b, eye_mode='look-up', spout_stage=st) for b, st in
     ((0, 0), (0, 1), (1, 0), (0, 1), (0, 0), (1, 1))],
]

sheet = np.zeros((H * len(ROWS), W * 8, 4), dtype=np.uint8)
for r, frames in enumerate(ROWS):
    assert len(frames) <= 8, (r, len(frames))
    for c, frame in enumerate(frames):
        sheet[r * H:(r + 1) * H, c * W:(c + 1) * W] = frame

out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/whale-sheet.png'
Image.fromarray(sheet, 'RGBA').save(out)
print('sheet', out, W * 8, 'x', H * len(ROWS))
