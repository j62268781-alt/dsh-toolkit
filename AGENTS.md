# AGENTS.md

这一页是**索引 + 硬约束**（每次会话都会整篇注入，所以只留「不知道就会做错」的东西）。
细则在 `docs/agent/*.md`，动那一类东西之前先读对应的那篇；新增一个模块请照
[docs/new-module-sop.md](docs/new-module-sop.md) 走。

---

## 开工前：先看技能

非平凡任务动手前先扫一眼**每轮注入的技能 catalog**（来源于项目 `.agents/skills/`、全局
`~/.agents/skills/`，以及运行环境自带的那几个）；每个技能都带一句 `description`。
**能用技能就用技能**，不要凭记忆现写流程。

- **命中就用 `skill` 工具加载，不要用 `read` 去翻 `SKILL.md`**：那样只拿到正文，拿不到技能声明的
  工具与步骤（本仓库踩过「翻了 66 次 SKILL.md、一次没调用 `skill`」）。
- **按 `description` 判断是否命中**：触发条件出现就加载，一个任务可以先后加载多个；不确定时先加载
  最接近的那个，读完它的流程再动手，不要猜实现。
- **不要为了用而用**：没有技能命中就直接做，判断标准只有一条 —— 描述里的触发条件是否真的出现。
- **技能依赖的 MCP 不在本会话时**（子代理里常见：它继承父会话的 composition，不按自身 cwd 重新评估
  MCP 的路径 scope）：照样加载技能、按它的判定标准执行，但用 `grep` / `read` 做等价步骤，并明确告诉
  用户「本会话没有 X MCP，改用源码检索」；不要假装走过图谱，也不要因为缺工具就跳过分析或放弃。

本机的技能目录位置、各技能依赖哪些 MCP：见 `AGENTS.local.md`。

---

## 0. Windows 上必须用 PowerShell 7（`pwsh`）

| 命令 | 实际执行 | 结论 |
| --- | --- | --- |
| `pwsh` | `C:\Program Files\PowerShell\7\pwsh.exe` | **用这个** |
| `powershell` | `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe` | 5.1，不要用来跑构建或处理文本 |

- 改源码/文档用编辑工具，**不要** `Set-Content` 重定向；必须用 shell 读时 `Get-Content -Raw -Encoding utf8`。
- 命令输出含中文时先 `[Console]::OutputEncoding = [Text.Encoding]::UTF8`。
- 复杂引号嵌套不要硬拼：写 `.cache/*.mjs` 再 `node` 执行（`.cache/` 已 gitignore）。
- `.gitattributes` 强制 `eol=lf`，不要引入 CRLF（会让 `build:check` 报产物不同步）。
- **大文件不要读进上下文**：`src/client/ui/components/dsh-logo/index.ts` 是单行 base64（约 58K 字符）。

---

## 1. 环境与工具链

Node ≥ 20（实测 v24.21.0）、pnpm 11.28.5（`packageManager` 锁定）、全仓库 ESM、
`typescript ^5.7`（host 类型检查）+ `esbuild 0.28`（client 与测试打包）。依赖装到 `.cache/pnpm-store`。

---

## 2. 语言：新代码一律 `.ts` / `.tsx`

### 2.1 两个「资产」例外（保持 `.js`，不要改 TS、不要 import、不要写 TS 语法）

- `src/modules/boot/host/boot.js` —— 被 `read("boot.js")` 当文本注入预览页；
- `src/modules/pet/host/runtime/renderer.js` —— 被 `<script src>` 加载、测试用 `eval()` 执行。

### 2.2 import 说明符保持 `.js` / `.jsx`

esbuild 把 `./x.js` 解析到 `x.ts`；node:test 侧由 `scripts/jsx-hooks.mjs` 兜底。所以改名不用改 importer，
反过来也别写 `.ts` 后缀。

### 2.3 类型检查分三档：host 严、client 宽、emit 最松

| 档 | 配置 | 命令 | 口径 |
| --- | --- | --- | --- |
| host strict | `tsconfig.json` | `pnpm typecheck` | 整个 host 树零容忍 |
| client | `tsconfig.client.json` | `pnpm typecheck:client` | `strict:false` + DOM lib，只要 0 诊断 |
| emit | `tsconfig.build.json` | `pnpm typecheck:modules` | `scripts/build-host.mjs` 的 emit 程序 |

