# AGENTS.md

在本仓库里工作的 AI 代理 / 协作者的约定。**先读这一页再动手。**

新增一个模块请照 [docs/new-module-sop.md](docs/new-module-sop.md) 走。

---

## 0. Windows 上必须用 PowerShell 7（`pwsh`）

| 命令 | 实际执行 | 结论 |
| --- | --- | --- |
| `pwsh` | `C:\Program Files\PowerShell\7\pwsh.exe` | **用这个** |
| `powershell` | `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe` | 5.1，不要用来跑构建或处理文本 |

两个不同的可执行文件，`powershell` 永远不会变成 7。5.1 的坑：无 BOM UTF-8 被当 ANSI 读（中文变乱码）、
`-Encoding UTF8` 会写 BOM、不支持 `&&`。agent 的 shell 工具已经是 7；需要 `.ps1` 时写 `pwsh -File x.ps1`。

- 改源码/文档用编辑工具，**不要** `Set-Content` 重定向；必须用 shell 读时 `Get-Content -Raw -Encoding utf8`。
- 命令输出含中文时先 `[Console]::OutputEncoding = [Text.Encoding]::UTF8`。
- 复杂引号嵌套不要硬拼：写 `.cache/*.mjs` 再 `node` 执行（`.cache/` 已 gitignore）。
- `.gitattributes` 强制 `eol=lf`，不要引入 CRLF（会让 `build:check` 报产物不同步）。
- **大文件不要读进上下文**：`src/client/ui/components/dsh-logo/index.ts` 是单行 base64（约 58K 字符），
  要用 `[IO.File]::WriteAllText` + 字符串 replace。

---

## 1. 环境与工具链

Node ≥ 20（实测 v24.21.0）、pnpm 11.28.5（`packageManager` 锁定）、全仓库 ESM、
`typescript ^5.7`（host 类型检查）+ `esbuild 0.28`（client 与测试打包）。依赖装到 `.cache/pnpm-store`。

---

## 2. 语言：新代码一律 `.ts` / `.tsx`

### 2.1 两个「资产」例外

不是模块源码，而是**被当文本读出来**的浏览器脚本，必须保持 `.js`：

- `src/modules/boot/host/boot.js` —— `boot/index.ts` 的 `read("boot.js")` 注入预览页；
- `src/modules/pet/host/runtime/renderer.js` —— `renderer.html` 的 `<script src>` 加载，测试用 `eval()` 执行。

**不要改名、不要转 TS、不要 import 它们、不要在里面写任何 TS 语法**（注解/`as` 都会让 `eval` 抛 SyntaxError）。
要补类型只能放在宿主侧的 `*.d.ts` 或调用方。

### 2.2 import 说明符保持 `.js` / `.jsx`

```ts
import { installSlot } from '../../../client/ui/slot.js'   // ✅
import { installSlot } from '../../../client/ui/slot.ts'   // ❌
```

esbuild 会把 `./x.js` 解析到 `x.ts`、`./x.jsx` 到 `x.tsx`；node:test 侧由 `scripts/jsx-hooks.mjs` 的
`resolve` 兜底。所以「改名不用改 importer」，反过来也别写 `.ts` 后缀。

### 2.3 类型检查分三档：host 严、client 宽、emit 最松

| 档 | 配置 | 命令 | 口径 |
| --- | --- | --- | --- |
| host strict | `tsconfig.json` | `pnpm typecheck` | 整个 host 树零容忍 |
| client | `tsconfig.client.json` | `pnpm typecheck:client` | `.ts/.tsx` 走 `strict:false` + DOM lib，只要 0 诊断 |
| emit | `tsconfig.build.json` | `pnpm typecheck:modules` | `scripts/build-host.mjs` 的 emit 程序 |

**为什么 strict 不能按目录白名单豁免**：`src/index.ts` import 了十个模块的 host 插件，`src/host/config.ts`
又 import 了八个模块的 `Config`。tsc 的 `include` 只决定入口，被 import 的文件一律进程序 —— 「只 include
已毕业的模块」等于没有限制。所以 strict 覆盖 `src/index.ts` + `src/host/**/*.ts` + `src/modules/*/host/**/*.ts`。

- **client 侧走 `tsconfig.client.json`**：`lib` 加了 DOM，`types` 加了 `react`，`jsx: "react-jsx"`（只为类型检查；
  真正 emit 仍是 esbuild 的 `__dshReact.createElement` 工厂）。它**故意不开 strict**：十个模块的 UI 从来没被
  类型检查过，先立「能跑通的门」，再谈收紧；不开 strict 不代表可以乱写 `any`。
