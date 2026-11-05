# dsh-toolkit

DSH 插件集合，提供一个聚合 bundle 和八个可单独启停的模块包。模块源码仍集中在 `src/modules`、`src/host`、`src/client`；根目录 `pnpm build` 会把各模块所需的 Host 依赖闭包、Client bundle 和运行资源生成到 `packages/*/lib`。无需拆 Git 仓库。

| 模块 | 独立包名 | Client |
| --- | --- | --- |
| 启动画面 | `dsh-toolkit-boot` | 有 |
| 桌面主题 | `dsh-toolkit-theme` | 有 |
| 归档管理 | `dsh-toolkit-archived` | 有 |
| 浏览器自动化 | `dsh-toolkit-browser` | 有 |
| 结构化判断 | `dsh-toolkit-judgment` | 有 |
| 移动设备 | `dsh-toolkit-mobile` | 有 |
| Skills / MCP | `dsh-toolkit-skills-mcp` | 有 |
| 会话通知 | `dsh-toolkit-notification` | 有 |

## 安装

开发和本地使用时，在仓库根目录安装依赖并构建，然后把聚合包加入目标 profile：

```sh
pnpm install
pnpm build
# 在 DSH 环境中
dsh plugin --profile desktop add D:/path/to/dsh-toolkit
```

聚合 bundle 会声明全部八个模块，因此插件管理页面提供一个总开关和每个模块独立的 Host/Client 开关。只需要单个功能时，可将 `packages/<module>` 目录作为 DSH bundle 单独安装。修改源码后重新运行 `pnpm build`；Host ESM 改动仍需重启 DSH。不要编辑 `packages/*/lib` 构建产物。

DSH 核心包只声明为可选 peer，由宿主提供；模块实际用到的 peer 按模块分别声明。Skills/MCP 额外使用普通运行依赖 `yaml`。

## 旧配置迁移

升级前先对目标 profile 的 `cordis.patch.yml` 生成预览：

```sh
node scripts/migrate-config.mjs D:/path/to/profile/cordis.patch.yml
```

检查输出后显式加 `--write` 才会写回。写入前会创建带时间戳和 UUID 的备份；该命令不会自动选择或修改当前 DSH profile。转换将旧聚合配置拆到模块包 ID，模块已有配置优先，并为八个模块显式保留旧总开关状态。旧 root 覆盖会保留并设为 disabled；因为新 bundle 不再插入旧 `shell-kit` 行，宿主可能对这条遗留覆盖报告 `entry not found`，不影响新模块行。冲突别名或不安全的 YAML 结构会拒绝自动迁移，需先手工处理。

## 构建与验证

需要 Node.js `>=20` 和 pnpm `11.28.5`：

```sh
pnpm install
pnpm verify
```

`pnpm build:check` 检查根与各独立包的产物是否最新。`pnpm migrate:config <patch.yml>` 可运行迁移预览。测试会跳过真实设备发现；真实 Skills/MCP patch 测试需显式设置 `SMP_REAL_PATCH`。

## 功能说明

- 启动画面提供描摹、水面浮现与「深海之门」三种动画：顶部使用与真实启动相同的 HTML/CSS 预览，下方点选即用；显示参数使用标题与圆角分组，独立保存。
- 外观顶部为实时预览，下方为四列颜色与主题选择。浅色 / 深色 / 跟随系统使用纯色色块；原始 DSH / Codex / 大海蓝鲸 / 昼夜流光提供独立图案。明暗与主题独立保存。
- Codex 独享其工作区布局；原始 DSH、大海蓝鲸、昼夜流光以宿主原始布局为基础，切换时回收 Codex 的样式和侧栏行为。
- 大海蓝鲸通过巨鲸细节、远鲸、体积光、透视海面与焦散建立纵深；昼夜流光（兼容原有 `hope` 配置）按本地时间连续呈现日出、白昼、日落、月夜星河，每分钟同步，唤醒页面时校时。
- 两套动态场景只显示在主会话的空白新会话中；已有会话、加载中的会话和侧栏嵌入会话不会显示，且尊重系统减少动态效果偏好。
- 设置弹层（Codex 风格）改用结构选择器（`role="presentation"`、`data-shortcut-modal="settings"`、直接子级 `nav`），不再依赖构建期 CSS 模块类名；Windows 上按系统标题栏高度预留顶部拖拽带，并让返回/更多按钮避开右上角窗口按钮。
- 通知模块含 Host 鉴权音效路由和 Client 设置/提醒，不是纯 Client 功能。
- Browser 自动化需要 `agent-browser` CLI 与 Chrome/Chromium。
- Mobile 需要 `mobilecli`；Android 还需要 `adb`，iOS 需要设备代理和授权。
- Skills/MCP 使用 DSH Loader/MCP 服务以及目标运行时和技能目录权限。
- Judgment 的类型契约从 `dsh-toolkit-judgment/contract` 导出。

通知行为与 Host 路由契约见 [docs/notification/README.md](docs/notification/README.md)。
