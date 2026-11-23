# 模块分层与产物边界（AGENTS.md §4–§6 细则）

> 从 AGENTS.md 拆出，内容不变；改这类约定时先改这里，再看 AGENTS.md 的摘要要不要同步。

## 4. 仓库结构与产物边界

```
src/modules/<module>/{host,client}/  ← 唯一源码位置（boot theme archived judgment mobile
                                       skills-mcp notification pet hooks remote git）
src/host/                            ← 跨模块 host 公共层
src/client/                          ← 跨模块 client 公共层（含 ui/components）
packages/<module>/                   ← 每个模块的独立包（index.js + package.json + lib/）
lib/                                 ← 聚合包的构建产物
cordis.patch.yml                     ← 根补丁：insert 列表，插入十一个模块 id
scripts/ tests/ docs/ .cache(gitignored)
```

- **不要手改 `lib/`、`packages/*/lib/`**：运行产物由 `pnpm build` 生成并随源码提交。
  项目不保留 `.map` 文件；构建不生成、打包不包含源映射。
- 改名 / 搬文件后若残留旧产物，`build-host` / `build-packages` 会抛
  `Unexpected generated host file: ...; remove the stale output explicitly` —— 手工删掉
  `lib/modules/<m>/host/<旧文件>.js` 与 `packages/<m>/lib/modules/<m>/host/<旧文件>.js` 再构建。
- `lib/client.js` 里 CSS 被写成单行模板串，大段格式 diff 属正常，不要「修回去」。

---

## 5. 固定目录结构（核心约定）

一句话：**按「谁 import 它」分层，不按「技术上它是什么」分层。**

| 层 | 位置 | 判据 |
| --- | --- | --- |
| L1 跨模块公共 | `src/host/*.ts`、`src/client/**` | **≥2 个模块**在用，且有测试 |
| L2 模块私有 | `src/modules/<m>/{host,client}/**` | 只服务本模块 |
| L3 功能文件 | L2 内部按下面槽位摆放 | 见下 |

**晋升规则**：先在模块内长出来 → 出现第二个消费者才上提到 L1 → 同一个 commit 里搬走测试。
禁止预先在 L1 建空壳，禁止把「以后可能有用」的东西放 L1。

### 5.1 host 槽位

```
src/modules/<module>/host/
  index.ts        # 只装配：name / inject / apply，≤120 行
  config.ts       # schemastery Schema；没有可配项就不建
  constants.ts    # 无 import 的纯常量（路由路径、命名空间）；client 也会 import
  routes/<组>.ts  # 协议适配：req → 域调用 → [status, payload]
  <domain>/       # 领域 + 纯 I/O（files.ts / store.ts / client.ts / pool.ts），不碰 req/res
  service.ts      # 可选：单例服务 + dispose
```

- 路由骨架统一走 `src/host/routes.ts` 的 `registerJsonRoutes` + `jsonRoute`，**不要**手写 method 守卫 /
  body 上限 / no-store / 错误映射。
- 领域层返回**域结果**（`{ok:true,…}` / `{ok:false,…}`），HTTP 状态码映射留在 `routes/`。
- 失败用**稳定的数字业务 `code`**，只通过码表引用（`DELETION_CODE.sessionBusy`），不写字面量 `4104`：
  `1xxx` 已完成、`4xxx` 这次请求或当前状态不允许（重试 / 刷新 / 等会话闲下来可能变）、`5xxx` 环境坏了
  （重试无用，要人处理）。需要原文时另给 `detail`；**不要把文案塞进 code，也不要让 client 靠
  `reason.startsWith(...)` 反推状态**。`code` 与 HTTP 的 `statusCode` 各管一件事，`routes/` 用一张
  `Record<code, status>` 映射，不要在 payload 里把 code 改写成另一个 code。码表放在该模块的
  `host/constants.ts`（client 也会求值它，所以那里不能有 Node 依赖），client 由自己的 `constants.ts` 转出。
- 禁止出现 `.tsx`、`document`、`window`、React。
- `inject` 数组顺序被测试断言（例：`tests/integration/archived-deletion.test.mjs:107`），改动要同步测试。

### 5.2 client 槽位

一个模块可以有**多个** UI 挂载面，所以 client 不是「一个 index + 一个 section」。

```
src/modules/<module>/client/
  index.ts           # 只装配；apply 里全是 ctx.effect(installer, label)
  constants.ts       # re-export host 的纯常量（不要复制）
  locale.ts          # 本模块字典 {NS, COPY}
  model.ts           # 纯投影 / 派生状态：可单测、不 import react
  state/<name>.ts    # 可订阅状态机（createStore），跨 surface 共享
  surfaces/<挂载点>/  # 一个 slot 一个入口：index.tsx (+ style.css)
  components/<name>/ # 本模块私有可复用组件：index.tsx + style.css 成对
  dom/<name>.ts      # 与宿主 DOM 打交道的胶水（不改 React 树）
```

`surfaces/<挂载点>/index.tsx` 导出三样：

```ts
export const NAME = 'settings'                 // 目录名，也用作 effect label
export { default as css } from './style.css'   // 需要时把样式文本交给 index.ts 拼全局样式
export function install(ctx, host) { /* installSlot(...) */ return off }
```