- client 侧的运行期全局（`__CLIENT_CSS__`）与资源模块（`*.css` 的 text loader）声明在
  `src/client/env.d.ts`、`src/client/assets.d.ts`；新增同类全局必须补在那里，别在每个文件里 `declare`。
- `TS1xxx` 语法错误会让整个程序的语义诊断消失 —— 看到「0 错误」先确认没有 `error TS1`。

---

## 3. 常用脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 构建 Host、Client 与十个独立模块包 |
| `pnpm build:check` | 只校验产物是否最新（不写文件） |
| `pnpm typecheck` / `pnpm typecheck:modules` | strict / loose 两档 tsc |
| `pnpm typecheck:client` | client 侧 tsc（`tsconfig.client.json`，见 §2.3） |
| `pnpm check` | 模块 / 包契约检查（client bundle 断言 + 未定义名字检查） |
| `pnpm test` | `tests/<group>/*.test.mjs`（node:test） |
| `pnpm verify` | build → typecheck → typecheck:client → check → test → build:check |

**最低验证线**：`pnpm build` + `pnpm check` + 相关测试；改了 `.ts`/`.tsx` 还要跑 `pnpm typecheck` 与
`pnpm typecheck:client`（分别对应 host 与 client 两个程序，漏一个就漏掉半个仓库）；交付前 `pnpm verify`。

---

## 4. 仓库结构与产物边界

```
src/modules/<module>/{host,client}/  ← 唯一源码位置（boot theme archived browser judgment
                                       mobile skills-mcp notification pet remote）
src/host/                            ← 跨模块 host 公共层
src/client/                          ← 跨模块 client 公共层（含 ui/components）
packages/<module>/                   ← 每个模块的独立包（index.js + package.json + lib/）
lib/                                 ← 聚合包的构建产物
cordis.patch.yml                     ← 根补丁：insert 列表，插入十个模块 id
scripts/ tests/ docs/ .cache(gitignored)
```

- **不要手改 `lib/`、`packages/*/lib/`**：它们是 `pnpm build` 的产物，但**被 git 跟踪**，
  所以改完源码必须重新构建并一起提交。
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
  曾逐字重复，现在统一走 `src/client/ui/primitives.ts`）。

---

## 6. 公共层现状（L1 有什么，别再重复造）

**`src/host/`**

| 文件 | 职责 |
| --- | --- |
| `routes.ts` | `registerRoute` / `registerAuthenticatedRoute` / `jsonRoute` / `registerJsonRoutes` / `HttpFailure`；全仓唯一 `ctx.webServer.register` 调用点 |
| `paths.ts` | `PLUGIN_API_ROOT = '/api/plugins/toolkit'` + `pluginApiPath(module)`；**路由前缀的唯一来源**（无 Node 依赖，client 也会求值） |
| `dsh-home.ts` | `dshHome(env = process.env, home = homedir())`；**`$DSH_HOME` 的唯一解析点**（`DSH_HOME` 非空即用、两端裁空白，否则 `~/.dsh`；每次调用重读环境）。带 `node:os`/`node:path`，只能 host 用 |
| `http.ts` | `readBody`（按**字节**限流）、`readCharBody`（按**解码字符**限流，超限静默 destroy）、`sendJson` |
| `config.ts` | 根 Config 聚合（十个模块的 `Config` 拼成宿主配置表单） |
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

## 7. 代码风格

- Client 侧（`src/**/client/**`）双引号 + 分号 + 2 空格；`scripts/`、`tests/` 单引号 + 无分号。
- 注释解释**为什么**（尤其绕过宿主实现细节的地方），不要复述代码在做什么。
- 新增 DOM 副作用一律「安装器函数 + 返回 disposer」。
- 接口用 `interface` / `type` 写在实现之前；宿主上下文类型不确定时用显式 `any`，
  **不要** `// @ts-ignore` / `@ts-expect-error`，也不要关 strict 绕过。

---

## 8. CSS：注入方式与主题护栏

判定规则只有一条 —— **样式要覆盖到的节点是否在面板 React 子树之外**：

