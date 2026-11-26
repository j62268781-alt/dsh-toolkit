# 内置形象授权说明

`aoi-shark-maid/` 是内置的「DeepSeek酱」形象，素材取自 Petdex 社区同一 slug 的公开包
（1536×2288，8 列 × 11 行，每格 192×208 的 WebP 精灵表，原文件未做任何改动），投稿者
`lakeofsky347`。Petdex 包的 `pet.json` 没有 license 字段，所以下面按角色形象的上游权利链标注。

## 形象的权利链

```
上善无形 / 上善（原始鲸鱼娘形象）
  └─ ZipZipPipe（加入 DeepSeek 元素与女仆装，明确声明 CC BY-NC-SA 4.0）
       ├─ lmy414/ai-chan-sheets    设定图补全、三视图整理
       └─ Photonico/AI_characters  Q 版、视图、提示词记录
```

- 作者版权声明（2026-09-12，明确形象遵守 CC BY-NC-SA 4.0、不可任何形式商业化）：
  https://www.bilibili.com/opus/1247156596114456581
- 作品简介《大AI和小AI们》：https://www.bilibili.com/video/BV1tE9XBbErS/
- 出处核查（社区整理，含未采用内容与理由）：
  https://github.com/bloodarea/dsh-pets/blob/main/assets/characters/deepseek/ATTRIBUTION.md

## 许可与边界

该素材以 **CC BY-NC-SA 4.0**（署名—非商业性使用—相同方式共享 4.0 国际）使用：

- **署名**：保留上善无形、ZipZipPipe 以及本仓库对素材的改动说明（见下）。
- **非商业**：本项目不做商业化分发。要把这个形象用于商业用途，必须另行取得权利人授权，
  不能沿用本仓库或 MIT 的许可。
- **相同方式共享**：对本目录素材的改编（包括未来由分层稿烘焙出的动作片段）继续以
  CC BY-NC-SA 4.0 提供。

许可全文：https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.zh-hans

仓库根目录的 MIT 只覆盖代码，**不覆盖** `pets/` 下的美术素材。

## 本仓库对素材的改动

目前只有两处，都不涉及重新绘制：

1. 原样复制 Petdex 的 `pet.json` 与 `spritesheet.webp`（字节未改）；
2. 运行时的播放方式调整（动作行映射、帧节奏）属于代码，不改变素材本身。

若后续用社区分层稿烘焙 60 fps 动作片段，会在本文件补上「基于哪份分层稿、做了哪些变换」的记录。

## 移除方法

删除整个 `aoi-shark-maid/` 目录，并同时在 `src/modules/pet/host/index.ts` 的 `PET_IDS`
里去掉这个 id。

## 历史

原先内置的 `deepseek-whale`（由仓库里的程序画笔 `tools/pet-painter/whale.py`、`front.py`、
`sheet.py` 生成，清单声明 CC0-1.0，额外带 `motion/` 下 11 个 60 fps 动作 WebP）已按用户要求移除。

CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/