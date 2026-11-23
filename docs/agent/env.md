# DSH 环境与联调安装（AGENTS.md §12 细则）

这里是共享流程；本机的 `DSH_HOME`、profile 名与目录、仓库绝对路径和工具位置只记在仓库根目录的 `AGENTS.local.md`（如有）。联调前先确认当前会话的运行时和目标 profile，不照搬其他机器的路径或端口。

## 把工作区 link 到联调用的 profile

1. 如需修改 profile，先备份其中已有的 `package.json`、`cordis.patch.yml` 和 `pnpm-lock.yaml`。优先用独立的联调 profile；桌面端 profile 由桌面应用管理，不用 Web CLI 直接修改。
2. 用目标 profile 支持的安装方式添加工作区的 `dsh-toolkit` bundle。手动配置 `link:` 的联调 profile 时，在 `dsh.profile.bundles` 中加入 `dsh-toolkit`，在 `dependencies` 中加入 `"dsh-toolkit": "link:<仓库路径>"`，并在 profile 目录用目标 DSH 运行环境的 pnpm 执行 `install --no-frozen-lockfile`。
3. 构建、刷新与重启规则见 [AGENTS.md §12](../../AGENTS.md#12-改动何时生效)；Web UI 的启动与认证验证见 [testing.md](testing.md)。

反查宿主实现时用 `dsh-doc` 技能定位当前安装的文档和源码；不依赖固定的 `app.asar` 路径或手工解包。
