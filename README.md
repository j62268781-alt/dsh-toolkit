# dsh-toolkit

将启动画面、桌面主题、归档聊天管理、浏览器自动化、结构化判断、移动设备工具、Skills/MCP 管理、会话通知，以及基于真实会话日志的 token 用量 / 成本预算 / CPU 统计打包为一个 DSH 插件。源码位于 [src](<src/>)，内置技能文档位于 [skills](<skills/>)，`lib/` 是构建产物。用量统计模块的接口契约见 [docs/usage/README.md](<docs/usage/README.md>)，会话通知模块见 [docs/notification/README.md](<docs/notification/README.md>)。

## 构建与验证

需要 Node.js `>=20` 和 pnpm `11.28.5`。DSH 核心包由宿主提供，声明为可选 peer；本地构建通过 devDependencies 安装，插件安装时不携带另一份核心：

```sh
pnpm install --frozen-lockfile
pnpm verify
```

也可分别运行 `pnpm build`、`pnpm typecheck`、`pnpm check` 或 `pnpm test`。测试会跳过真实设备发现；真实 Skills/MCP patch 测试需显式设置 `SMP_REAL_PATCH`。Windows 上构建脚本与测试夹具都按本机路径分隔符工作，POSIX 与 Windows 各自跑自己适用的用例（Windows 没有 Unix domain socket，daemon RPC 用例在那里跳过，产品走 CLI 兜底）。

## 安装到 DSH

一个插件就是一个 profile bundle：profile 的 `dependencies` 链到本仓库，`dsh.profile.bundles` 登记包名。桌面版自带 `dsh` CLI，`dsh plugin` 直接转发给 profile 里的 pnpm：

```sh
dsh plugin --profile desktop add D:/path/to/dsh-toolkit
```

本地目录会装成 `link:` 依赖，CLI 同时把包名加进 `dsh.profile.bundles`。装完**重启 DSH 桌面应用**才生效：Host 插件在启动时挂载，客户端 bundle 的文件清单也在启动时登记，热更新不会重载已装插件。实测 `plugin_manager` 的 enable/disable 与 remove/install 只会改 profile 组合（`application: applied`），并不会让 `link:` 本地包里已进入 Node ESM 缓存的 Host 模块重新求值——改完 Host 半仍然需要重启一次。

- bundle 入口：`package.json` 的 `dsh.bundle.patch`（`cordis.patch.yml`），补丁行沿用 `id: shell-kit`、`name: dsh-toolkit`；
- 客户端入口：`dsh.client` 声明加 `exports["./client"]`（`lib/client.js`），loader 里注册的模块 id 必须等于包名 `dsh-toolkit`；
- 本地开发改了 `src/` 先 `pnpm build` 再重启应用；`lib/` 是构建产物，不要手改。

## 配置

配置保留各功能模块原有命名空间。`shell` 仅为旧配置兼容，不再挂载旧模块。

```yaml
boot: {}
theme: {}
archived: {}
browser: {}
judgement: {}
mobile: {}
skillsMcp: {}
usage:
  budget: 100          # 预算总额，0 = 未设置
  currency: CNY        # CNY | USD
  period: month        # month = 本自然月；total = 全部历史
  historyDays: 14      # 时间线天数
  refreshMs: 8000      # 客户端轮询间隔
  includeSubagents: true
  prices: []           # 自定义单价（每 1M token），空 = 内置默认表
notification:
  enabled: true        # 通知总开关
  soundEnabled: true   # 提示音开关
  volume: 0.6          # 提示音音量 0..1
  currentMode: hidden  # 当前会话提醒时机：hidden | unfocused | always
  scope: main-wait     # 通知范围：all | main | main-wait
  completedEnabled: true
  completedSound: chime
  failedEnabled: true
  failedSound: fault
  questionEnabled: true
  questionSound: pop
  permissionEnabled: true
  permissionSound: alert
```

模块独立声明 Host/Client 服务依赖。启动画面不依赖会话服务；主题使用布局服务；归档管理需要会话和工作区服务。客户端通过一个 `dsh-toolkit` loader 注册，各模块仍保持独立生命周期。会话通知是纯客户端模块（不新增 host 路由），但会读取宿主配置命名空间，所以 `dsh.client.inject` 额外登记了 `dsh-api-session-controller`、`dsh-client-ui-session`、`dsh-client-ui-workspace`、`dsh-client-ui-conversation`，确保它用到的 `ctx.sessions` / `uiSession` / `uiWorkspace` / `uiConversation` 服务在自身加载前已就位。

## 会话通知

