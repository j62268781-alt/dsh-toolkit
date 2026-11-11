# Pet painter

Procedural painter for the built-in `deepseek-whale` pet. `whale.py` draws the side view,
`front.py` the front view (used for every idle/status row), `sheet.py` mixes both into
one sprite sheet. Everything here is plain
Pillow + numpy drawing code; no external artwork is downloaded or copied.

```bash
PY=/Users/joeson/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3
"$PY" tools/pet-painter/whale.py /tmp/whale-preview.png        # 8 个代表帧的放大预览
"$PY" tools/pet-painter/front.py /tmp/whale-front.png          # 正面视图的 8 帧预览
"$PY" tools/pet-painter/sheet.py src/modules/pet/host/runtime/pets/deepseek-whale/spritesheet.png
```

`sheet.py` writes the animation grid the runtime expects: 8 columns × 9 rows of
96×104 cells (row order idle, runningRight, runningLeft, waving, jumping, failed,
waiting, running, review). Frame durations live in
`src/modules/pet/host/runtime/renderer.js` (`animations`), not in the sheet.

Each helper in `whale.py` (`body_mask`, `tail_mask`, `draw_eye`, `draw_blush`,
`draw_spout`, `draw_speed`, `shadow`, `frame`) works on one 96×104 cell, so tuning a
shape means editing the mask polygons and re-running `sheet.py`.
