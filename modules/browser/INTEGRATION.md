# browser 模块 — 合并接入说明

> 上游文档：`README.md` / `DESIGN.md`（原样搬入）。本文只记并入后的改动点。

## 来源与范围

- 来源：`D:\项目\dsh-agent-browser`
- 已搬入：`lib/`（tsc 产物）、`src/`（TS 源码）、`client/`（设置页面板）、
  `skills/agent-browser/`、`scripts/`、`tsconfig.json`、README / DESIGN
- 未搬入：`node_modules`、`.tmp`、`bench/`、`tests/`、`_acl-recovery`
- 原 `cordis.patch.yml` → `source.cordis.patch.yml`

## 合并待办

1. **Host 形状是 Service 类**：`src/index.ts` 导出 `class AgentBrowserService extends
   TypertRemoteService`，`static inject=['tools']`，构造时 `super(ctx,'browser')`。
   组合根用 `ctx.plugin(AgentBrowserService, config.browser)` 挂载。
2. **client 常量改新包名**：`client/browser-remote.js` 的 `PACKAGE='dsh-agent-browser'`
   与 `client/config.js` 的 `ENTRY_CANDIDATES` 硬绑旧包名/patch 行 id，合并后要改成
   新包名；设置页 section id `browser`（order 22）保持不变。
3. **通信保持 Typert Remote**：`probe` / `checkJudgment` / `installCli` 三个
   `@Remote` 方法不动；client 侧手写 descriptor + `$mount` 的流程不动。
4. **judgment 依赖改为同包import**：现在只 `import type ... from 'dsh-judgment/contract'`
   并在运行时 `ctx.get('judgment')`；同包后 contract 类型直接从 `modules/judgement/lib/contract`
   取，运行时用组合根传入的实例。
5. **构建并入总流程**：`tsc -p tsconfig.json` 出 `lib/`，client 由合并脚本统一打 bundle。

## 外部前置

`agent-browser` CLI（锁 `[0.38.0,0.39.0)`，自动改用同目录原生二进制）、Chrome。
另外它的 `@deepseek-ai/dsh-*` peer 区间是 boot 闸门：不满足会导致整个 bundle 被跳过，
合并时需与实际 DSH 版本取交集。
