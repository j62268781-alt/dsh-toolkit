# dsh-toolkit

将启动画面、桌面主题、归档聊天管理、浏览器自动化、结构化判断、移动设备工具和 Skills/MCP 管理打包为一个 DSH 插件。源码位于 [src](<src/>)，内置技能文档位于 [skills](<skills/>)，`lib/` 是构建产物。

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

本地目录会装成 `link:` 依赖，CLI 同时把包名加进 `dsh.profile.bundles`。装完**重启 DSH 桌面应用**才生效：Host 插件在启动时挂载，客户端 bundle 的文件清单也在启动时登记，热更新不会重载已装插件。

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
```

模块独立声明 Host/Client 服务依赖。启动画面不依赖会话服务；主题使用布局服务；归档管理需要会话和工作区服务。客户端通过一个 `dsh-toolkit` loader 注册，各模块仍保持独立生命周期。

## HTTP 路由

Host 路由通过 [共享注册入口](<src/host/routes.js>) 绑定模块生命周期。普通接口使用 `registerAuthenticatedRoute(ctx, route)`，由 DSH 的 `connection.requestRejection()` 校验身份和请求来源；OAuth 回调使用 `registerRoute(ctx, route)`，继续校验一次性 `state`。两者都接收 DSH 的 `{ kind, path, handler }` 路由定义，模块负责请求体、业务校验和响应。

归档删除使用同源接口 `/_dsh/dsh-toolkit/archived/delete-session`，支持远程浏览器。Mobile 的面板及取流接口同样需要 DSH 鉴权，并保留网络围栏和设备令牌；设备切换后旧令牌失效。没有 Web 服务时，移动端工具仍可独立运行。

## 异步操作

共享工具负责配置写入回执、可替换读取的取消、非重叠轮询和 JSON 请求诊断。Host 侧的进程、期限、在途去重及串行队列保留模块各自的错误处理和刷新策略；写请求不会自动重试。客户端停止等待不代表远端写入已回滚。

Judgment 的请求期限覆盖响应正文读取。每小时配额按滚动窗口计算，调用额度在读取凭据前预占；配置输入 token 配额的连接或用途会依次执行，待上一笔实际用量结算后再准入下一笔。单次请求仍可能超出剩余 token 额度，因为发包前无法获知实际用量。

## 外部工具

- Browser 自动化需要 `agent-browser` CLI 与 Chrome/Chromium。
- Mobile 需要 `mobilecli`；Android 还需要 `adb`，iOS 需要设备代理和授权。
- Skills/MCP 使用 DSH 提供的 Loader/MCP 服务，以及目标运行时和技能目录权限。

使用 `src/` 中的源码并通过构建更新 `lib/`；不要直接编辑构建产物。安装或替换 profile 插件前，应在目标 DSH 环境中检查旧插件重复挂载和配置迁移。补丁行沿用 `shell-kit` ID 以兼容既有 profile，插件名称为 `dsh-toolkit`。
