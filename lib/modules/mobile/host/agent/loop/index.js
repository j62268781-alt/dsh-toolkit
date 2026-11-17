/**
 * 「观察 → 生成候选 → 判定 → 执行 → 复核」的完整决策循环。
 *
 * 这套循环原本长在 browser 模块（`src/modules/browser/host/task/`）里，驱动 `agent-browser` CLI。
 * browser 模块整体删除后，循环本身与浏览器无关，因此连同候选/门控/判定/动作一起搬到了这里，
 * 引擎能力收敛在 `engine.ts` 的 `LoopEngine` 接口上（ego / DSH 内置浏览器 / mobilecli 都能实现）。
 *
 * **当前没有接线**：mobile 自己的 `mobile_loop`（`src/modules/mobile/host/agent/mobile-loop.ts`）
 * 仍在用，这份实现是给"在浏览器上跑同一套循环"准备的起点。
 *
 * 目录职责划分：
 * - `types.ts`      — 公共类型、阈值常量与交回提示契约
 * - `utils.ts`      — 纯工具函数（哈希、语义签名、快照 diff、键名/词元解析、截断）
 * - `candidates.ts` — 候选枚举、目标相关性排序与特殊动作面（悬停/拖拽/按键）注入
 * - `gates.ts`      — 确定性门控与字段状态匹配（状态守卫、URL/提交完成证据、次优候选概率门槛）
 * - `judge.ts`      — Jev 判断层协议（问题构造、调用封装、二阶段选值、独立确认）
 * - `actions.ts`    — 页面动作执行（fill/select/click/hover/drag/press）与页面等待
 * - `engine.ts`     — 引擎接缝（`LoopEngine` 接口 + 快照/错误类型）
 * - `extract.ts`    — 页面内一次抽取的脚本与解析（引擎 `evalScript` 跑它）
 * - `loop.ts`       — 有界决策主循环（`runTask`）与子目标编排（`runSubgoals`）
 */
export * from './engine.js';
export * from './types.js';
export * from './utils.js';
export * from './candidates.js';
export * from './gates.js';
export * from './judge.js';
export * from './actions.js';
export * from './loop.js';
//# sourceMappingURL=index.js.map