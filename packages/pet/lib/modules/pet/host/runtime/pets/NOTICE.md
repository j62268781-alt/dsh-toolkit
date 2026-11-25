# 内置形象授权说明

`aoi-shark-maid/` 是内置的「DeepSeek酱」形象，素材取自 Petdex 社区同一 slug 的公开包
（1536×2288，8 列 × 11 行，每格 192×208 的 WebP 精灵表，原文件未做任何改动）。

该形象由社区作者投稿，`pet.json` 没有声明 license 字段，上游也没有提供可核对的授权条文。
把它随插件打包，是应仓库维护者的要求（用它替换原先内置的程序绘制鲸鱼）；对外分发这个包之前
需要先确认上游授权。要去掉它，删除整个 `aoi-shark-maid/` 目录，并同时在
`src/modules/pet/host/index.ts` 的 `PET_IDS` 里去掉这个 id。

原先内置的 `deepseek-whale`（由仓库里的程序画笔 `tools/pet-painter/whale.py`、`front.py`、
`sheet.py` 生成，清单声明 CC0-1.0，额外带 `motion/` 下 11 个 60 fps 动作 WebP）已按用户要求移除。

CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/