| 场景 | 方式 | 现有模块 |
| --- | --- | --- |
| 面板外还有 DOM：`shell.overlay` 弹层、侧栏菜单项 | `apply()` 里 `installStylesheet` | theme、archived、notification |
| 只服务 `settings.section` 面板自身 | 组件内 `<style>{CSS}</style>` | browser、judgment、mobile、skills-mcp |
| 同上但历史上用全局注入 | 保留，别再新增 | boot、pet |

- 全局注入点必须留一行注释说明「为什么不能挪进面板」（宿主用 `createPortal` 渲染在面板子树外）。
- `installStylesheet` 写 `data-plugin` / `data-plugin-css`，正是宿主的 `claimStyles()` / `removeOwnedStyles()`
  回收约定；改它之前先读宿主那两段实现。
- 模块的 `surfaces/*/style.css` 与 `components/*/style.css` 由 `index.ts` 用 `composeStyles` 拼成**一个**
  `<style>`，不要每个 surface 各插一个。

**主题 CSS 护栏**（`src/modules/theme/client/styles/` 的 `tokens.css` / `layout.css` / `sidebar.css` / `rightbar.css`）：

1. 每条规则的每个选择器都必须以 `html[data-sk-palette="codex"]` 开头（有测试强制）；
2. 全局 `@keyframes` 只允许 `cx-` 前缀；
3. 选择器要带足够上下文 —— 宿主类名是 hash 变体，只能 `[class*="_xxx"]` 子串匹配，越宽越容易误伤
   （踩过：`_label` 规则把 tooltip 裁成 1×1）；
4. **画圆必须显式 `corner-shape: round`**：宿主注入 `@supports (corner-shape:superellipse(1.5))`，
   任何 `border-radius:50%` 都会被画成超椭圆。

---

## 9. 路由与 HTTP 约定

- 前缀一律 `/api/plugins/toolkit/<module>/…`，由 `src/host/paths.ts` 的 `pluginApiPath()` 派生；
  **不要在 client 里手写路径字符串**。唯一允许覆盖的是 mobile 的 `config.routePrefix`。
- 注册走 `src/host/routes.ts`；`registerAuthenticatedRoute` 在 handler 前跑
  `ctx.connection.requestRejection(req)`，**身份拒绝先于读 body**（测试断言 `req` 没有 data 监听）。
- `jsonRoute` 的 spec：

  ```ts
  { path, kind?: 'exact'|'prefix', method?: 'POST'|'GET', limit?: number, auth?: boolean,
    pick?(body): unknown, check?(value): boolean, reason?: string,
    run(ctx, value): [number, unknown] | Promise<[number, unknown]> }
  ```

  它负责：`cache-control: no-store` → method 不符 404 `{ok:false,reason:'not-found'}` → 读 body 并
  `JSON.parse`（坏 JSON → 400 `bad-json`）→ `pick` / `check`（false → 400 `reason`）→ `run` 抛错 →
  `asHttpFailure(error)` 折算成状态码与 `{ok:false,reason}`。
- **失败只有一个通道**：域层要表达「这次请求不允许」就 `throw httpFailure(400, '请求体不是合法 JSON')`，
  不要再 `Object.assign(new Error(msg), { statusCode: 400 })`（历史上 remote 手搓了 3 处，现已统一）。
  `asHttpFailure(error, fallback)` 认三种输入：`HttpFailure` 实例 → 用它自己的 `status`/`reason`；
  带 `statusCode` 的老式错误 → 用该码（兼容既有测试对 `error.statusCode` 的断言）；其余 → `fallback` + `message`。
  `HttpFailure` 同时暴露 `.status` 与 `.statusCode`（后者是兼容别名，新代码只用 `.status`）。
- `limit` 只管「多大算超限」，**业务上限（比如批量条数）写在 `check()` 或域层**，不要在 `routes/` 里
  手写第二套长度判断。
- **`limit` 的单位是解码字符**（`readCharBody`），不是字节：8192 个中文字符必须被接受，
  8193 个必须 `req.destroy()` 且**永不响应**。
- 只有「浏览器顶跳回来、不该要宿主身份」的回调才用 `auth:false`（现状：OAuth 回调，靠 `state` 保护）。
- webServer 不存在时要能降级：`ctx.inject(['webServer','connection'], ...)`。

---

## 10. 测试

- `tests/<group>/*.test.mjs`，runner 是 `node:test`，DOM 用 `jsdom`（`pretendToBeVisual: true`）。
- 测试 import 源码时写 `.js` / `.jsx`（`jsx-hooks` 负责解析到 `.ts` / `.tsx`）；但**把路径当字符串**用的地方
  （esbuild `entryPoints`、`readFileSync`、`loadClientEntry`）必须写真实扩展名。
