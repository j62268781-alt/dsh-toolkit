# 内置形象授权说明

`aoi-shark-maid/` 是内置的「DeepSeek酱」形象，素材取自 Petdex 社区同一 slug 的公开包
（1536×2288，8 列 × 11 行，每格 192×208 的 WebP 精灵表），投稿者
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

- 沿用 Petdex 的精灵表布局，在 `pet.json` 登记单独的工作动画 `motion/running.webp`。
- 「小工作台」以原来的侧身姿势为底，重绘坐姿、手臂和表情，加入木桌、软垫凳和显示器。工作片段按 4.8 秒循环播放看屏幕、打字和托腮；精灵表从上往下第 8 行的 6 格使用同一张静态工作姿势，供减少动态效果或片段未加载时使用。
- 工作台新增等批准的抬手姿势（`motion/approval.webp`）和等回答的歪头托腮姿势（`motion/question.webp`）。两个动画都只播一次；第 7 行末尾原本未用的两格存放各自的结束姿势，用于静态回退。
- 精灵表第 10–11 行中偏矮的转头帧以脚底为锚点等比放大，与正面待机帧统一可见高度和脚底基线。

若后续用社区分层稿烘焙 60 fps 动作片段，会在本文件补上「基于哪份分层稿、做了哪些变换」的记录。

## 移除方法

删除整个 `aoi-shark-maid/` 目录，并同时在 `src/modules/pet/host/index.ts` 的 `PET_IDS`
里去掉这个 id。

## 历史

原先内置的 `deepseek-whale`（由仓库里的程序画笔 `tools/pet-painter/whale.py`、`front.py`、
`sheet.py` 生成，清单声明 CC0-1.0，额外带 `motion/` 下 11 个 60 fps 动作 WebP）已按用户要求移除。

CC0 1.0 Universal: https://creativecommons.org/publicdomain/zero/1.0/