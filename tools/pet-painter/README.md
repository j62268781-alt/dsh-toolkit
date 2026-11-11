# Pet painter

Procedural painter for the built-in `deepseek-whale` pet. `whale.py` draws the side view,
`front.py` the front view (used for every idle/status row), `sheet.py` mixes both into
one sprite sheet. Everything here is plain
Pillow + numpy drawing code; no external artwork is downloaded or copied.

```bash
PY=/Users/joeson/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3
"$PY" tools/pet-painter/whale.py /tmp/whale-preview.png        # 8 个代表帧的放大预览
"$PY" tools/pet-painter/front.py /tmp/whale-front.png          # 正面视图与 16 方向视线的预览
"$PY" tools/pet-painter/sheet.py src/modules/pet/host/runtime/pets/deepseek-whale/spritesheet.png
"$PY" tools/pet-painter/motion.py src/modules/pet/host/runtime/pets/deepseek-whale/motion
# -> 11 个动作各一个 60 fps 动画 WebP，合计约 95 KB，耗时约 2 秒
```

`sheet.py` writes the animation grid the runtime expects: 8 columns × 11 rows of
96×104 cells (row order idle, runningRight, runningLeft, waving, jumping, failed,
waiting, running, review, then two rows of 16 gaze frames). The gaze rows are the v2
convention: row `9 + dir // 8`, column `dir % 8`, direction 0 pointing up and turning
clockwise in 22.5° steps. Frame durations live in
`src/modules/pet/host/runtime/renderer.js` (`animations`), not in the sheet.

Each helper in `whale.py` (`body_mask`, `tail_mask`, `draw_eye`, `draw_blush`,
`draw_spout`, `draw_speed`, `shadow`, `frame`) works on one 96×104 cell, so tuning a
shape means editing the mask polygons and re-running `sheet.py`.

`motion.py` renders the drawings as separate animated WebP clips for idle, swimming, waiting, approvals, questions and other actions instead of a sprite sheet. Swimming alternates the two front flippers; waiting sweeps the eyes side to side and blinks; approval lifts one flipper at a time with a spout; question combines a broader gaze sweep, brief spout pulses and a small cyan question mark. A generator check enforces minimum encoded frame counts for the state clips so identical-frame merging cannot silently make waiting static again:
96×104 cells are upscaled 3× with nearest-neighbour to 288×314 and every clip runs at
60 fps (16/16/17 ms frames), so fast motions get twice the samples while each loop keeps
its original length. The slow breathing of the front-facing clips is deliberately **not**
baked into the frames — at any sane scale a 2.4 px bob only has a dozen distinct
positions, so baked frames can never step faster than ~10 positions per second no matter
how many fps. The renderer instead animates the `#brand` layer with a CSS keyframe, which
runs at the display refresh rate (60/120 Hz) and costs no bytes; only the jump and the
side-view running keep their vertical travel in the frames. Pixel art has very few
colours, so `lossless=True` is both smaller and sharper than a lossy encode (whole set
≈ 95 KB versus ≈ 500 KB at quality 70). Pillow merges identical consecutive frames and
sums their durations, so the loop length is preserved. The clip files are declared per
motion in `pets/deepseek-whale/pet.json` under `animations`.