strict 覆盖 `src/index.ts` + `src/host/**/*.ts` + `src/modules/*/host/**/*.ts`；`include` 只决定入口，
被 import 的文件一律进程序 —— 所以「只给已毕业模块开 strict」是做不到的。
client 侧运行期全局（`__CLIENT_CSS__`）与资源模块声明在 `src/client/env.d.ts`、`src/client/assets.d.ts`。
`TS1xxx` 语法错误会让整程序的语义诊断消失 —— 看到「0 错误」先确认没有 `error TS1`。

---

## 3. 常用脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm build` | 构建 Host、Client 与十二个独立模块包 |
| `pnpm build:check` | 只校验产物是否最新（不写文件） |
| `pnpm typecheck` / `pnpm typecheck:modules` | strict / loose 两档 tsc |
| `pnpm typecheck:client` | client 侧 tsc（见 §2.3） |
| `pnpm check` | 模块 / 包契约检查（client bundle 断言 + 未定义名字检查） |
| `pnpm test` | 非 jsdom 的 `tests/<group>/*.test.mjs`（node:test，**默认串行**、堆 1GB、单文件 RSS 1.5GB；`DSH_TEST_CONCURRENCY` / `DSH_TEST_HEAP_MB` / `DSH_TEST_RSS_MB` 可调） |
| `pnpm test:ui` | 只跑 jsdom/UI 文件（约 30 个），同样串行 + RSS 上限；真交互优先走 §10.1 |
| `pnpm verify` | build → typecheck → typecheck:client → check → test → build:check |

**最低验证线**：`pnpm build` + `pnpm check` + 相关测试；改了 `.ts`/`.tsx` 还要跑 `pnpm typecheck` 与
`pnpm typecheck:client`（host 与 client 是两个程序，漏一个就漏半个仓库）；交付前 `pnpm verify`。

---

## 4. 仓库结构与产物边界

```
src/modules/<module>/{host,client}/  ← 唯一源码位置（archived boot git hooks judgment mobile
                                       task-monitor notification pet remote skills-mcp theme）
src/host/   src/client/              ← 跨模块公共层
packages/<module>/                   ← 每个模块的独立包（index.js + package.json + lib/）
lib/                                 ← 聚合包的构建产物
cordis.patch.yml                     ← 根补丁：insert 列表，插入十二个模块 id
scripts/  tests/  docs/  docs/agent/  .cache(gitignored)
```

- **不要手改 `lib/`、`packages/*/lib/`**：它们是 `pnpm build` 的产物，但**被 git 跟踪**，
  改完源码必须重新构建并一起提交。
- 改名 / 搬文件后残留的旧产物会让 `build-host` / `build-packages` 抛
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
| L3 功能文件 | L2 内部按下面槽位摆放 | 见 5.1 / 5.2 |

**晋升规则**：先在模块内长出来 → 出现第二个消费者才上提到 L1 → 同一个 commit 里搬走测试。
禁止预先在 L1 建空壳，禁止把「以后可能有用」的东西放 L1。

### 5.1 host 槽位

`index.ts`（只装配 name / inject / apply，≤120 行）· `config.ts`（schemastery，无配项就不建）·
`constants.ts`（无 import 的纯常量，client 也会 import）· `routes/<组>.ts`（协议适配）·
`<domain>/`（领域 + 纯 I/O，不碰 req/res）· `service.ts`（可选：单例 + dispose）。

- 路由骨架统一走 `src/host/routes.ts` 的 `registerJsonRoutes` + `jsonRoute`，**不要**手写 method 守卫 /
  body 上限 / no-store / 错误映射（细节见 §9）。
- 领域层返回**域结果**（`{ok:true,…}` / `{ok:false,…}`），HTTP 状态码映射留在 `routes/`。
- 失败用**稳定的数字业务 `code`**，只通过码表引用（`DELETION_CODE.sessionBusy`），不写字面量 `4104`：
  `1xxx` 已完成、`4xxx` 这次请求或当前状态不允许（重试 / 刷新 / 等会话闲下来可能变）、`5xxx` 环境坏了
  （重试无用，要人处理）。需要原文时另给 `detail`；**不要把文案塞进 code，也不要让 client 靠
  `reason.startsWith(...)` 反推状态**。码表放 `host/constants.ts`（client 也会求值，不能有 Node 依赖）。
- 禁止出现 `.tsx`、`document`、`window`、React。`inject` 数组顺序被测试断言
  （例：`tests/integration/archived-deletion.test.mjs:107`），改动要同步测试。

### 5.2 client 槽位

一个模块可以有**多个** UI 挂载面，所以 client 不是「一个 index + 一个 section」：

