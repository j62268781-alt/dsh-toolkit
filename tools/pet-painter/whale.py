"""DeepSeek whale pet painter (flat pixel style matching the other built-ins)."""
import sys
import numpy as np
from PIL import Image, ImageDraw

W, H = 96, 104

BODY = (28, 94, 255, 255)
BODY_SHADE = (16, 72, 214, 255)
BRAND = (28, 94, 255, 255)
BELLY = (232, 240, 255, 255)
FIN = (18, 68, 206, 255)
EYE_WHITE = (255, 255, 255, 255)
PUPIL = (14, 22, 50, 255)
BLUSH = (255, 172, 200, 190)
MOUTH = (255, 143, 170, 255)
SPOUT = (150, 219, 255, 255)
SPOUT_SOFT = (196, 233, 255, 255)
SHADOW = (46, 64, 150, 55)

YY, XX = np.mgrid[0:H, 0:W]
YC = 66.0


def mask_from_draw(paint):
    img = Image.new('L', (W, H), 0)
    paint(ImageDraw.Draw(img))
    return np.array(img) > 0


def oval(img, cx, cy, rx, ry, fill):
    img[((XX - cx) / rx) ** 2 + ((YY - cy) / ry) ** 2 <= 1.0] = fill


def body_mask(yc=YC):
    def paint(d):
        d.ellipse((10, yc - 32, 80, yc + 30), fill=255)   # 身体
        d.ellipse((16, yc - 34, 62, yc + 10), fill=255)   # 头顶更圆
    return mask_from_draw(paint)


def tail_mask(yc=YC, flick=0.0):
    """鲸尾：与身体相连的一片扇鳍，外缘挖出 V 形缺口分成两瓣。"""
    lift = flick * 6
    def paint(d):
        pts = [(60, yc - 8), (74, yc - 40 - lift), (90, yc - 40 - lift),
               (88, yc - 26 - lift), (84, yc - 20 - lift), (90, yc - 6 - lift),
               (80, yc + 4), (60, yc + 6)]
        d.polygon(pts, fill=255)
    return mask_from_draw(paint)


def shade(img, mask):
    img[mask] = BODY


def draw_flipper(img, cx, cy, lift=0):
    """胸鳍只画在身体轮廓里，避免探出去像贴片。"""
    mask = mask_from_draw(lambda d: d.ellipse(
        (cx, cy - lift, cx + 18, cy + 12 - lift), fill=255))
    img[mask] = BODY_SHADE


def draw_eye(img, cx, cy, mode='open'):
    if mode == 'closed':
        img[int(cy) - 1:int(cy) + 1, int(cx) - 5:int(cx) + 6] = PUPIL
        return
    if mode == 'x':
        for i in range(7):
            for px, py in ((int(cx) - 4 + i, int(cy) - 4 + i), (int(cx) + 4 - i, int(cy) - 4 + i)):
                img[py, px] = PUPIL
        return
    oval(img, cx, cy, 8.6, 9.0, EYE_WHITE)
    dy = -2 if mode == 'look-up' else 0
    oval(img, cx, cy + dy, 4.0, 4.2, PUPIL)
    oval(img, cx - 1.4, cy - 1.7 + dy, 1.2, 1.2, EYE_WHITE)


def draw_blush(img, cx, cy, wide=4.4):
    img[((XX - cx) / wide) ** 2 + ((YY - cy) / 2.6) ** 2 <= 1.0] = BLUSH


def draw_mouth(img, cx, cy, sad=False):
    if sad:
        pts = [(60, yc - 8), (74, yc - 40 - lift), (90, yc - 40 - lift),
               (88, yc - 26 - lift), (84, yc - 20 - lift), (90, yc - 6 - lift),
               (80, yc + 4), (60, yc + 6)]
        for dx, dy in pts:
            img[int(cy) + dy, int(cx) + dx] = MOUTH
        return
    for dx, dy in ((0, 0), (1, 1), (2, 1), (3, 1), (4, 0)):
        img[int(cy) + dy, int(cx) + dx] = MOUTH


def draw_spout(img, x, y, stage=0):
    for i, (dx, dy, r) in enumerate(((0, 0, 2.4), (-3, -6, 2.2), (3, -11, 2.2), (-1, -17, 3.0))):
        if i > stage:
            break
        oval(img, x + dx, y + dy, r, r, SPOUT if i % 2 == 0 else SPOUT_SOFT)


def draw_speed(img, x, y, phase):
    for i in range(3):
        length = 6 if i != 1 else 10
        off = (phase * 3 + i * 5) % 20
        x0, y0 = int(x - off), int(y + i * 8)
        if 0 <= x0 < W:
            img[max(0, y0):y0 + 2, x0:min(W, x0 + length)] = SPOUT


def shadow(img, cx, cy, rx=24, ry=4):
    img[((XX - cx) / rx) ** 2 + ((YY - cy) / ry) ** 2 <= 1.0] = SHADOW


def frame(*, bob=0, flick=0.0, eye='open', flipper_lift=0, spout=None,
          speed=None, dim=False, flip=False, mouth_sad=False):
    img = np.zeros((H, W, 4), dtype=np.uint8)
    yc = YC + bob
    shadow(img, 46, 99)
    body = body_mask(yc)
    tail = tail_mask(yc, flick)
    both = body | tail
    shade(img, both)
    # 肚皮：下半部一大块浅色，左上角随身体弧度
    belly = body & (YY > yc + 6 + 16.0 * ((XX - 44.0) / 44.0) ** 2)
    img[belly] = BELLY
    draw_eye(img, 28, yc - 12, eye)
    draw_blush(img, 21, yc + 3)
    if spout is not None:
        draw_spout(img, 44, yc - 38, spout)
    if speed is not None:
        draw_speed(img, 10, yc - 18, speed)
    if dim:
        img[:, :, 3] = (img[:, :, 3].astype(np.float32) * 0.92).astype(np.uint8)
    if flip:
        img = np.fliplr(img)
    return img


if __name__ == '__main__':
    samples = [frame(), frame(bob=1), frame(bob=2, eye='closed'), frame(eye='x', mouth_sad=True, dim=True),
               frame(eye='look-up', flipper_lift=8, spout=1), frame(flip=True, speed=2, flick=0.5),
               frame(spout=3), frame(flick=1.0)]
    sheet = np.zeros((H * 2, W * 4, 4), dtype=np.uint8)
    for i, f in enumerate(samples):
        r, c = divmod(i, 4)
        sheet[r * H:(r + 1) * H, c * W:(c + 1) * W] = f
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/whale4-preview.png'
    Image.fromarray(sheet, 'RGBA').resize((W * 4 * 3, H * 2 * 3), Image.NEAREST).save(out)
    print('ok', out)
