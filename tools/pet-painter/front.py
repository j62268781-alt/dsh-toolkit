"""Front-facing DeepSeek whale: symmetric body, two eyes, belly, both flippers.

The whale in the island is tiny, so the front view is drawn as one round body with the
face centred. Left/right motion still uses the side view from `whale.py`, so dragging the
pet keeps showing a direction.
"""
import importlib.util
import math
import pathlib
import sys

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('whale', str(pathlib.Path(__file__).with_name('whale.py')))
whale = importlib.util.module_from_spec(spec)
spec.loader.exec_module(whale)

W, H = whale.W, whale.H
XX, YY = whale.XX, whale.YY

BODY = whale.BODY
BELLY = whale.BELLY
FIN = whale.FIN
EYE_WHITE = whale.EYE_WHITE
PUPIL = whale.PUPIL
BLUSH = whale.BLUSH
MOUTH = whale.MOUTH
SHADOW = whale.SHADOW
SPOUT = whale.SPOUT
SPOUT_SOFT = whale.SPOUT_SOFT

CX = 48.0
YC = 62.0
# 瞳孔在眼白内的最大偏移（眼白半宽 8.6、瞳孔半宽 4.0，留出余量）。
GAZE_RADIUS = 4.0


def body_mask(yc=YC):
    def paint(d):
        d.ellipse((CX - 34, yc - 30, CX + 34, yc + 30), fill=255)
        d.ellipse((CX - 30, yc - 32, CX + 30, yc + 4), fill=255)
    return whale.mask_from_draw(paint)


def flipper_masks(yc=YC, flap=0):
    """两侧胸鳍可独立抬起；标量仍支持同时拍鳍。"""
    left_flap, right_flap = flap if isinstance(flap, tuple) else (flap, flap)

    def left(d):
        d.polygon([(CX - 33, yc + 6 - left_flap), (CX - 43, yc + 18 - left_flap * 2),
                   (CX - 24, yc + 24 - left_flap)], fill=255)

    def right(d):
        d.polygon([(CX + 33, yc + 6 - right_flap), (CX + 43, yc + 18 - right_flap * 2),
                   (CX + 24, yc + 24 - right_flap)], fill=255)
    return whale.mask_from_draw(left) | whale.mask_from_draw(right)


def eye(img, cx, cy, mode, gaze=None):
    if mode == 'closed':
        img[int(cy) - 1:int(cy) + 1, int(cx) - 5:int(cx) + 6] = PUPIL
        return
    if mode == 'x':
        for i in range(7):
            for px, py in ((int(cx) - 4 + i, int(cy) - 4 + i), (int(cx) + 4 - i, int(cy) - 4 + i)):
                img[py, px] = PUPIL
        return
    # 视线：瞳孔沿 16 个方向（0 = 正上，顺时针每 22.5° 一档）偏移，眼白保持居中。
    gx = gy = 0.0
    if gaze is not None:
        angle = (gaze % 16) * (math.pi / 8.0)
        gx, gy = math.sin(angle) * GAZE_RADIUS, -math.cos(angle) * GAZE_RADIUS
    whale.oval(img, cx, cy, 8.6, 9.0, EYE_WHITE)
    dy = -2 if mode == 'look-up' else 0
    whale.oval(img, cx + gx, cy + dy + gy, 4.0, 4.2, PUPIL)
    whale.oval(img, cx + gx - 1.4, cy - 1.7 + dy + gy, 1.2, 1.2, EYE_WHITE)


def smile(img, cx, cy, sad=False):
    pts = ((0, 0), (1, 1), (2, 1), (3, 1), (4, 0)) if not sad else ((0, 1), (1, 0), (2, 0), (3, 0), (4, 1))
    for dx, dy in pts:
        img[int(cy) + dy, int(cx) + dx] = MOUTH


def spout(img, x, y, stage=0):
    whale.draw_spout(img, x, y, stage)


def shadow(img, cx, cy, rx=24, ry=4):
    whale.shadow(img, cx, cy, rx, ry)


def question_mark(img, x=65, y=23):
    """Tiny punctuation sprite that stays legible beside the whale at desktop size."""
    points = ((1, 0), (2, 0), (3, 1), (3, 2), (2, 3), (2, 4), (2, 6), (2, 7))
    for dx, dy in points:
        img[y + dy, x + dx] = SPOUT
    img[y + 10, x + 2] = SPOUT


def front_frame(*, bob=0, eye_mode='open', spout_stage=None, flap=0,
                dim=False, flip=False, mouth_sad=False, gaze=None, question=False):
    img = np.zeros((H, W, 4), dtype=np.uint8)
    yc = YC + bob
    shadow(img, CX, 99)
    body = body_mask(yc)
    fins = flipper_masks(yc, flap)
    img[body | fins] = BODY
    img[fins & ~body] = FIN
    # 肚皮：底部一块椭圆浅色，上缘是向上拱的弧
    belly = body & (((XX - CX) / 30.0) ** 2 + ((YY - (yc + 30)) / 30.0) ** 2 <= 1.0)
    img[belly] = BELLY
    eye(img, CX - 14, yc - 14, eye_mode, gaze)
    eye(img, CX + 14, yc - 14, eye_mode, gaze)
    whale.draw_blush(img, CX - 27, yc + 2)
    whale.draw_blush(img, CX + 27, yc + 2)
    smile(img, CX - 2, yc - 4, mouth_sad)
    if spout_stage is not None:
        spout(img, CX, yc - 34, spout_stage)
    if question:
        question_mark(img)
    if dim:
        img[:, :, 3] = (img[:, :, 3].astype(np.float32) * 0.92).astype(np.uint8)
    if flip:
        img = np.fliplr(img)
    return img


if __name__ == '__main__':
    samples = [front_frame(), front_frame(bob=1), front_frame(bob=2, eye_mode='closed'),
               front_frame(eye_mode='x', mouth_sad=True, dim=True),
               front_frame(eye_mode='look-up', flap=3), front_frame(spout_stage=2),
               front_frame(bob=-6, spout_stage=3, flap=2), front_frame(flap=4),
               *[front_frame(gaze=g) for g in (0, 2, 4, 6)],
               *[front_frame(gaze=g) for g in (8, 10, 12, 14)]]
    sheet = np.zeros((H * 4, W * 4, 4), dtype=np.uint8)
    for i, f in enumerate(samples):
        r, c = divmod(i, 4)
        sheet[r * H:(r + 1) * H, c * W:(c + 1) * W] = f
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/whale-front.png'
    Image.fromarray(sheet, 'RGBA').resize((W * 4 * 3, H * 4 * 3), Image.NEAREST).save(out)
    print('ok', out)
