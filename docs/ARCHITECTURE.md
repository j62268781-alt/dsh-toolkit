# dsh-toolkit 架构与迁移设计

> 本文是「把 4 个独立插件合并进本仓库」的设计依据。合并目标不是把代码揉成一坨，
> 而是**一个包、多个内部模块**：Host 侧用 `ctx.plugin()` 挂子插件，Client 侧把
> 多份 factory 合成一次注册。

## 一、DSH 的硬约束（决定了合并形态）

| 约束 | 出处 | 对设计的影响 |
| --- | --- | --- |
| 一个包只能有一份 `dsh.bundle.patch` | package.json `dsh` 字段 | 只能有一个 cordis 行，所以 Host 必须是**组合根** |
| 一个包只能有一份 `dsh.client`，且 **模块 id = 包名** | `@deepseek-ai/dsh-client-modules` lib/index.js:122 | 4 个 client 半边必须合成 1 个 bundle、注册成 1 个 id |
| client bundle 是经典脚本，`__ModuleLoader__.load({id, factory})` | 同上 :463 | 合并方式是「提取各 bundle 的 factory，在一个 factory 里依次执行」 |
| Host 插件可以用 `ctx.plugin(Mod, config)` 嵌套挂载 | cordis | 子模块各自保留 `name/inject/Config`，**不必合并 inject 列表** |
| 跨插件调用走 `ctx.get('judgment')` 之类的服务发现 | 各项目 | 同包内可改为直接 import，省掉可用性探测 |

## 二、目标结构

```
dsh-toolkit/
├─ package.json              # 唯一包：name / dsh.bundle.patch / dsh.client
├─ index.js                  # 组合根：ctx.plugin 依次挂载 modules/*
├─ cordis.patch.yml          # 唯一一行：- id: <pkg> name: <pkg>
├─ core/                     # 跨模块基础设施（不承载功能）
│  ├─ compose.js             # 组合根：挂载子模块、合并 Config schema
│  ├─ http.js                # webServer 路由注册与鉴权的统一封装
│  ├─ paths.js               # DSH_HOME / profile / skills 目录解析
│  └─ log.js
├─ modules/
│  ├─ shell/                 # 原 dsh-shell-kit：皮肤 + 开机动画 + 会话删除通道
│  ├─ browser/               # 原 dsh-agent-browser：CDP 工具面 + 设置页
│  ├─ judgement/             # 原 dsh-judgment：ctx.judgment 服务（无 UI 依赖）
│  ├─ mobile/                # 原 dsh-sidebar-mobile：右侧栏设备面板 + webserver 路由
│  └─ skills-mcp/            # 原 dsh-skills-mcp-manager：设置页 Skills & MCP
├─ utils/                    # 纯函数（无 ctx、无 IO）
├─ config/                   # 分层默认配置与 schemastery schema
├─ assets/                   # 跨模块共享资源（图标、SVG）
├─ scripts/                  # build-client / build-host / verify-client / verify-all
├─ test/
└─ docs/
```

模块内部保持各自现有布局（`lib/`、`src/`、`client/`），**先搬运、后改造**：合并
第一阶段不改任何业务代码，只改「入口 + 构建 + 配置路由」。

## 三、各模块迁移要点

| 模块 | 现状 | 合并动作 | 关键风险 |
| --- | --- | --- | --- |
| `shell` | 本仓库现有：`parts/*.jsx` + `styles/*.css` 拼接构建 | 移入 `modules/shell/`，构建脚本路径改指过去 | 产物必须逐字节不变（已有基线可校验） |
| `judgement` | 只有编译产物 `lib/`（ESM，无 src） | 原样搬入；`export default JudgmentService` 由组合根 `ctx.plugin` 挂载 | 它 `static inject=['credentials']`，靠 cordis 处理，不用改 |
| `mobile` | 纯 JS Host `index.js` + 自建 `lib/stream/routes.js`；`ctx.inject(['webServer'])` | 搬入后改由 `core/http.js` 统一注册；`mobileLoop` 改为直接 import judgment | 9 条路由 + HMAC capability + 长轮询不能动 |
| `browser` | TS src → tsc 生成 lib；client 由 esbuild 打 cjs | 保留 tsc 出 `lib/`；client 改为被合并 bundle 引用 | client 里 `PACKAGE='dsh-agent-browser'` 等常量需改成新包名/模块 id |
| `skills-mcp` | `src/` --tsc--> `dist/`，client 由 esbuild 打平 | 保留 dist 构建；client 同上 | `lib/src/*` 反向 `import '../../src/...'`，移动目录即断；`.preview` 11.5MB 丢弃 |

## 四、Host 组合根

```js
// index.js（组合根，唯一 cordis 行）
import AgentBrowser from "./modules/browser/lib/index.js";
import Judgment from "./modules/judgement/lib/index.js";
import mobile from "./modules/mobile/index.js";
import skillsMcp from "./modules/skills-mcp/dist/index.js";
import { applyShell } from "./modules/shell/index.js";

export const name = "dsh-toolkit";
export const inject = ["webServer"];           // 组合根自己需要的能力
export const Config = composeConfig(/* 各模块 schema 合并 */);

export function apply(ctx, config) {
  applyShell(ctx, config.shell);
  ctx.plugin(Judgment, config.judgement);       // 子插件保留自己的 inject/Config
  ctx.plugin(AgentBrowser, config.browser);
  ctx.plugin(mobile, config.mobile);
  ctx.plugin(skillsMcp, config.skillsMcp);
}
```