- 断言要抓真问题：状态映射 / 降级路径 / 卸载清理 / 迟到响应，而不是只跑通 happy path。
- **已知的本机失败**（Windows，不要误判为回归）：`tests/pet/service.test.mjs:75` 断言
  `assetDir.startsWith('/')`。`assetDir` 是**真实文件系统绝对路径**（`D:\…`），被
  `pet/host/runtime/core.cjs` 的 `pet-asset://` 协议用 `path.isAbsolute()` 校验后再 `assetJoin()`
  拼路径；强行补前导 `/` 会让 `path.join('/pets/x','a.webp')` 变成 `\pets\x\a.webp`（当前盘根相对），
  helper 反而读不到图。这条断言是 POSIX-only，不要为了让它变绿去改源码。
- `tests/judgment/ledger.test.mjs` 的「并发 ask 原子占用配额」在全量并行下偶发失败，单跑稳定通过 ——
  先复跑该文件再判断是否回归。

---

## 11. 视觉/样式改动怎么验证

```powershell
# 1) 生成还原 DSH DOM 的页面（抽 .cache/bundles 的真实 CSS + 源码 CSS）
node .cache/x/build2.mjs demo-available.html available windows
# 2) 截图（& 抓不到 stdout，必须 Start-Process 重定向）
Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList @("--headless=new","--disable-gpu","--hide-scrollbars",
    "--force-device-scale-factor=2","--window-size=1280,900","--virtual-time-budget=1200",
    "--screenshot=D:\项目\dsh-toolkit\.cache\x\shot.png",
    "file:///D:/项目/dsh-toolkit/.cache/x/demo-available.html") -Wait -NoNewWindow
```

- 需要真实 `:hover` 时用 CDP 派发 `Input.dispatchMouseEvent`（`.cache/x/hover.mjs`），不要加假类名。
- 图片裁切/拼接用外置 Python：`D:\DeepSeekHarness-home\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`。

---

## 12. 本机 DSH 环境

- `DSH_HOME=D:\DeepSeekHarness-home`，profile 是桌面端 `desktop`。
- 本仓库以 `link:` 装进 profile：`dsh.profile.bundles` 加 `dsh-toolkit`，`dependencies` 加
  `"dsh-toolkit": "link:D:/项目/dsh-toolkit"`，然后在 profile 目录用桌面端自带 pnpm 安装：

  ```powershell
  $env:CI="true"
  node "D:\软件\deepseek\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.mjs" install --no-frozen-lockfile
  ```

- **不要**用 `dsh plugin --profile desktop`：桌面端 profile 由桌面应用管理。
- 生效方式：只改 client → `pnpm build` 后按 **Ctrl+R**；改 host（含 `cordis.patch.yml`、`src/index.ts`）→
  **重启 DSH 桌面端**（bundles 只在进程启动时读一次）。重启会中断当前会话回合，由用户操作。
- 安装前备份 profile 的 `package.json` / `cordis.patch.yml` / `pnpm-lock.yaml`。
- 反查宿主实现：`D:\软件\deepseek\resources\app.asar` 用 `u32[4]=headerSize`、`base=8+headerSize` 解包。

---

## 13. 交付习惯

- 中文回答；结论先行，再给证据（命令输出、实测数值、截图）。
- 样式改动给**修前/修后**对照，不要只说「改好了」。
- 声称「已修复」之前真的跑过 `pnpm build`、`pnpm check`、相关测试；产物没构建等于没改。
- 交付时写清：改了什么文件、为什么这么改、用户需要做什么（刷新 / 重启 / 重装）。

---

## 14. 提交必须分批

1. **按「一件事」切分**：一个 commit 只回答一个「为什么改」。
2. **构建产物跟随源码**：`lib/**`、`packages/*/lib/**` 与产生它们的 `src/` 改动同一个 commit。
3. **测试跟随被测代码**：改动的 `tests/**` 跟实现同 commit。
4. **提交前逐条 `git status`**：按功能分组，确认每组自成一体；有疑问就 `git add -p`，不要 `git add -A`。
5. **commit message 用 `type(scope): 中文短句`**（`feat` / `fix` / `docs` / `refactor` / `chore`），
   scope 取模块名。
6. **推送前工作区要干净**：`git status --porcelain` 为空（或只剩明确不入库的文件）。