`index.ts`（只做 `ctx.effect(...)` 装配）· `constants.ts`（re-export host 的纯常量，不要复制）·
`locale.ts`（本模块字典）· `model.ts`（纯投影 / 派生状态，可单测、不 import react）·
`state/<name>.ts`（`createStore`，跨 surface 共享）· `surfaces/<挂载点>/`（一个 slot 一个入口，index.tsx
+ style.css）· `components/<name>/`（本模块私有可复用组件，index.tsx + style.css 成对）·
`dom/<name>.ts`（与宿主 DOM 打交道的胶水，不改 React 树）。

`surfaces/<挂载点>/index.tsx` 导出 `NAME`（目录名，兼作 effect label）、可选 `css`、`install(ctx, host)`
（返回 off）。`client/index.ts` 只做 `ctx.effect(...)` 装配，样式用 `composeStyles` 拼成**一个** `<style>`。
完整示例与 L1 清单见 [docs/agent/layout.md](docs/agent/layout.md)。

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

- ❌ 按技术层分目录（`repository/`、`service/`、`utils/`、`helpers/`）—— 命名先于职责就会互相污染。
- ❌ 桶文件（`ui/index.ts` 全量 re-export）：毁掉依赖方向与 tree-shaking。
- ❌ `client/**` import `node:*`，或 import host 下除 `constants.ts` 之外的任何文件。
- ❌ `host/**` import `client/**`。
- ❌ 同一个能力两份实现（历史教训见 `docs/agent/layout.md`）。

---

## 6. 公共层现状（L1 有什么，别再重复造）

- `src/host/`：`routes.ts`（全仓唯一 `ctx.webServer.register` 点）· `paths.ts`（路由前缀唯一来源）·
  `dsh-home.ts`（`$DSH_HOME` 唯一解析点）· `http.ts`（按字节/字符限流读体）· `config.ts`（根 Config 聚合）·
  `serial` / `singleflight` / `operation` · `process` / `executable` · `plugins` / `migration` / `time`。
- `src/client/`：`index.ts`（唯一聚合入口）· `http.ts`（`fetchJson`）· `poll` / `latest-task` ·
  `config` / `config-write` · `ui/primitives.ts`（**唯一** primitives 取用点）· `ui/slot` / `ui/store` /
  `ui/locale` · `ui/stylesheet` · `ui/components/*`（含公用 `confirm-dialog`）· `styles/settings.*`。
- 每项的签名与用途见 [docs/agent/layout.md](docs/agent/layout.md) §6。

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
| 只服务 `settings.section` 面板自身 | 组件内 `<style>{CSS}</style>` | judgment、mobile、skills-mcp |
| 同上但历史上用全局注入 | 保留，别再新增 | boot、pet |

**主题 CSS 护栏**（`src/modules/theme/client/styles/`，有测试强制）：

1. 每条规则的每个选择器都必须以 `html[data-sk-palette="codex"]` 开头；
2. 全局 `@keyframes` 只允许 `cx-` 前缀；
3. 选择器要带足够上下文（宿主类名是 hash 变体，只能 `[class*="_xxx"]` 子串匹配，越宽越容易误伤）；
4. **画圆必须显式 `corner-shape: round`**：宿主注入 `@supports (corner-shape:superellipse(1.5))`，
   任何 `border-radius:50%` 都会被画成超椭圆。

全局注入点必须留一行注释说明「为什么不能挪进面板」（宿主用 `createPortal` 渲染在面板子树外）；
`installStylesheet` 写的 `data-plugin` / `data-plugin-css` 是宿主 `claimStyles()` / `removeOwnedStyles()`
的回收约定。细节见 [docs/agent/client.md](docs/agent/client.md)。

---

## 9. 路由与 HTTP 约定

- 前缀一律 `/api/plugins/toolkit/<module>/…`，由 `src/host/paths.ts` 的 `pluginApiPath()` 派生；
  **不要在 client 里手写路径字符串**。唯一允许覆盖的是 mobile 的 `config.routePrefix`。
- 注册走 `src/host/routes.ts`；`registerAuthenticatedRoute` 在 handler 前跑
  `ctx.connection.requestRejection(req)`，**身份拒绝先于读 body**。
- **失败只有一个通道**：`throw httpFailure(status, reason)`；不要再
  `Object.assign(new Error(msg), { statusCode })`。`HttpFailure` 同时暴露 `.status` 与 `.statusCode`
  （后者是兼容别名，新代码只用 `.status`）。
- `limit` 的单位是**解码字符**（`readCharBody`）：8192 个中文字符必须被接受，8193 个必须
  `req.destroy()` 且**永不响应**。业务上限（批量条数）写在 `check()` 或域层，不要在这里写第二套判断。