「设置 → 通知」可以开关四类提醒——会话完成 / 会话失败 / 等待回答 / 需要授权。每种类型单独开关并可选择提示音（四种内置音效全部用 Web Audio 实时合成，不携带音频文件），另有音量滑块、三档「当前会话提醒时机」（仅后台 / 切到其他应用 / 始终）和三种「通知范围」（全部会话 / 只主会话 / 主会话等子会话跑完）。

系统通知的**标题是会话标题**、**正文是本轮最后一个回复的文本**（失败时是错误信息，待交互时是问题文本或工具名）；点击通知会调用 `ctx.uiWorkspace.openSession(sessionId)` 跳回对应会话，已归档的会话会先取消归档。rc.5 的桌面外壳没有「把窗口带到前台」的 IPC（`globalThis.dshDesktop` 只暴露 browser / deviceInfo / keyboard / shortcuts / updates），所以点击时只能尽力 `window.focus()`：Web 端由浏览器在点击通知时聚焦标签页，桌面端由平台的窗口激活行为处理。

偏好保存在 DSH 用户配置的 `notification` 命名空间里（每个可写字段都是 volatile 叶子），跨窗口、重启后仍在。设置页底部的「最近通知」列出本次运行已经发出的通知，标题/副标题就是通知实际的标题与正文，点击同样可以打开会话。行为契约见 [docs/notification/README.md](<docs/notification/README.md>)。

## HTTP 路由

Host 路由通过 [共享注册入口](<src/host/routes.js>) 绑定模块生命周期。普通接口使用 `registerAuthenticatedRoute(ctx, route)`，由 DSH 的 `connection.requestRejection()` 校验身份和请求来源；OAuth 回调使用 `registerRoute(ctx, route)`，继续校验一次性 `state`。两者都接收 DSH 的 `{ kind, path, handler }` 路由定义，模块负责请求体、业务校验和响应。

归档删除使用同源接口 `/_dsh/dsh-toolkit/archived/delete-session`，支持远程浏览器。Mobile 的面板及取流接口同样需要 DSH 鉴权，并保留网络围栏和设备令牌；设备切换后旧令牌失效。没有 Web 服务时，移动端工具仍可独立运行。

用量统计使用同源只读接口 `GET /_dsh/dsh-toolkit/usage/snapshot`，返回总 token、会话数量、估算成本与预算、按天时间线、各会话用量明细和 CPU/内存采样。数据来自 `$DSH_HOME/sessions` 下的会话日志与投影缓存，只读、不写回；活跃会话优先使用内存中的事件，落盘日志按文件 mtime/size 缓存解析结果。

## 用量统计

入口常驻**左侧栏**：`sidebar.panellist` 里排在「自动化任务」（schedules，order 10）之后的下一个图标（`usage-tokens`，order 11），点开在中栏渲染统计页（`main` key `usage-tokens`），不占用设置页。页面每 `refreshMs` 轮询一次快照接口；总 token 卡下直接列出输入/输出/缓存读/缓存写明细，成本卡与预算卡注明按 DeepSeek 高峰单价估算（空闲时段约为一半，不是最终账单）。预算可在页面内直接改（写入根配置 `usage` 的 volatile 字段，下一次轮询生效）。Host 半用 `configuredPlugin(usage)` 挂载，避免 Cordis 对已 resolve 的 volatile 配置二次校验导致子插件根本不挂载——这个坑由 `tests/integration/usage-wiring.test.mjs` 锁住。

## 异步操作

共享工具负责配置写入回执、可替换读取的取消、非重叠轮询和 JSON 请求诊断。Host 侧的进程、期限、在途去重及串行队列保留模块各自的错误处理和刷新策略；写请求不会自动重试。客户端停止等待不代表远端写入已回滚。

Judgment 的请求期限覆盖响应正文读取。每小时配额按滚动窗口计算，调用额度在读取凭据前预占；配置输入 token 配额的连接或用途会依次执行，待上一笔实际用量结算后再准入下一笔。单次请求仍可能超出剩余 token 额度，因为发包前无法获知实际用量。

## 外部工具

- Browser 自动化需要 `agent-browser` CLI 与 Chrome/Chromium。
- Mobile 需要 `mobilecli`；Android 还需要 `adb`，iOS 需要设备代理和授权。
- Skills/MCP 使用 DSH 提供的 Loader/MCP 服务，以及目标运行时和技能目录权限。

使用 `src/` 中的源码并通过构建更新 `lib/`；不要直接编辑构建产物。安装或替换 profile 插件前，应在目标 DSH 环境中检查旧插件重复挂载和配置迁移。补丁行沿用 `shell-kit` ID 以兼容既有 profile，插件名称为 `dsh-toolkit`。