好处：子模块的 `inject` 各自声明、各自生效，**不需要在组合根合并 inject 列表**；
某个模块配置缺失就等于不启用。

## 五、Client 合并

各模块现状都是「一个 bundle 调一次 `__ModuleLoader__.load({id, factory})`」。
合并脚本在构建期做一次改写：

1. 读入每个模块的 client bundle，抽出 `factory` 函数体（正则匹配唯一的 `load({...})` 调用）；
2. 生成新 bundle：

```js
window.__ModuleLoader__.load({
  id: "<新包名>",
  factory: (require) => {
    const mods = [/* 各模块 factory(require) */];
    const exports = {};
    exports.apply = (ctx) => mods.forEach((m) => m.apply?.(ctx));
    exports.inject = ["slots", "layout", "locale", "sessions", "workspaces", "remote", "configForms"];
    return exports;
  },
});
```

3. `dsh.client.inject` 取四个模块 inject 的**并集**（`api-remotes`、`ui-settings`、
   `ui-primitives`、`ui-renderer`、`ui-sidebar-right`、`locale`、`shortcuts`）。

模块注册的 slot / settings section id（`browser`、`skills-mcp`、`mobile`）保持原样，
互不冲突。

## 六、命名

合并后这个包已不只是「皮肤」或「工具箱」，而是「一组 DSH 增强能力的集合」。
建议新名：**`dsh-toolbelt`**（工具带：每个模块是一件独立工具，装在一个带子上）——
比 `dsh-toolkit` 更贴合「多能力集合」的语义，也避免与常见词 toolkit 重名。
包内模块名用功能名：`shell` / `browser` / `judgement` / `mobile` / `skills-mcp`。

改名影响面：
- `package.json` name、`cordis.patch.yml` 的 id/name、README；
- profile 里的依赖键、`dsh.profile.bundles` 条目、`node_modules` 软链名；
- client 内 `PACKAGE` / `ENTRY_CANDIDATES` 常量（browser）、路由前缀（mobile/skills）——
  路由前缀属于对外 URL，建议**保留原前缀**，避免已开的页面/书签失效。

## 七、分阶段执行（每阶段可独立提交、可回滚）

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | 骨架 + 设计文档 + `modules/judgement` 搬入 + `modules/shell` 搬迁 | `npm run check` 通过；产物正文不变 |
| P2 | `modules/mobile` 搬入，路由改由 `core/http.js` 注册 | 面板能开、9 条路由 200 |
| P3 | `modules/browser` 搬入（tsc 构建并入总构建） | 7 个工具注册、设置页出现 |
| P4 | `modules/skills-mcp` 搬入（dist 构建并入总构建） | 设置页 Skills & MCP 可用 |
| P5 | client 合并脚本 + 单 bundle 验证 | 四个 UI 同时出现、无 id 冲突 |
| P6 | 改名 + profile 更新 + README | 重启后所有功能可用 |
| P7 | commit / push / 关机 | 远端同步、工作区干净 |

## 八、明确不做的事

- 不重写任何业务逻辑（工具注册、路由、OAuth、stream 协议全部保留原实现）。
- 不合并各模块的配置 schema 语义，只做命名空间隔离（`config.browser.*` 等）。
- 不删除对外 URL 前缀（`/_dsh/dsh-sidebar-mobile`、`/dsh-skills-mcp-manager`）。
- 不上传 `node_modules`、`.preview`、`dist` 之外的构建缓存。

## 九、勘察修正（四项目实测后）

原设计里「judgement 走 inject 模式」的说法**不准确**。实测 `dsh-judgment` 没有任何
"注入别的插件"的机制，它的「注入」只有两类：

1. **cordis 服务依赖**：`static inject = ['credentials']`（`lib/index.js:102`）——这是
   普通插件依赖声明，cordis 自己会处理；
2. **客户端共享模块清单**：`dsh.client.inject` 三个包（ui-settings / ui-primitives /
   api-remotes）——这是客户端加载顺序与共享模块声明，四个插件都有。

所以「合并后就不用注入了」的实质是：**不再需要独立的 patch 行、独立的 client 模块
id、以及 `ctx.get('judgment')` 这种服务发现**；跨模块可以直接 import，
`mobileLoop` 里那 30 行可用性探测可以删掉。第 ① 类注入仍保留（cordis 会处理）。

其余实测结论：

- 四个 client 的 UI 标识互不冲突，可共存：`skills-mcp` order 20、`judgment` order 21、
  `browser` order 22；`mobile` 注册的是 `sidebarRightTabs` 的 `kind:"mobile"`。
- 路由都在可选注入里注册：mobile 9 条（前缀 `/_dsh/dsh-sidebar-mobile`）、
  skills-mcp 8 条（前缀 `/dsh-skills-mcp-manager`），合并后由 `core/http.js` 统一封装。
- 两个 TS 模块形状不同，组合根要按形状分别挂载：
  `browser` = `{name, inject, Config, default Service}`、`judgment` = 纯 Service 类、
  `mobile` = `{name, inject, apply}`、`skills-mcp` = `{name, inject, Config, apply}`。
- 体积取舍：skills-mcp 的 `.preview`（11.5MB）与 `docs/images`（1MB）不搬，
  运行必需只有 `dist/` + `lib/client.js` ≈ 0.6MB。
- 四个模块的外部前置不同：browser 需要 `agent-browser` CLI 与 Chrome；mobile 需要
  `mobilecli` 二进制与 adb；skills-mcp 需要 profile patch 文件读写权限。组合根
  不应因为一个模块的前置缺失而整体失败，每个模块独立降级。