- 只有「浏览器顶跳回来、不该要宿主身份」的回调（OAuth，靠 `state`）和浏览器自己取的静态脚本
  （Service Worker 的 `sw.js`）才用 `auth:false`；后者必须只回固定文本、不读请求体、显式写
  `service-worker-allowed`，并在测试里断言「`connection.requestRejection` 一次都没被调」。
- webServer 不存在时要能降级：`ctx.inject(['webServer','connection'], ...)`。

`jsonRoute` 的 spec、状态码映射与域结果约定见 [docs/agent/routes.md](docs/agent/routes.md)。

---

## 10. 测试

- `tests/<group>/*.test.mjs`，runner 是 `node:test`，DOM 用 `jsdom`（`pretendToBeVisual: true`）。
- **UI 用例单独跑**：`pnpm test:ui`。它们一个文件就要几百 MB（jsdom + React + esbuild），
  `pnpm test` 默认跳过；真实交互优先起 `dsh web` 在浏览器里点，见 10.1。
- 断言要抓真问题：状态映射 / 降级路径 / 卸载清理 / 迟到响应，而不是只跑通 happy path。
- **断言里不要直接 `assert.equal(<DOM 节点>, null)`**：失败时 Node 的 `inspectValue` 会以
  `depth: 1000` / `sorted: true` 展开 jsdom 节点，顺着 `__reactFiber$…` 走完整棵 React 树
  （实测单次失败吃掉 5–6GB，把 16GB 机器连同 DSH 一起 OOM）。用 `assert.ok(node === null, msg)`。
- **`vm.runInNewContext` 的沙箱要补齐浏览器全局**：新上下文只有 ECMAScript 内建，没有
  `AbortSignal` / `AbortController` / `Headers` / `fetch`。`fetchJson` 现在给每个请求套
  `AbortSignal.timeout()`，漏一个就表现为「请求没发出 + 对话框不关」。
- 已知本机失败（Windows，别当回归）：`tests/pet/service.test.mjs:75` 的 `assetDir.startsWith('/')`
  是 POSIX-only；`tests/judgment/ledger.test.mjs` 的并发 ask 在全量并行下偶发，单跑再判。
- 测试 import 源码写 `.js` / `.jsx`；但**把路径当字符串**用的地方（esbuild `entryPoints`、
  `readFileSync`、`loadClientEntry`）必须写真实扩展名。

### 10.1 Web 端 UI 验证：token 与那条 401

`dsh web` 的认证是**每进程一次性**的：启动时随机生成 32 字节 launch token（只在内存，不落盘），
只打印一行 `dsh web: http://127.0.0.1:<port>/?token=<base64url>`。

- **401 `dsh web authentication required; …` 是「服务活着、只是没身份」，不是启动失败。**
  真失败是 `EADDRINUSE`、TLS 材料读不了、前端 dist 没建。
- token 拿不到就无法自动登录（桌面端那份也不写盘）。要自动点 UI，必须**自己拥有**那个 `dsh web`
  进程：后台起、从 stdout 抓 `^dsh web: `，`dsh --profile web --no-open --port 6180`。
- 自检期望 **401 → 303 → 200**：裸根 401；`?token=…` 303 + `set-cookie`；带 cookie 200。
  抓一次就持久化 cookie jar：cookie 绑 `host:port`，换端口 / 主机名即失效。
- 本仓库 UI 只在 desktop profile；`--profile web` 只有 base + web-app + sidebar-mobile。
  桌面端 61678 **不能当测试靶子**（token 不可读，只有用户浏览器里那份 cookie）。
- 起法、cookie jar、干净 `DSH_HOME` 首次启动耗时等细节见
  [docs/agent/testing.md](docs/agent/testing.md)。

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

真实 `:hover` 用 CDP 派发 `Input.dispatchMouseEvent`，不要加假类名；图片裁切用外置 Python。
详见 [docs/agent/testing.md](docs/agent/testing.md)。

---

## 12. 改动何时生效

- 只改 client → `pnpm build` 后按 **Ctrl+R**。
- 改 host（含 `cordis.patch.yml`、`src/index.ts`）→ **重启 DSH**：bundles 只在进程启动时读一次。
  重启会中断当前会话回合，**自己不要重启**，交给用户。
- 本机 `DSH_HOME`、profile 名、`link:` 安装与 `app.asar` 反查：见 [docs/agent/env.md](docs/agent/env.md)。
  这三样随机器而变，不要写进本文件。

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
