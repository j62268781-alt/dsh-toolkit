# AGENTS.md

这里只放共享硬约束和索引。动手前读对应专题；新增模块走 [新模块 SOP](docs/new-module-sop.md)。本机路径、profile、工具和 MCP 配置只放 `AGENTS.local.md`（可选、不入库）。

## 开工前：先看技能

- 看当前技能 catalog，按 `description` 判断；命中就用 `skill` 工具加载，不直接读 `SKILL.md`，不强行套用不相关的技能。
- 缺少技能依赖的 MCP 时，仍加载技能；可用 `grep` / `read` 做等价检索时，说明降级方式，不假装用过 MCP。
- **调试页面、验证交互或截图：一律加载并使用 `/ego-browser`（`ego-browser` 技能）。不要单独启动 Chrome 或 Chrome Headless；技能不可用就说明阻塞，不换用 Chrome。**

## 0–2. 编辑、工具链与 TypeScript

- 用编辑工具改文件、保留 LF；Windows 用 PowerShell 7（`pwsh`），读文本用 UTF-8。避免整读 `src/client/ui/components/dsh-logo/index.ts`（单行 base64）。
- Node ≥ 20，pnpm 以 `packageManager` 为准；全仓 ESM。新源码用 `.ts` / `.tsx`；import 写 `.js` / `.jsx`，当作字符串传给 esbuild 或读文件时用真实扩展名。
- `src/modules/boot/host/boot.js` 和 `src/modules/pet/host/runtime/renderer.js` 是脚本资产：保持 `.js`，不写 import 或 TS 语法。

## 3. 构建与验证

- 代码改动至少跑 `pnpm build`、`pnpm check` 和相关测试；改 `.ts` / `.tsx` 另跑 `pnpm typecheck`（host）和 `pnpm typecheck:client`。改 host 的 emit 配置另看 `pnpm typecheck:modules`。
- 交付前跑 `pnpm verify`；`pnpm build:check` 只检查产物，不写文件。`pnpm test` 跳过 jsdom；UI 用例单独跑 `pnpm test:ui`。

## 4. 仓库结构与产物边界

源码在 `src/modules/<module>/{host,client}/` 或公共层 `src/{host,client}/`。**不要手改 `lib/` 或 `packages/*/lib/`**；构建产物随源码提交，不提交 `.map`。改名后的旧产物和包结构见[模块分层与产物边界](docs/agent/layout.md#4-仓库结构与产物边界)。

## 5. 目录结构 · 6. 公共层

按「谁使用」分层：先放模块内，第二个模块需要时才提到公共层，并一起迁移测试。先查[模块槽位与公共层清单](docs/agent/layout.md)，不要重复实现。禁止桶文件、host import client、client import `node:*` 或 host 下非 `constants.ts` 的文件。

## 7. 代码风格

Client 双引号、分号、两空格；`scripts/`、`tests/` 单引号、不加分号。注释解释原因；DOM 副作用用安装器并返回 disposer。类型写在实现前；宿主类型不确定时用显式 `any`，不要靠压制诊断或关 strict 绕过。

## 8. 样式 · 9. HTTP

- 改 UI 样式先读 [CSS 注入与主题护栏](docs/agent/client.md)：面板内用局部样式；需要覆盖面板外 DOM 才全局注入。
- 改 HTTP 先读[路由与 HTTP 约定](docs/agent/routes.md)：统一用 `pluginApiPath()`、`src/host/routes.ts` 和 `httpFailure()`；认证先于读请求体。

## 10. 测试 · 11. 页面调试

参照[测试与页面调试](docs/agent/testing.md)启动独立联调进程；确认 profile 已加载 `dsh-toolkit`，不要拿用户正在使用的桌面端做自动化测试。用 `/ego-browser` 打开联调进程打印的登录 URL。样式改动用相同条件做修前 / 修后截图对照。

## 12. 改动何时生效

只改 client：`pnpm build` 后刷新（`Ctrl+R`）；改 host 或 `cordis.patch.yml`：构建后由用户重启 DSH，不要自行中断当前会话。安装和源码查找见 [DSH 联调环境](docs/agent/env.md)。

## 13. 交付

中文回答，结论先行；说明改动、验证结果及是否需要刷新 / 重启 / 重装。没跑验证就如实说明。

## 14. 提交必须分批

一个 commit 只做一件事；源码、相关测试和已跟踪的构建产物同提交。不盲目 `git add -A`，提交前核对 `git status`；推送前工作区应干净（或仅剩明确不入库的文件）。提交说明用 `type(scope): 中文短句`，scope 取模块名。
