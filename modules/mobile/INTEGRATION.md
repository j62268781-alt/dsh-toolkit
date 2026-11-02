# mobile 模块 — 合并接入说明

> 上游文档见同目录 `README.md` / `CHANGELOG.md`（原样搬入，未改）。
> 本文只记「并入 dsh-toolkit 后要改什么」。

## 来源与搬迁范围

- 来源：`D:\项目\dsh-sidebar-mobile`
- 已搬入：`index.js`（Host）、`lib/`（已编译实现）、`src/client/`（面板源码）、
  `skills/mobilecli/`（随包技能）、`scripts/build-client.mjs`、README / CHANGELOG
- 未搬入：`node_modules`、`.github`、`test-harness.mjs`
- 原 `cordis.patch.yml` 存档为 `source.cordis.patch.yml`（合并后不再需要独立行）

## 合并待办

1. **路由注册改由 `core/http.js` 统一**：现在自己 `ctx.inject(['webServer'])` 后注册
   一条 `kind:"prefix"`（`lib/stream/routes.js`）；合并后前缀与 9 条分发保持不变，
   只换注册封装，鉴权（transport fence / same-origin / HMAC capability）照旧。
2. **mobileLoop 直接 import judgement**：现在是 `ctx.get('judgment')` + apiVersion
   探测（`lib/agent/mobile-loop.js` 起约 30 行）；同包后改为直接调用
   `JudgmentService`，但 `ask` 的 JSON 契约、概率阈值、风险过滤要保留。
3. **client 半边并入单 bundle**：现在是独立 `lib/client.js`（注册 id = 旧包名），
   构建期改写成合并 bundle 里的一个 factory；UI 标识 `sidebarRightTabs kind:"mobile"`
   与两个 slot 名保持不变。
4. **配置命名空间**：14 个配置键整体移到 `config.mobile` 下，键名不变。
5. **对外 URL 不改**：`/_dsh/dsh-sidebar-mobile` 保持原样，避免已开页面失效。

## 外部前置

- `mobilecli` 二进制：`MOBILECLI_PATH` → `PATH` → 包内平台包
- `adb`（Android）
- 同一 `mobilecli` daemon 同时只能服务一个 DSH 进程（已知边界）