`client/index.ts` 的形态（archived 是范例）：

```ts
const host = { removal: createRemoval(ctx), archiveConfirm: createArchiveConfirm() }
ctx.effect(() => installStylesheet(composeStyles(settingsStyles('sk'), settingsCss, deleteButtonCss), 'dsh-toolkit-archived'), 'dsh-toolkit-archived:stylesheet')
for (const surface of SURFACES) ctx.effect(() => surface.install(ctx, host), `dsh-toolkit-archived:${surface.NAME}`)
```

### 5.3 这段代码该放哪儿

| 形态 | 归属 |
| --- | --- |
| 两个以上模块都要用的算法 / 常量 | `src/host/<name>.ts` 或 `src/client/<name>.ts` |
| 只给一个 slot 用的界面 | `modules/<m>/client/surfaces/<slot>/` |
| 有自己样式的可复用控件 | `modules/<m>/client/components/<name>/`（≥2 模块用 → `src/client/ui/components/`） |
| 纯逻辑无 JSX（投影 / 状态机 / 校验） | `model.ts` / `state/` / `domain/`，必须能脱离 React 单测 |
| 改宿主 DOM 但不渲染 UI（隐藏行、量尺寸） | `dom/*.ts`，安装器 + disposer |
| 与宿主 API 打交道的胶水 | `src/client/ui/*.ts`（bridge） |

### 5.4 明确禁止

- ❌ 按技术层分目录（`repository/`、`service/`、`utils/`、`helpers/`）—— 同名东西可能是协议、可能是领域、
  可能是常量，命名先于职责就会互相污染。用 5.3 的判据。
- ❌ 桶文件（`ui/index.ts` 全量 re-export）：毁掉依赖方向与 tree-shaking。
- ❌ `client/**` import `node:*`，或 import host 下除 `constants.ts` 之外的任何文件。
- ❌ `host/**` import `client/**`。
- ❌ 同一个能力两份实现（历史教训：`browser/client/primitives.js` 与 `judgment/client/primitives.js`
  曾逐字重复，现在统一走 `src/client/ui/primitives.ts`；`browser` 模块随后整体删除，教训不变）。

---

## 6. 公共层现状（L1 有什么，别再重复造）

**`src/host/`**

| 文件 | 职责 |
| --- | --- |
| `routes.ts` | `registerRoute` / `registerAuthenticatedRoute` / `jsonRoute` / `registerJsonRoutes` / `HttpFailure`；全仓唯一 `ctx.webServer.register` 调用点 |
| `paths.ts` | `PLUGIN_API_ROOT = '/api/plugins/toolkit'` + `pluginApiPath(module)`；**路由前缀的唯一来源**（无 Node 依赖，client 也会求值） |
| `dsh-home.ts` | `dshHome(env = process.env, home = homedir())`；**`$DSH_HOME` 的唯一解析点**（`DSH_HOME` 非空即用、两端裁空白，否则 `~/.dsh`；每次调用重读环境）。带 `node:os`/`node:path`，只能 host 用 |
| `http.ts` | `readBody`（按**字节**限流）、`readCharBody`（按**解码字符**限流，超限静默 destroy）、`sendJson` |
| `config.ts` | 根 Config 聚合（十一个模块的 `Config` 拼成宿主配置表单） |
| `serial.ts` / `singleflight.ts` / `operation.ts` | 队列、去重、超时与取消 |
| `process.ts` / `executable.ts` | `runProcess`（deadline、输出上限）；`findExecutableOnPath`（只认原生映像）/ `findCommandOnPath`（Windows 连 `.cmd`/`.bat` 一起认）/ `resolveSpawnTarget`（把 shim 翻成 `cmd.exe /d /s /c`） |
| `plugins.ts` / `migration.ts` / `time.ts` | 插件配置助手、补丁迁移、时钟 |

**`src/client/`**

| 文件 | 职责 |
| --- | --- |
| `index.ts` | 唯一 client 聚合入口，`ctx.plugin({name:'dsh-toolkit-<m>-client'})` 顺序有意义 |
| `http.ts` | `fetchJson`：懒解析、空体 `{}`、非 JSON 抛带 `status` 的错误 |
| `poll.ts` / `latest-task.ts` | 轮询、丢弃迟到响应 |
| `config.ts` / `config-write.ts` | 配置作用域（`scopeForm` / `findScopedForm`）、写入确认 |
| `ui/primitives.ts` | **唯一** `@deepseek-ai/dsh-client-ui-primitives` 取用点（拿不到时给 `{}` 降级） |
| `ui/slot.ts` / `ui/store.ts` / `ui/locale.ts` | `installSlot` / `createStore`+`useStore` / `installDictionary` |
| `ui/stylesheet.ts` | `installStylesheet` / `installMutableStylesheet` / `composeStyles` |
| `ui/components/<name>/` | 跨模块组件，`index.tsx` + `style.css` 成对 |
| `ui/components/confirm-dialog/` | 公用确认弹窗外壳：宿主 `Modal` + 标题/说明/`children`/页脚；确认按钮默认宿主黑色 `primary`，危险操作用 `confirmButton` 换成模块自己的按钮（archived ×2、judgment、skills-mcp 在用） |
| `styles/settings.*` | 面板骨架样式与 `settingsStyles('sk')` |

---

