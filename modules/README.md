# 模块列表与迁移状态

本仓库是**一个 npm 包、多个内部模块**。每个模块保留自己原有的实现与布局，
由仓库根的组合根（`index.js`）用 `ctx.plugin()` 挂载。设计依据见
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)。

| 模块 | 来源项目 | 现状 | 说明 |
| --- | --- | --- | --- |
| `shell/` | 本仓库原有 | 待搬迁 | 皮肤（52px rail + 240px 面板）、开机动画、会话删除通道 |
| `judgement/` | `D:\项目\dsh-judgment` | **已搬入** | 只有编译产物 `lib/`；注册 `ctx.judgment` 服务，`static inject=['credentials']` |
| `mobile/` | `D:\项目\dsh-sidebar-mobile` | **已搬入** | 右侧栏「移动设备」面板；9 条 webserver 路由 + HMAC capability；接入说明见 `modules/mobile/INTEGRATION.md` |
| `browser/` | `D:\项目\dsh-agent-browser` | 待搬入 | 7 个 CDP 工具 + 设置页；走 Typert Remote，无路由 |
| `skills-mcp/` | `D:\项目\dsh-skills-mcp-manager` | 待搬入 | 设置页 Skills & MCP；8 条路由；`src/` --tsc--> `dist/` |

## 命名约定

- 目录名只用**功能名**，不带原插件名前缀（`mobile` 而不是 `dsh-sidebar-mobile`）。
- 模块内的标识（slot id、settings section id、路由前缀）**保持原样**，
  避免已打开的页面或书签失效。
- 跨模块调用优先直接 import；只有必须延迟解析时才用 `ctx.get()`。

## 搬迁规则

1. **先搬运、后改造**：第一阶段不改业务代码，只改入口、构建与配置路由。
2. 每个模块自带 `README.md` 记录来源项目与改造点。
3. `node_modules`、`.preview`、`*.map`、构建缓存不搬。
