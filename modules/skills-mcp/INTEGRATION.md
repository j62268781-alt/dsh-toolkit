# skills-mcp 模块 — 合并接入说明

> 上游文档：`UPSTREAM-README.md`（原 README 改名保留）。本文只记并入后的改动点。

## 来源与范围

- 来源：`D:\项目\dsh-skills-mcp-manager`
- 已搬入：`dist/`（tsc 产物）、`src/`（源码，38 文件 352KB）、`lib/`（client 产物与
  `lib/src/` 源码树）、`scripts/`、`esbuild.config.mjs`、`tsconfig.json`、`icon.svg`
- 未搬入：`.preview`（11.5MB）、`docs/images`（1MB）、`test/`、`node_modules`
- 原 `cordis.patch.yml` → `source.cordis.patch.yml`

## 合并待办

1. **双份产物二选一**：`src/` --tsc--> `dist/`；`main` 指 dist、`dsh.client` 指
   `lib/client.js`。合并后统一「跑 dist」，`src/` 只作为构建输入。
2. **`lib/src/*` 的反向 import 必须先解**：它们 `import '../../src/identity.js'`、
   `'../../src/mcp/connection.js'`、`'../../src/mcp/oauth/channel.js'`，跨树相对路径。
   搬迁后要么把这几处改成从 `dist/` 取，要么保留 `lib/src` 与 `src` 的相对位置。
3. **8 条路由改由 `core/http.js` 注册**：前缀 `/dsh-skills-mcp-manager` 不变，端点
   (`/runtime` `/rows` `/reconnect` `/skills` `/skill` `/oauth` `/oauth/callback` `/import`)、
   `ctx.connection.requestRejection` 同源守卫、body 限额、zod 校验全部保留。
4. **client 并入单 bundle**：设置页 section id `skills-mcp`（order 20）不变；
   `lib/src/styles/panel.css` 继续在构建期内联。
5. **身份常量**：`src/identity.js` 的 `NAME` 决定路由前缀与凭据目录
   `<DSH_HOME>/dsh-skills-mcp-manager/oauth/`；合并后**保持原值**，避免已有 OAuth
   凭据与书签失效（包名变了，但这些是数据面标识）。
6. **配置**：`Config` 只有 `toolFilters`（volatile dict），移到 `config.skillsMcp` 下。
