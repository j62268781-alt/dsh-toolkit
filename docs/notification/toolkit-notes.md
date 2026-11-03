# notification 模块接入约定（dsh-toolkit 代码勘测）

> 目的：为在 `D:\项目\dsh-toolkit` 中新增**一个**功能模块 `notification` 提供逐点可执行的约定。
> 本文是**勘测笔记**，不是模块契约；模块上线后应另建 `docs/notification/README.md` 作为接口契约
> （格式照抄 `docs/usage/README.md`）。
>
> 勘测方式：只读源码 / 测试 / 构建脚本，未改动任何 `src/`、`tests/`、`lib/`、`package.json`、`scripts/`。
> 分析时间：2026-11-03 22:2x（当时工作树已有**未提交**的 usage 模块改动与 archived 微调，见 §5.6）。

---

## 0. 结论速览（先看这一节）

| 问题 | 结论 |
|---|---|
| 需要 host 半吗？ | **纯客户端功能不需要**（先例：`theme` 只有 client 半）。但只要设置页要**持久化**配置，就必须改 `src/host/config.js` 加命名空间——「没有 host 半」≠「不碰 host 侧文件」。 |
| 客户端入口形状 | 默认导出**工厂** `createNotification(require)`，返回 `{ name, inject, apply }`。照抄 `src/modules/usage/client/index.jsx`。 |
| 注册点 | `src/client/index.js` 里 `ctx.plugin({ name: 'toolkit-notification-client', ...createNotification(require) })`。 |
| 设置页 | `settings.section`，`id: 'notification'`，`order: 24`（现有最大 23），`label: () => t('nav')`，`locale: 'dsh-toolkit.notification'`。 |
| locale | 命名空间 `dsh-toolkit.notification`，`{ zh: {...}, en: {...} }`；`createTranslator` 逐级回退到内置中文表。 |
| CSS | `import css from './styles.css'` + `installStylesheet(css, 'toolkit-notification')`，类名前缀 `ntf-`，只用 `--dsw-*` 主题变量。 |
| 持久化 | `findScopedForm(ctx, 'notification')` → 投影表单 → `acceptConfigWrite(() => form.set(field, value))`。**不要用 localStorage**（全仓库 0 处）。 |
| 构建要改 | `src/client/index.js`、`src/host/config.js`、`lib/client.js`（`pnpm build` 生成，禁止手改）。可选：`scripts/build-client.mjs` 的 `clients` 数组（要独立 harness bundle 才加）。 |
| 测试 | 放 `tests/integration/`（**不用改** `scripts/test.mjs`）；照抄 `tests/usage/client.registration.test.mjs`。若放 `tests/notification/`，必须把 `'notification'` 加进 `scripts/test.mjs` 的 group 数组，否则**不会被执行**。 |
| 必须同步的既有测试 | `tests/integration/client-composition.test.mjs`、`tests/integration/usage-client.test.mjs`、`tests/integration/host-composition.test.mjs`（它们硬编码了子插件数量 / 设置页集合 / 根配置键）。 |

---

## 1. 模块解剖

### 1.1 目录布局

现有 8 个模块都遵循「`src/modules/<name>/{host,client}/` 两半独立」的布局，但**允许只有一半**：

| 模块 | host 半 | client 半 | 说明 |
|---|---|---|---|
| boot | ✅ `host/{index,boot.js,boot.css,boot.html}` | ❌ | 只注入启动画面资产 |
| theme | ❌ | ✅ `client/{index,platform,rail,sidebar,band,styles,...}` | **纯客户端先例** |
| archived | ✅ `host/{index,paths,route,files}.js` | ✅ `client/*` | 删除会话需要 host 路由 |
| browser | ✅ `host/*.ts` | ✅ `client/*.jsx` | TS host + JSX client |
| judgment | ✅ `host/*.ts` | ✅ `client/*.jsx` | TS host + JSX client |
| mobile | ✅ `host/*.js` | ✅ `client/*.jsx` | 大模块，多层子目录 |
| skills-mcp | ✅ `host/*.js` | ✅ `client/*` | 大模块，多层子目录 |
| usage | ✅ `host/{index,config,paths,route,snapshot,...}.js` | ✅ `client/{index,locale,model,panel,styles,...}` | **最新的完整范例** |

`notification`（纯客户端 + 一个设置页）推荐只有一个半：

```
src/modules/notification/
└── client/
    ├── index.jsx      # 入口：默认导出工厂 createNotification(require)
    ├── locale.js      # NS + zh/en 文案 + createTranslator（照抄 usage/client/locale.js）
    ├── model.js       # 纯函数层（格式化/过滤/排序），不碰 DOM、不读 ctx、不发请求
    ├── panel.jsx      # 设置页组件：export function createNotificationPanel(React, options)
    └── styles.css     # 类名前缀 ntf-，只用主题变量
```

> 约定：`model.js` 单独拆出来是 usage 的明确风格（`src/modules/usage/client/model.js:1-5` 注释：
> 「这里不放 DOM、不读 ctx、不发请求……所有可测的算术都在这」）。这样 `node --test` 可以直接
> `import` 它做纯函数单测，不需要 jsdom/esbuild。

### 1.2 入口形状（四种，按需要选）

**(A) Host：普通函数插件（`name/inject/apply` + default 汇总）**

```js
// src/modules/usage/host/index.js:17-55（archived/boot/mobile/skills-mcp 同构）
export const name = 'toolkit-usage'
export const inject = ['sessions', 'webServer', 'connection']
export { Config } from './config.js'
export function apply(ctx, config) { /* ... */ }
export default { name, inject, Config, apply }
```

**(B) Host：Service 类插件**（browser/judgment 用；`src/index.js` 用 `configuredService()` 包一层）

**(C) Client：工厂（需要 `require` 时必须用它）**

```js
// src/modules/usage/client/index.jsx:27-76（mobile / skills-mcp 同构）
export default function createUsage(require) {
  const React = require('react')
  globalThis.__dshReact = React        // 关键：JSX 走全局工厂
  return {
    name: 'toolkit-usage-client',
    inject: ['slots', 'locale', 'configForms'],
    apply(ctx) { /* effect 注册词典/样式/settings.section */ },
  }
}
```

**(D) Client：命名空间导出（不需要 `require` 时）**

```js
// src/modules/theme/client/index.js:8-18、src/modules/archived/client/index.js:9-19
export const inject = ['layout']
export function apply(ctx) { ctx.effect(..., 'toolkit-theme:stylesheet') }
```

> **为什么工厂是「更安全」的默认**：只有工厂函数体内才有宿主的 `require`，它既能拿 `react`，
> 也能拿 `@deepseek-ai/*`（宿主模块表，见 §3.6），还能在 `globalThis` 上就位 `__dshReact`。
> 命名空间导出（C/D 之外的 A 型）没有 `require`，只适合纯 DOM 操作（theme）或纯 JSX 且被别的工厂
> 顺带设好全局的模块。

### 1.3 两处注册中枢

**Host：`src/index.js`（1-31 行）**

```js
import * as usage from './modules/usage/host/index.js'
import { Config } from './host/config.js'
import { configuredPlugin, configuredService } from './host/plugins.js'

export { Config }
export const name = 'dsh-toolkit'
export const inject = []

export function apply(ctx, config) {
  ctx.plugin(boot, config.boot)          // 顺序：boot → archived → Judgment → mobile
  ctx.plugin(archived, config.archived)  //       → Browser → SkillsMcp → usage
  ctx.plugin(Judgment, config.judgement)
  ctx.plugin(mobile, config.mobile)
  ctx.plugin(Browser, config.browser)
  ctx.plugin(SkillsMcp, config.skillsMcp)
  ctx.plugin(usage, config.usage)
}
export default { name, inject, Config, apply }
```

**Client：`src/client/index.js`（全文 20 行，顺序即子插件顺序）**

```js
import * as theme from '../modules/theme/client/index.js'            // 1
import * as archived from '../modules/archived/client/index.js'      // 2
import * as browser from '../modules/browser/client/index.jsx'       // 5
import * as judgment from '../modules/judgment/client/index.jsx'     // 4
import createMobile from '../modules/mobile/client/index.jsx'        // 6
import createSkillsMcp from '../modules/skills-mcp/client/client.js' // 3
import createUsage from '../modules/usage/client/index.jsx'          // 7

export const inject = []
export function apply(ctx) {
  ctx.plugin({ name: 'toolkit-theme-client', ...theme })
  ctx.plugin({ name: 'toolkit-archived-client', ...archived })
  ctx.plugin({ name: 'toolkit-skills-mcp-client', ...createSkillsMcp(require) })
  ctx.plugin({ name: 'toolkit-judgment-client', ...judgment })
  ctx.plugin({ name: 'toolkit-browser-client', ...browser })
  ctx.plugin({ name: 'toolkit-mobile-client', ...createMobile(require) })
  ctx.plugin({ name: 'toolkit-usage-client', ...createUsage(require) })
}
```

要点：
- 主 bundle 的 loader id 固定为包名 `dsh-toolkit`（`package.json` `dsh.client` + `exports["./client"]`；
  `scripts/check.mjs:36` 断言 `id: "dsh-toolkit"`）。子插件 `name` 用 `toolkit-<module>-client`。
- 每个子插件**独立 inject 作用域**：一个子插件缺服务只会挂起它自己（`src/index.js:20-21` 注释、
  `tests/integration/client-composition.test.mjs:270-307` 有断言）。所以 `inject` 只写本模块真正用的服务。
- 顺序有意义：`tests/integration/usage-client.test.mjs:139-147` 把 7 个子插件顺序写死了。
  **新模块追加在最后**，可让既有下标（`children[6]`）不变，只需改数量断言。

### 1.4 每模块的配置命名空间怎么来

一次配置读写的完整链路：

```
package.json dsh.bundle.patch → cordis.patch.yml (id: shell-kit, name: dsh-toolkit)
  → src/index.js apply(ctx, config) 的 config.<namespace>
  → src/host/config.js 的根 Config schema（决定 namespace 是否存在、是否可写）
  → host 半 apply(ctx, config.<ns>)             （有 host 半时）
  → 客户端 ctx.configForms.get(<root entry id>)  （root entry id 见下）
  → src/client/config.js scopeForm(form, namespace) 投影出「只看该 namespace」的表单
  → findScopedForm(ctx, 'notification') 一步到位
```

- 根 entry id 候选：`ROOT_ENTRIES = ['shell-kit', 'dsh-toolkit', 'dsh-shell-kit']`
  （`src/client/config.js:2`；`cordis.patch.yml` 沿用 `shell-kit`）。`findScopedForm` 依次探测，
  老宿主/改名都能兜住，只有 **root entry** 才做 namespace 投影；legacy entry（模块自己旧 id）原样返回。
- 命名空间名 = 根 `Config` 的键 = `findScopedForm(ctx, '<ns>')` 的第二参 = `config.<ns>`，
  三者必须一致。现有：`boot / theme / archived / browser / judgement / mobile / skillsMcp / usage / shell`。
  ⚠️ 注意 `judgement` 是**英式拼写**（模块目录叫 `judgment`），这是历史遗留，新模块别学。
- `notification` 应使用 `notification`（派生自目录名，与 CLI/slot id 一致）。

### 1.5 生命周期：一切注册都进 `ctx.effect`

所有注册都包在 `ctx.effect(run, '<plugin-name>:<aspect>')` 里，标签格式固定
`toolkit-<module>:<aspect>`，卸载时按相反顺序 dispose：

```js
ctx.effect(() => installStylesheet(css, 'toolkit-usage'), 'toolkit-usage:stylesheet')
ctx.effect(() => ctx.locale.register(USAGE_NS, USAGE_COPY), 'toolkit-usage:dictionary')
ctx.effect(() => installUsageSection(ctx), 'toolkit-usage:section')
```

`installStylesheet` 返回 remove 函数、`locale.register` 返回 disposer、`slots.inject` 返回 disposer，
所以 `ctx.effect` 直接可用。usage 还额外包了 `install()` try/catch，保证「某一项注册失败不拖垮整个
客户端半」（`src/modules/usage/client/index.jsx:39-72`）——新模块建议照抄。

---

## 2. Host 配置

### 2.1 根 schema 在 `src/host/config.js`（唯一入口）

```js
// src/host/config.js:1-20（完整）
import s from '@deepseek-ai/schemastery'
import { Config as BrowserConfig } from '../modules/browser/host/config.js'
import { Config as JudgmentConfig } from '../modules/judgment/host/config.js'
import { Config as SkillsMcpConfig } from '../modules/skills-mcp/host/index.js'
import { Config as UsageConfig } from '../modules/usage/host/config.js'

export const Config = s.object({
  shell: s.any().default({}),      // 旧配置兼容，不再挂载旧模块
  boot: s.any().default({}),       // 以下四个是「无 host 配置校验」的历史模块
  theme: s.any().default({}),
  archived: s.any().default({}),
  browser: BrowserConfig.default({}),
  judgement: JudgmentConfig.default({}),
  mobile: s.any().default({}),
  skillsMcp: SkillsMcpConfig.default({}),
  usage: UsageConfig.default({}),
})
```

三种写法并存，各有用途：

| 写法 | 用例 | 后果 |
|---|---|---|
| `s.any().default({})` | boot/theme/archived/mobile | 不做 schema 描述；设置页**不会**为它生成可写字段 |
| `ModuleConfig.default({})` | browser/judgement/skillsMcp/usage | 由模块自己的 `host/config.(js|ts)` 描述字段 |
| 内联 `s.object({...}).default({})` | 无 host 半、但需要可写字段的新 namespace | 推荐给 `notification`（见 §2.2） |

`host/plugins.js` 的两个包装器解决「根 schema 已经校验过，子插件不要再校验一遍」：

```js
// src/host/plugins.js
export function configuredService(Service) { class ConfiguredService extends Service { static Config = undefined } return ConfiguredService }
export function configuredPlugin(plugin) { return { name: plugin.name, inject: plugin.inject, apply: plugin.apply } }
```

- Service 类插件（browser/judgment）必须走 `configuredService`，否则 Cordis 会用子类静态 `Config`
  二次校验（并跳过 Service 初始化钩子）。
- 函数插件（skills-mcp）走 `configuredPlugin`。
- 直接 `ctx.plugin(usage, config.usage)` 的 usage 保留了自身 `Config`（其 volatile 边界已由根校验），
  这是「模块自带 Config + 根也引用同一 Config」的写法；新增纯客户端命名空间不需要它。

### 2.2 `notification` 命名空间的具体写法（推荐：内联 schema + volatile 叶子）

**硬约束（来自 `src/modules/browser/host/config.ts:1-14` 的长注释）**：
DSH 设置服务只允许写 **volatile** 字段，`describe()` 用 `volatileForm(schema)` 过滤；
**一个 volatile 字段都没有的 entry 根本不会出现在设置命名空间里**，表现是「页面能打开、点什么都没反应」。
所以：凡是设置页要写的字段，**逐个 `.volatile()`**；至少一个。

在 `src/host/config.js` 末尾追加（不要改动既有行）：

```js
export const Config = s.object({
  /* ...既有 9 个键保持原样... */
  // notification 是纯客户端模块：没有 host 半，命名空间只服务于设置页读写。
  // 每个可写字段都必须 .volatile()，否则设置页写不进去（见 browser/host/config.ts 注释）。
  notification: s.object({
    enabled: s.boolean().default(true).volatile(),
    sound: s.boolean().default(true).volatile(),
    // ...
  }).default({}),
})
```

补充规则（`src/host/config.js:7-9` 注释）：
- **Schemastery 不允许把一个已含 volatile 字段的 namespace 再包进 volatile 字段**，所以
  `notification: s.object({...volatile leaves...}).default({})` 本身**不要**再 `.volatile()`。
- volatile 值不会重建 Loader entry：host 半读配置要在**每次请求时现取**（usage 的
  `readUsageConfig()` 用 `field.get()`，见 `src/modules/usage/host/config.js:39-71`）。纯客户端模块
  没有这个问题，客户端本来就走 `configForms` 订阅。
- 若只是**跟随式**设置（不需要设置页写、也不需要持久化），可以直接 `s.any().default({})`，
  与 theme/archived 一致；但那就不要指望 `form.set` 成功。

### 2.3 `.d.ts` 文件模式

| 类型 | 生成方式 | 例子 |
|---|---|---|
| TS host 源码 | `tsconfig.json` 开 `declaration: true`，`pnpm build` 由 `build-host.mjs` 随 `.js` 一起 emit | `src/modules/browser/host/*.ts` → `lib/modules/browser/host/*.d.ts` |
| JS host 工具 | **手写同名 `.d.ts`**（仅 6 个） | `src/host/{executable,operation,process,serial,singleflight,time}.d.ts` |
| Client 半 | 不产出类型（esbuild 打包进 `lib/client.js`） | — |

`notification` 若是纯 JS/JSX：**不需要**任何 `.d.ts`。若将来加 TS host 半，必须同时把 glob 加进
`tsconfig.json` 的 `include`（现在只有两条：`src/modules/browser/host/**/*.ts`、
`src/modules/judgment/host/**/*.ts`），否则 `pnpm typecheck` 根本不看它（也不会 emit）。

### 2.4 纯客户端功能到底需不需要 host 半？

| 需求 | 需要 host 半？ | 依据 |
|---|---|---|
| 只在设置页渲染 UI、读写自己的配置 | ❌ | theme（纯 client）、usage 的配置读写全在 client |
| 读会话/布局等既有 host 服务（`ctx.sessions`、`ctx.layout`…） | ❌（client 直接注入同名服务） | archived/theme 都在 client 用 `ctx.sessions` / `ctx.layout` |
| 监听 host 事件、后台进程、定时器 | ✅ | usage CPU 采样器、mobile 流会话 |
| 暴露 HTTP 接口 | ✅ | usage/archived/mobile/skills-mcp 都有 `registerAuthenticatedRoute` |
| 跨窗口/跨进程持久化（写文件、写 patch） | ✅ | skills-mcp 写磁盘、archived 调 sessions 删除 |
| 需要设置页**持久化**配置 | ❌ host 半，但 ✅ 改 `src/host/config.js` | 设置表单由 host settings 服务托管，schema 在根 Config |

结论：`notification` 若只是「通知的展示/开关/筛选 + 设置页」，**不需要** `src/modules/notification/host/`、
不需要改 `src/index.js`、不需要 `cordis.patch.yml`；但**需要**在 `src/host/config.js` 加命名空间。

---

## 3. 客户端设置页

### 3.1 现有 `settings.section` 注册全表

| 模块 | id | order | label 来源 | locale | 注册处 |
|---|---|---|---|---|---|
| archived | `archived-chats` | 20 | `t('nav')` → `已归档的聊天` | `shell-kit.archived` | `src/modules/archived/client/section.jsx:195-208` |
| skills-mcp | `skills-mcp` | 20 | 硬编码 `'Skills & MCP'` | — | `src/modules/skills-mcp/client/client.js:29-35` |
| judgment | `judgment` | 21 | 硬编码 `'决策'` | — | `src/modules/judgment/client/index.jsx:48-55` |
| browser | `browser` | 22 | 硬编码 `'浏览器'` | — | `src/modules/browser/client/index.jsx:36-43` |
| usage | `usage-tokens` | 23 | `t('nav')` → `用量统计` | `dsh-toolkit.usage` | `src/modules/usage/client/index.jsx:64-73` |

外部参照：`src/modules/browser/client/index.jsx:38` 注释「排在“通用”(10) 与“决策”(21) 之后」，
即宿主内置「通用设置」占 order 10。**新模块建议 `order: 24`（接在 usage 之后）**，不要与 20 重复。

注册代码形状（所有 5 处完全一致）：

```js
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'usage-tokens',
  order: 23,
  label: () => t('nav'),
  locale: USAGE_NS,            // 可选：告诉宿主 label 用哪个 locale 命名空间
  inject: () => ({ form, entryId, ... }),  // 可选：把 apply 期解析的东西交给组件
}, Panel))
```

两种把 `form` 交给页面的风格：
- **usage/archived**：在 `apply` 里 `findScopedForm` 一次，**闭包**进组件（注册时不传 `inject`）；
- **browser/judgment/skills-mcp**：注册时传 `inject: () => ({ form, entryId, primitives, ... })`。

`tests/integration/client-composition.test.mjs:211-232` 对两者都有断言；纯客户端模块推荐 usage 风格
（更简单，且页面自己轮询/订阅）。

### 3.2 locale 命名空间

现有两个（命名不统一，新模块统一用 `dsh-toolkit.<module>`）：

| 命名空间 | 模块 | 文件 |
|---|---|---|
| `shell-kit.archived` | archived | `src/modules/archived/client/locale.js:1` |
| `dsh-toolkit.usage` | usage | `src/modules/usage/client/locale.js:7` |

`locale.js` 的标准形状（`src/modules/usage/client/locale.js` 是最完整的范本，233 行）：

```js
export const USAGE_NS = 'dsh-toolkit.usage'
export const USAGE_COPY = {
  zh: { nav: '用量统计', title: '用量统计', /* ... */ },
  en: { nav: 'Usage', title: 'Usage', /* ... */ },
}
export function interpolate(template, params) { /* {name} 占位符替换，缺参保持原样 */ }
export function createTranslator(ctx, language) { /* 见下 */ }
```

注册（必须进 effect，返回 disposer）：

```js
// src/modules/archived/client/index.js:15
ctx.effect(() => ctx.locale.register(ARCH_NS, ARCH_COPY), 'toolkit-archived:dictionary')
// usage 的降级版（locale 服务可能不存在）
ctx.locale?.register?.(USAGE_NS, USAGE_COPY)
```

`createTranslator` 的回退链（`src/modules/usage/client/locale.js:213-232`，新模块直接抄）：

1. `ctx.locale.bind(NS)` 拿到的 binder——每次 `t(key)` 现查，宿主语言切换即时生效；
2. `bind` 缺失/抛错/返回空串/返回 key 本身 → 用构造时的 `USAGE_COPY[language]`；
3. 再退到 `USAGE_COPY.zh`；
4. 最后原样返回 key（页面不会显示 `undefined`）。

`localeHint(ctx)` 的读法（`src/modules/usage/client/index.jsx:16-25`）兼容三种宿主形状：
`ctx.locale.language` → `ctx.locale.getLanguage()` → `ctx.locale.lang`，全部 `try/catch`。

### 3.3 CSS 安装（两种既有模式，二选一）

**模式 A：全局 `<style data-plugin>` + `installStylesheet`（theme / archived / usage）**

```js
import css from './styles.css'   // esbuild text loader → 字符串
import { installStylesheet } from '../../../client/ui/stylesheet.js'

ctx.effect(() => installStylesheet(css, 'toolkit-usage'), 'toolkit-usage:stylesheet')
```

`src/client/ui/stylesheet.js`（9 行）创建 `<style data-plugin="toolkit-usage" data-plugin-css="toolkit-usage/styles.css">`
并返回 `tag.remove`。测试按 `style[data-plugin="toolkit-usage"]` 断言，**推荐 notification 用这个**。

**模式 B：组件内 `<style>{CSS}</style>`（browser / judgment / skills-mcp / mobile）**

```js
import panelCss from './styles.css'
import { settingsStyles } from '../../../client/styles/settings.js'
const CSS = `${settingsStyles('jdg')}\n${panelCss}`
// ...JSX 里：<style>{CSS}</style>
```

随组件挂载/卸载，不需要 `document` API；适合「样式只在面板内生效」的页面。

**共享样式 `settings.css` + `settingsStyles(namespace)`**：

```js
// src/client/styles/settings.js
export function settingsStyles(namespace) {
  return css.replace(/* 去注释 */).replace(/([^{}]+)\{([^{}]*)\}/g, (_, selectors, declarations) => {
    const scoped = selectors.split(',').map(s => s.trim()).filter(s => s.startsWith(`.${namespace}-`))
    return scoped.length > 0 ? `${scoped.join(',')}{${declarations}}` : ''
  })
}
```

`src/client/styles/settings.css` 是 ab/jdg/smp/sk 四个模块共用的规则（按钮、搜索框、tab、卡片、tag…），
按前缀切片：`settingsStyles('ab')` 只留 `.ab-*`，`settingsStyles('sk')` 只留 `.sk-*`。
**新模块只有复用这批共享规则时才需要它**；notification 是新页面，建议像 usage 一样自带完整 CSS，
不调用 `settingsStyles`（调用 `settingsStyles('ntf')` 只会得到空串）。

CSS 规范（测试强约束；`check.mjs` 另按正则校验 archived 的几何与文案，见 §5.4）：
- 类名统一 `ntf-` 前缀（`usg-` / `sk-` / `jdg-` / `ab-` / `smp-` 同理）；
- 颜色/圆角只用主题变量 `var(--dsw-alias-*)`、`var(--dsw-radius-*)`，**不得出现 `#hex` 或 `rgb()/rgba()`**
  （`tests/usage/client.registration.test.mjs:174-177`、`tests/integration/usage-client.test.mjs:187-189` 会断言）；
- `settings.css` 里也有注释要求「keep module selectors to preserve specificity」。

### 3.4 JSX 约定（全局 `__dshReact` 工厂）

主 bundle 的 esbuild 配置（`scripts/build-client.mjs:71-78`）：

```js
format: 'cjs',
external: ['react', 'react/*', '@deepseek-ai/*'],
jsxFactory: '__dshReact.createElement',
jsxFragment: '__dshReact.Fragment',
loader: { '.js': 'jsx', '.css': 'text' },
```

推论（务必遵守）：

1. **所有 JSX 都编译成 `__dshReact.createElement(...)`**，所以运行到 JSX 之前 `globalThis.__dshReact`
   必须是 React。工厂入口第一件事：
   ```js
   const React = require('react')
   globalThis.__dshReact = React
   ```
   这就是「工厂形式」存在的根本原因（`src/modules/usage/client/index.jsx:5-8` 注释说得很清楚）。
2. 含 JSX 但走命名空间导出的模块（browser/judgment）靠一个副作用模块提前设全局：
   ```js
   // src/modules/judgment/client/react.js
   import React from 'react'
   globalThis.__dshReact = React
   export default React
   ```
   然后 `import './react.js'` 放在入口第一行。**不要**用模块内的 `import React from 'react'` 绑定来写
   JSX——打包后会被重命名，全局工厂拿不到。
3. 扩展名：`.jsx` 用 esbuild 默认 jsx loader；`.js` 也被 `loader: {'.js':'jsx'}` 当 JSX 解析。
   `build-client.mjs` 的 `sourcePlugin()` 只为 **archived**（`React.createElement`）和 **mobile**
   （`h`/`Fragment` + `__CLIENT_CSS__` 占位符替换）准备了**模块专属 onLoad**；usage/browser/judgment
   的 `.jsx` 走默认 loader。**notification 用默认 loader 即可，无需改 build-client 的 JSX 部分。**
4. 测试侧同理：`node --import ./scripts/jsx-register.mjs` 用 esbuild 把 `.jsx` 转成
   `__dshReact.createElement`（`scripts/jsx-hooks.mjs`），所以测试**可以直接 `import` `.jsx` 文件**，
   但必须自己先 `globalThis.__dshReact = React`（见 `tests/usage/client.panel.test.mjs:17`）。
5. esbuild 会把 `/* @__PURE__ */` 注释去掉（build-client 对 mobile 做了显式处理），写代码时别依赖它。

### 3.5 可复用的客户端基础件（`src/client/`）

| 文件 | 用途 | notification 可用场景 |
|---|---|---|
| `config.js` | `findScopedForm` / `scopeForm` / `ROOT_ENTRIES` | 读写自己的配置（必用） |
| `config-write.js` | `acceptConfigWrite(write, field)`：只有显式 `false` 才算拒绝（旧宿主成功返回 `undefined`） | 写配置（必用） |
| `http.js` | `fetchJson(url, {json})`：同源、no-store、懒解析、非 JSON 报错带 `bodyPreview` | 若 notification 走 HTTP（有 host 半时） |
| `poll.js` | `startPolling(task, {intervalMs, onError})`：上次读完才排下一次、AbortController、stop | 若需要定时刷新 |
| `latest-task.js` | 可替换读取的取消（`begin/invalidate`） | 手动刷新按钮防竞态 |
| `ui/stylesheet.js` | `installStylesheet(css, id)` | 装样式（必用） |
| `ui/menu.js` | `measureMenuAnchor` / `anchorStyle` / `listenMenuDismiss` | 下拉/菜单 |
| `ui/confirm-dialog.jsx` | `confirmDialog({primitives, title, description, onCancel, onConfirm, pending, ...})` | 危险操作确认（archived 在用） |
| `styles/settings.{js,css}` | 跨模块共享设置页样式 | 复用共享控件时才用 |

---

## 4. 持久化方案

### 4.1 机制：`configForms` → `findScopedForm` → 投影表单

```
宿主 settings 服务
  └─ ctx.configForms.get('shell-kit')  → ConfigForm（根，包含所有 namespace）
       ├─ form.getSnapshot()  → { value: { notification: {...}, usage: {...}, ... }, status, writable, revision }
       ├─ form.subscribe(listener)
       ├─ form.mutate(operations, revision?)  ← 原子、可批量的写入入口
       └─ form.set(field, value) / form.unset(field)  ← 旧宿主只接受「顶层标量字段」
```

`src/client/config.js:7-43` 的 `scopeForm(form, namespace)` 做三件事：

1. **快照投影**：`getSnapshot()` 返回 `{...snapshot, value: snapshot.value[namespace] ?? {}}`（无 `value`
   包装时直接返回 `snapshot[namespace] ?? {}`），并缓存（root snapshot 引用不变就返回同一对象）；
2. **订阅转发**：`form.subscribe` 或 `form.store.subscribe`；
3. **写入加前缀**：
   ```js
   scoped.set = (path, value, ...args) => form.mutate([{ op: 'set', path: pathOf(path), value }], ...args)
   scoped.unset = (path, ...args)     => form.mutate([{ op: 'unset', path: pathOf(path) }], ...args)
   scoped.mutate = (operations, ...args) => form.mutate(operations.map(op => ({...op, path: pathOf(op.path ?? [])})), ...args)
   ```
   `pathOf` 前面拼 `namespace`，所以页面里 `form.set('enabled', true)` 实际写 `['notification','enabled']`。
   **根表单的 `set/unset` 只接受顶层标量字段**，所以嵌套路径必须走 `mutate`（`tests/integration/client-config.test.mjs:147-195` 有强断言）。

`findScopedForm(ctx, namespace, legacyCandidates=[])`（`src/client/config.js:46-56`）：

```js
for (const entryId of [...ROOT_ENTRIES, ...legacyCandidates]) {
  try {
    const form = ctx?.configForms?.get?.(entryId)
    if (form) return { form: ROOT_ENTRIES.includes(entryId) ? scopeForm(form, namespace) : form, entryId }
  } catch { /* 某些宿主版本对不存在的 entry 抛错 */ }
}
return { form: undefined, entryId: ROOT_ENTRIES[0] }
```

缺失时返回 `{ form: undefined, entryId: 'shell-kit' }`，**不抛错**——页面必须降级成只读展示
（`tests/usage/client.registration.test.mjs:235-253` 专门测这个）。

### 4.2 写回（唯一正确姿势）

```js
import { acceptConfigWrite } from '../../../client/config-write.js'

await acceptConfigWrite(() => form.set('enabled', true), 'enabled')
```

- `acceptConfigWrite`（`src/client/config-write.js`）只在**显式 `false`** 时抛中文错误
  `宿主拒绝了这次写入（<field>）：...`；旧宿主成功返回 `undefined`，不能按 falsy 判断。
- 多个字段逐个写（usage 预算保存就是这样，`src/modules/usage/client/panel.jsx:178-180`）；
  失败时保留编辑器、显示错误、**不重试**（README「异步操作」：写请求不会自动重试；
  客户端停止等待不代表远端已回滚）。
- 更老的宿主回退：`typeof props.mutate === 'function'` 时手工拼
  `props.mutate(entryId, [{op:'set', path: ['notification', field], value}])`
  （见 `src/modules/skills-mcp/client/panel.jsx:356-357`；只在必须兼容旧宿主时加）。

### 4.3 读回（兼容三种快照形状）

```js
// src/modules/usage/client/model.js:311-322 的 readUsageSettings 就是标准范本
export function readNotificationSettings(snapshot) {
  let root = snapshot
  if (root && typeof root === 'object' && 'value' in root) root = root.value
  if (root && typeof root === 'object' && root.notification !== undefined) root = root.notification
  // ...字段校验 + 默认值
}
```

订阅刷新（推荐用 `React.useSyncExternalStore` 或 `useEffect + subscribe`）：

```js
const snapshot = form?.getSnapshot?.()   // 可能抛错，包 try/catch
// { value: { enabled, sound, ... }, status: 'ready', writable: true, revision: 12 }
```

### 4.4 有没有模块直接用 localStorage？

**没有。** 对 `src/` 全目录 grep `localStorage|sessionStorage`：0 处。配置持久化 100% 走
`configForms`（宿主配置文档），会话/工作区数据走 host 服务，磁盘数据走 host 模块自己的文件读写。

### 4.5 推荐给 notification 的最不侵入方案

| 方案 | 侵入性 | 结论 |
|---|---|---|
| `ctx.configForms` + 根 `notification` 命名空间（volatile 字段） | 低（1 处 schema + 1 处 client） | ✅ **推荐**。与 usage/browser/judgment 一致；跨窗口一致、HMR/重启后仍在、宿主负责原子写与校验回执。 |
| localStorage | 低但游离 | ❌ 不要。全仓库无先例；会与宿主配置文档形成两个真相源；多窗口不同步；测试要 mock 存储。 |
| 自己起 host 路由 + 文件 | 高 | 只在需要「非配置数据」（缓存、历史记录）时才做，且必须加 host 半与鉴权路由。 |

---

## 5. 构建 / 验证流水线

### 5.1 package.json 关键字段

```jsonc
{
  "type": "module",
  "main": "index.js",                         // 兼容入口 → lib/index.js
  "exports": {
    ".": "./index.js",
    "./client": "./lib/client.js",            // dsh.client 的入口
    "./contract": "./lib/modules/judgment/host/contract/index.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [                             // 允许 require() 的宿主模块表
        "@deepseek-ai/dsh-client-ui-settings",
        "@deepseek-ai/dsh-client-ui-primitives",
        "@deepseek-ai/dsh-api-remotes",
        "@deepseek-ai/dsh-client-ui-renderer",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-ui-sidebar-right",
        "@deepseek-ai/dsh-client-shortcuts"
      ]
    }
  },
  "files": [
    "index.js", "lib",
    "!lib/modules/*/client.js",               // 各模块 harness bundle 不进安装包
    "!lib/.build-manifest.json",
    "skills", "cordis.patch.yml", "README.md", "LICENSE"
  ],
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:host": "node scripts/build-host.mjs",
    "build:client": "node scripts/build-client.mjs",
    "build:check": "node scripts/build.mjs --check",
    "typecheck": "tsc --noEmit",
    "test": "node scripts/test.mjs",
    "check": "node scripts/check.mjs",
    "verify": "node scripts/build.mjs && tsc --noEmit && node scripts/check.mjs && node scripts/test.mjs && node scripts/build.mjs --check"
  },
  "peerDependencies": { /* 所有 @deepseek-ai/*，全部可选 */ },
  "peerDependenciesMeta": { /* 每个都 { "optional": true } */ }
}
```

`cordis.patch.yml`（5 行，**新增模块不需要改**）：

```yaml
# Keep the profile row id so existing module settings remain attached.
- insert:
    - id: shell-kit
      name: dsh-toolkit
```

### 5.2 `pnpm build` 做了什么

`scripts/build.mjs` = `buildHost()` + `buildClient()`。

**`build-host.mjs`**（写 `lib/`）：
1. 用 `typescript` 读 `tsconfig.json`，`createProgram` + `emit` 到内存（`outDir: lib`）；
   `tsconfig.include` 只有 browser/judgment 的 host TS → **其它目录的 TS 不会被编译**；
2. 原样复制 `src/index.js`、`src/host/**`（含手写 `.d.ts`）、以及每个 `src/modules/*/host/**`
   下的非 `.ts` 文件（boot.css/html/js 走这条）；
3. **陈旧检测**：遍历 `lib/`，任何不是本次产物的 host 文件都报
   `Unexpected generated host file: lib/...; remove the stale output explicitly`；
   例外：`lib/client.js`、`lib/modules/*/client.js`、`lib/.build-manifest.json`；
4. 非 `--check` 时写盘；`--check` 时逐文件比较（Buffer 相等）。

**`build-client.mjs`**（写 `lib/client.js` + `lib/modules/<m>/client.js`）：
1. 主 bundle：`entryPoints: ['src/client/index.js']`，`id: 'dsh-toolkit'`，包成
   `window.__ModuleLoader__.load({ id, factory(require) { ... } })` 的经典脚本（`format: 'cjs'`）；
2. `clients` 数组逐个生成**模块 harness bundle**（供模块自己的回归测试用，安装方不加载）：

   ```js
   const clients = [
     ['theme', 'dsh-toolkit/theme', 'index.js', false],
     ['archived', 'dsh-toolkit/archived', 'index.js', false],
     ['browser', '@j62268781-alt/dsh-agent-browser', 'index.jsx', false],
     ['judgment', 'dsh-judgment', 'index.jsx', false],
     ['mobile', '@j62268781-alt/dsh-sidebar-mobile', 'index.jsx', true],
     ['skills-mcp', '@j62268781-alt/dsh-skills-mcp-manager', 'client.js', true],
   ]   // [目录名, loader id, 入口文件名, 是否工厂(createX(require))]
   ```

   注意 **usage 不在这个数组里**——它是唯一没有 harness bundle 的客户端模块，
   `tests/usage/client.registration.test.mjs` 自己用 esbuild 现场打包入口。
3. `--check` 时比较字符串完全相等，不等就 `throw new Error('${path} is stale; run pnpm build')`。

### 5.3 `--check` 的陈旧规则（lib/ 是提交物，不能手改）

| 产物 | 由谁生成 | `--check` 规则 |
|---|---|---|
| `lib/index.js`、`lib/host/**`、`lib/modules/*/host/**` | build-host | 生成集合必须与 `lib/` 现有文件集合**双向一致**；内容 Buffer 相等 |
| `lib/client.js` | build-client（主 bundle） | 内容字符串完全相等 |
| `lib/modules/*/client.js` | build-client（clients 数组） | 内容字符串完全相等；集合外的额外文件**不会**被报错（build-host 跳过这些路径） |

实践含义：
- 新增/删除/重命名任何 `src/host`、`src/modules/*/host`、`src/client`、`src/modules/*/client` 源文件后，
  必须 `pnpm build` 重新生成并把 `lib/` 一起提交；只改文档/测试不影响。
- **永远不要手改 `lib/`**（`index.js:1` 与 `build-client.mjs:80` 都写了「Generated ...; edit src/ instead」）。
- `pnpm build` 先 host 后 client；只改客户端时可 `pnpm build:client` 快速迭代。
- 客户端半改动**不需要重启 DSH**（client HMR 换包）；host 半改动需要重启桌面应用
  （README:24，`docs/usage/README.md:138-144`）。

### 5.4 其余命令各自验证什么

| 命令 | 内容 |
|---|---|
| `pnpm typecheck` | `tsc --noEmit`，只检查 `tsconfig.include` 的两个 host TS 目录（browser/judgment）。纯 JS/JSX 模块**不受影响**；若加 TS host 文件必须加 include。 |
| `pnpm check` | `scripts/check.mjs`：① `import('../index.js')` 断言包名/`apply`/`Config`/`inject===[]`；② `new Script(lib/client.js)` 语法检查 + **恰好一个** `window.__ModuleLoader__.load` + `id: "dsh-toolkit"` + 无 `__CLIENT_CSS__/__SVG:` 残留；③ 对 `lib/**/*.js` 与 `scripts/**/*.mjs` 逐个 `node --check`；④ archived 的 CSS 几何/中文文案正则（**别改 archived 文案**）；⑤ `verify-client.mjs` 主题契约；⑥ `tests/skills-mcp/helpers/undefined-check.mjs`。 |
| `pnpm test` | `scripts/test.mjs`：`node --import ./scripts/jsx-register.mjs --test --test-reporter=spec` + **5 个固定分组** + mobile harness（隔离临时 `DSH_HOME`）。 |
| `pnpm verify` | build → typecheck → check → test → build --check（CI 等价线；全新克隆跑这一条即可）。 |

### 5.5 加一个模块时「必须改的构建相关文件」

| 文件 | 必须？ | 改什么 |
|---|---|---|
| `src/client/index.js` | ✅（有 client 半） | import + `ctx.plugin({ name, ...createX(require) })` |
| `src/host/config.js` | ✅（要持久化配置） | 加 `notification` 命名空间 |
| `src/index.js` | 仅 host 半 | `import * as notification` + `ctx.plugin(notification, config.notification)` |
| `scripts/build-client.mjs` 的 `clients` | 可选 | 加一行 `['notification', 'dsh-toolkit/notification', 'index.jsx', true]` → 产出 `lib/modules/notification/client.js`（测试/回归用；安装包排除） |
| `package.json` `dsh.client.inject` | 仅新依赖 | 每 `require('@deepseek-ai/...')` 一个新包就必须加进数组，否则运行时 `require` 拿不到 |
| `package.json` `devDependencies` | 仅新依赖 | 构建/类型检查要用 |
| `package.json` `peerDependencies` + `peerDependenciesMeta` | 仅新依赖 | 每个 `@deepseek-ai/*` 一个字符串范围 + `{"optional": true}`；`tests/integration/runtime-dependencies.test.mjs` 强制 |
| `pnpm-lock.yaml` | 仅新依赖 | `pnpm install` 更新 |
| `tsconfig.json` `include` | 仅 TS host | 加 `src/modules/notification/host/**/*.ts` |
| `cordis.patch.yml` | ❌ | 一个 bundle 一行，模块不单独挂载 |
| `package.json` `exports` / `files` | ❌ | 客户端代码全部进 `lib/client.js` |

> 如果引入**新**的 `@deepseek-ai` 包，最省事的做法是**别引入**：优先复用 `dsh.client.inject` 里已有的
> 7 个包（primitives / locale / settings / remotes …）。引入一个就要同时改 4 处 package.json 字段 + 锁文件。

### 5.6 当前工作树观察（重要，仅作提醒）

勘测时（2026-11-03 22:2x）工作树**已有未提交改动**：`src/modules/usage/**`、`tests/usage/**`、
`docs/usage/**`、`src/client/index.js`、`src/host/config.js`、`src/index.js`、`README.md`、
`scripts/test.mjs` 等（`git status` 可见），且 `src/modules/archived/client/*` 在勘测期间仍在被修改。
在此状态下跑 `node scripts/build.mjs --check` 报 `lib/client.js is stale; run pnpm build` ——
这是**未重建**的结果，不是本笔记造成的。团队最终验证前必须先 `pnpm build` 再 `pnpm verify`，
并把 `lib/` 的变更一起纳入提交。

---

## 6. 测试

### 6.1 分组与发现规则（关键陷阱）

`scripts/test.mjs:16-22`：

```js
for (const group of ['browser', 'judgment', 'skills-mcp', 'usage', 'integration']) {
  for (const name of (await readdir(join(root, 'tests', group))).sort()) {
    if (name.endsWith('.test.mjs')) testFiles.push(`tests/${group}/${name}`)
  }
}
await run(['--import', './scripts/jsx-register.mjs', '--test', '--test-reporter=spec', ...testFiles])
```

- **只有这 5 个目录**、**只收本层** `*.test.mjs`（不递归）；`tests/mobile/test-harness.mjs` 单独跑。
- `tests/X/**/*.mjs` 里的非 `.test.mjs` 文件（fixture/harness）不会被当测试。
- 因此：
  - 放 **`tests/integration/notification-*.test.mjs` → 零脚本改动**，`pnpm test` 一定执行（推荐）；
  - 放 `tests/notification/*.test.mjs` → **必须**把 `'notification'` 加进上面数组，否则静默跳过。
- 测试目录现有规模：`tests/browser` 7、`tests/judgment` 9、`tests/skills-mcp` 65、
  `tests/usage` 10 + `fixture.mjs`、`tests/integration` 15、`tests/mobile` 3 个 harness（见 §9）。

### 6.2 三种客户端测试形态

| 形态 | 代表文件 | 测什么 | 依赖 |
|---|---|---|---|
| ① 纯函数单测 | `tests/usage/client.model.test.mjs` | `model.js` 的格式化/几何/排序 | 无 DOM，直接 `import` |
| ② 入口注册契约（esbuild 现场打包） | `tests/usage/client.registration.test.mjs` | 工厂 + 全局 React + inject + effect 标签 + 词典 + 样式 + `settings.section` 元数据 + 挂载渲染 | jsdom + esbuild + react-dom/client |
| ③ 真实产物集成（`lib/client.js` in vm） | `tests/integration/usage-client.test.mjs`、`tests/integration/client-composition.test.mjs` | 打包后子插件顺序、inject 守卫、DOM 延迟访问 | `node:vm` sandbox + 手写 fake `window.__ModuleLoader__` |

Host 半另有两种：`tests/usage/host.*.test.mjs`（纯函数/host 工具）与
`tests/integration/usage-route.test.mjs`（**真 Cordis `Context` + `ctx.plugin`**，最接近真机）。

### 6.3 复制哪一套骨架

**首选 `tests/usage/client.registration.test.mjs`（253 行）**，几乎逐字替换即可：

```js
/**
 * notification 注册契约测试：用 esbuild 按主 bundle 的同一套 jsxFactory 打包，
 * 断言工厂/全局 React/样式/文案/settings.section 元数据，并把真实 Component 挂进 jsdom 跑一次。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React, { act } from 'react'
import { NOTIFICATION_COPY, NOTIFICATION_NS } from '../../src/modules/notification/client/locale.js'

async function loadNotificationModule() {
  const result = await build({
    entryPoints: ['src/modules/notification/client/index.jsx'],
    bundle: true, platform: 'node', format: 'esm', target: 'node20',
    external: ['react', 'react/*', '@deepseek-ai/*'],
    jsxFactory: '__dshReact.createElement', jsxFragment: '__dshReact.Fragment',
    loader: { '.js': 'jsx', '.css': 'text' },
    write: false, logLevel: 'silent',
  })
  await mkdir('node_modules/.cache', { recursive: true })
  const out = 'node_modules/.cache/notification-client-registration.mjs'
  await writeFile(out, result.outputFiles[0].text)
  return import(`../../${out}?v=${Date.now()}`)
}

function createCtx({ withConfigForms = true } = {}) { /* 照抄 usage：effect/locale/slots/configForms 假实现 */ }

test('createNotification 工厂：全局 React、inject、词典/样式/页面注册与清理', async () => {
  const module = await loadNotificationModule()
  const createNotification = module.default
  const client = createNotification((id) => { assert.equal(id, 'react'); return React })
  assert.equal(globalThis.__dshReact, React)
  assert.equal(client.name, 'toolkit-notification-client')
  assert.deepEqual(Array.from(client.inject), ['slots', 'locale', 'configForms'])
  // 断言 effect 标签顺序：dictionary → stylesheet → section
})
```

要点（照抄时别漏）：
- 在调用工厂**之前**断言 `globalThis.__dshReact === undefined`（证明工厂负责设置它）；
- 断言 `state.effects` 的标签序列（集成测试按标签断言）；
- 断言 `style[data-plugin="toolkit-notification"]` 存在、含 `ntf-`、无硬编码色值；
- 断言 section `id/order/locale/label`，`label()` 走词典（不是硬编码）；
- 卸载后样式被 effect 清理（`for (const teardown of state.cleanups.reverse()) teardown()`）；
- 再补一个「`configForms` 缺失 → 页面只读、不崩溃」用例。

**如需页面渲染细节**：另加 `tests/integration/notification-panel.test.mjs`，照抄
`tests/usage/client.panel.test.mjs`（jsdom + `act` + 真实 DOM 事件；注意 `react-dom/client` 必须在
jsdom 全局就位**之后**动态 `import`，否则 `onChange` 不触发——该文件 56-60 行有注释）。

**如需打包产物集成**：照抄 `tests/integration/usage-client.test.mjs`（vm 里跑 `lib/client.js`，
断言子插件数量/顺序/inject/设置页注册/样式安装）。这类测试直接依赖 `lib/client.js`，
**必须先 `pnpm build`**。

### 6.4 测试能不能 import `.jsx`？能。

`node --import ./scripts/jsx-register.mjs` 注册 `scripts/jsx-hooks.mjs` 的 ESM loader，
把 `.jsx` 用 esbuild 转成 `__dshReact.createElement`（`format: 'esm'`, `target: 'node20'`）。
所以测试里可以：

```js
import { createUsagePanel } from '../../src/modules/usage/client/panel.jsx'
globalThis.__dshReact = React   // 必须先设
```

但 **`.css` 不能在 node 里直接 import**：必须像 ② 那样先用 esbuild（`loader: {'.css':'text'}`）
把入口打包到 `node_modules/.cache/` 再动态 import；这也是 ② 存在的原因。
`node_modules/.cache` 已被忽略/可写，测试可以放心往那里写临时产物。

### 6.5 加模块后必须同步的**既有**测试（硬编码集合）

| 文件 | 断言 | 加 notification 后要改什么 |
|---|---|---|
| `tests/integration/client-composition.test.mjs` | `EXPECTED_INJECT`（7 项）、`IMMEDIATE_EFFECTS`、`children.length === 7`、设置页 id 集合、`expected` 元数据表、缺 `configForms` 时的 pending 列表、若干 `sections.length` | 加 `'toolkit-notification-client': ['slots','locale','configForms']`；加 effect 标签 `toolkit-notification:dictionary` / `:section`（样式 effect 依赖 DOM，不放进 IMMEDIATE_EFFECTS）；数量 7→8、设置页集合加 `notification`、pending 列表加 notification、sections 计数 +1 |
| `tests/integration/usage-client.test.mjs` | `children.length === 7`、`children[6]` 是 usage | 数量 7→8；**把 notification 追加在 usage 之后**，`children[6]` 仍是 usage |
| `tests/integration/host-composition.test.mjs:68` | 根配置键排序数组（9 个） | 加 `'notification'`；可顺手断言 `isVolatile(config.notification) === false`、各叶子 `true` |
| `tests/integration/runtime-dependencies.test.mjs` | 每个 devDep 的 `@deepseek-ai/*` 都要有 peer + optional | 仅引入新包时自动覆盖（不用改，但要满足） |
| `scripts/check.mjs` | 无模块数量断言；但会 `node --check` 全部 `lib/**`、并断言 client.js 只有一个 loader | **无需改**，但要先 build 否则 lib 陈旧 |
| `tests/integration/split-modules.test.mjs` | 只针对 archived/mobile 产物 | 若给 notification 加了 harness bundle，可照它加一个 vm 用例（可选） |

---

## 7. 约定清单（新模块逐条对照）

**命名**
- 目录：`src/modules/notification/`（kebab-case，与功能同名）。
- Host 插件名：`toolkit-notification`；Client 插件名：`toolkit-notification-client`。
- effect 标签：`toolkit-notification:<aspect>`（`dictionary` / `stylesheet` / `section` / …）。
- 设置页 `id`：`notification`；order：`24`；locale 命名空间：`dsh-toolkit.notification`。
- CSS 前缀：`ntf-`（3 字母，参考 `usg-`/`sk-`/`jdg-`/`ab-`/`smp-`）；样式节点 id：`toolkit-notification`。
- 配置命名空间 / `findScopedForm` 第二参 / 根 Config 键：**三者必须字面一致**。

**注释与文档**
- 文件头写**中文**块注释：这个文件负责什么、契约在哪、为什么这么写（现有模块全这样）。
- Host 入口注明 `Contract: docs/notification/README.md`（usage 的写法：`src/modules/usage/host/index.js:2`）。
- 模块契约放 `docs/notification/README.md`，格式照 `docs/usage/README.md`
  （目标 → Host 端 → Client 端 → HTTP → 根配置表 → 生效方式 → 验收）。
- 解释「为什么」，不要写「做了什么」式的废话注释；不写 emoji。

**错误处理**
- `apply` 绝不向外抛：每个可选注册包 `try/catch`，失败 `console.warn('[notification] ...', error)`
  （usage 的 `install()` 是标准写法，`src/modules/usage/client/index.jsx:39-49`）。
- 可选服务守卫用 `typeof ctx.x?.y === 'function'` / `ctx.x?.register?.(...)`，缺失就**降级**而不是崩：
  - 无 `locale` → 内置中文表；
  - 无 `configForms` → 页面只读 + 提示文案；
  - 无 `document` → 样式 effect 返回 no-op；
  - 缺 primitives → `confirmDialog` 返回 `null`，调用方退回原生 `confirm`。
- 宿主拒绝写入：`acceptConfigWrite` 统一处理（只有显式 `false` 才是拒绝）。
- 数据解析失败：保留上一份数据 + 错误行，不清空页面（用 `try/catch` 包 `JSON`/`fetch` 解析）。
- 不要吞掉真正需要暴露的错误：入口注册失败只 warn；数据/契约错误要在 UI 上显示原因。

**结构**
- 纯逻辑进 `model.js`（可单测），DOM/React 进 `panel.jsx`/子组件，装配进 `index.jsx`。
- 所有副作用进 `ctx.effect(run, label)`；不要用裸 `setTimeout`/全局监听而不清理。
- 样式只用主题变量；不自造颜色；不依赖外部 CSS 文件路径（全部打进 bundle）。
- 需要 `require` 的模块必须用工厂入口；命名空间导出只用于无 `require` 的纯 DOM/JSX 模块。
- 不在 client 半访问宿主文件系统 / 起进程 / 写 patch（那是 host 半的职责）。

---

## 8. 「加 notification 模块」编辑配方（有序）

> 假设：纯客户端 + 一个设置页 + 需要持久化少量开关（走根配置命名空间）。
> 不新建 host 半、不改 `src/index.js`、不改 `cordis.patch.yml`。

### 第 0 步：创建模块目录（5 个文件）

```
src/modules/notification/client/index.jsx
src/modules/notification/client/locale.js
src/modules/notification/client/model.js
src/modules/notification/client/panel.jsx
src/modules/notification/client/styles.css
```

各自照抄：
- `locale.js` ← `src/modules/usage/client/locale.js`（改 NS / 文案）；
- `model.js` ← `src/modules/usage/client/model.js` 的纯函数风格；
- `panel.jsx` ← `src/modules/usage/client/panel.jsx` 的 `createXPanel(React, options)` 工厂 + hooks 风格；
- `styles.css` ← `src/modules/usage/client/styles.css`（改前缀 `usg-` → `ntf-`，保留只读主题变量约定）；
- `index.jsx` ← 见下。

### 第 1 步：写 `src/modules/notification/client/index.jsx`（新增）

```jsx
/**
 * Client half of the notification module.
 * Contract: docs/notification/README.md.
 *
 * 与 usage/mobile 同一套「工厂 + 全局 JSX」模式：主 bundle 的 jsxFactory 是
 * `__dshReact.createElement`，所以工厂里先 `globalThis.__dshReact = require('react')`。
 */
import css from './styles.css'
import { installStylesheet } from '../../../client/ui/stylesheet.js'
import { findScopedForm } from '../../../client/config.js'
import { NOTIFICATION_NS, NOTIFICATION_COPY, createTranslator } from './locale.js'
import { createNotificationPanel } from './panel.jsx'

/** 宿主 locale 的语言提示（拿不到就用运行时默认 locale）。 */
function localeHint(ctx) {
  try {
    const language = ctx?.locale?.language
      ?? (typeof ctx?.locale?.getLanguage === 'function' ? ctx.locale.getLanguage() : undefined)
      ?? ctx?.locale?.lang
    return typeof language === 'string' && language !== '' ? language : undefined
  } catch {
    return undefined
  }
}

export default function createNotification(require) {
  const React = require('react')
  globalThis.__dshReact = React

  return {
    name: 'toolkit-notification-client',
    inject: ['slots', 'locale', 'configForms'],
    apply(ctx) {
      // 表单在注册时解析一次；缺失时页面只读展示（不抛错）。
      const { form, entryId } = findScopedForm(ctx, 'notification')
      const t = createTranslator(ctx, localeHint(ctx))
      const Panel = createNotificationPanel(React, { form, entryId, t, locale: localeHint(ctx) })
      const install = (run, label) => {
        try {
          if (typeof ctx.effect === 'function') return ctx.effect(run, label)
          return run()
        } catch (error) {
          try { console.warn(`[notification] 安装 ${label} 失败：`, error) } catch {}
          return undefined
        }
      }

      install(() => {
        try { return ctx.locale?.register?.(NOTIFICATION_NS, NOTIFICATION_COPY) } catch { return undefined }
      }, 'toolkit-notification:dictionary')

      install(() => {
        if (typeof document === 'undefined') return () => {}
        return installStylesheet(css, 'toolkit-notification')
      }, 'toolkit-notification:stylesheet')

      install(() => {
        if (typeof ctx.slots?.inject !== 'function' || typeof ctx.slots?.register !== 'function') return undefined
        return ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'notification',      // 排在 usage-tokens(23) 之后
          order: 24,
          label: () => t('nav'),
          locale: NOTIFICATION_NS,
        }, Panel))
      }, 'toolkit-notification:section')
    },
  }
}
```

> 若页面需要官方 UI primitives：不要新增命名空间导入，改成
> `const primitives = (() => { try { return require('@deepseek-ai/dsh-client-ui-primitives') } catch { return null } })()`，
> 并把 `primitives` 作为 `inject: () => ({ ... })` 传给组件（skills-mcp 的写法，`src/modules/skills-mcp/client/client.js:9-15`）。
> 该包已在 `dsh.client.inject` 里，无需改 package.json。

### 第 2 步：注册到 `src/client/index.js`（改 1 个文件，2 行）

```js
import createUsage from '../modules/usage/client/index.jsx'
import createNotification from '../modules/notification/client/index.jsx'   // 新增

export function apply(ctx) {
  /* ...既有 7 行不动... */
  ctx.plugin({ name: 'toolkit-usage-client', ...createUsage(require) })
  // 新增：放最后，既有子插件下标不变（usage-client.test.mjs 依赖 children[6]）
  ctx.plugin({ name: 'toolkit-notification-client', ...createNotification(require) })
}
```

### 第 3 步：加配置命名空间 `src/host/config.js`（改 1 个文件）

```js
export const Config = s.object({
  /* ...既有 9 个键保持原样... */
  // 纯客户端模块：命名空间只用于设置页读写；每字段必须 .volatile()，否则设置页写不进去。
  notification: s.object({
    enabled: s.boolean().default(true).volatile(),
    // ...其余可写字段
  }).default({}),
})
```

### 第 4 步：创建测试

推荐路径（零脚本改动）：`tests/integration/notification-client.test.mjs`
（照抄 `tests/usage/client.registration.test.mjs`；断言见 §6.3）。

如果要独立目录：创建 `tests/notification/client.registration.test.mjs` **并**在
`scripts/test.mjs:16` 的数组里加 `'notification'`：

```js
for (const group of ['browser', 'judgment', 'skills-mcp', 'usage', 'integration', 'notification']) {
```

### 第 5 步：创建模块文档

`docs/notification/README.md`（契约，格式照 `docs/usage/README.md`）：
目标 → Client 端（目录/入口/设置页 id/order/locale/样式前缀）→ 持久化（根配置字段表 + 默认值 + volatile）
→ 生效方式 → 验收命令。**本文件 `toolkit-notes.md` 只作为约定参考，不替代契约。**

### 第 6 步：同步既有测试（3 个文件）

1. `tests/integration/client-composition.test.mjs`
   - `EXPECTED_INJECT` 加 `'toolkit-notification-client': ['slots', 'locale', 'configForms']`；
   - `IMMEDIATE_EFFECTS` 加 `'toolkit-notification:dictionary'`、`'toolkit-notification:section'`；
   - `children.length === 7` → `8`；`children.map(name)` 数组末尾加 `toolkit-notification-client`；
   - 设置页集合 `['archived-chats','browser','judgment','skills-mcp','usage-tokens']` 加 `'notification'`；
   - `expected` 表加 `notification: { namespace: 'notification', order: 24, label: '通知' }`
     （注意这是**配置命名空间**，usage/archived 这两项用 locale 名空间，写法不同）；
   - 缺 `configForms` 的 pending 列表、`sections.length` 等数量断言 +1。
2. `tests/integration/usage-client.test.mjs`
   - `children.length === 7` → `8`；`children[6]` 仍是 usage（因为新模块追加在最后）。
3. `tests/integration/host-composition.test.mjs:68`
   - 根配置键数组加 `'notification'`；可选补 `isVolatile(config.notification) === false` 与叶子断言。

### 第 7 步：同步文档/清单

- `README.md`：首段模块列表加「通知」；「配置」yaml 示例加 `notification:`；
  （如适用）「HTTP 路由」/「外部工具」段落。
- `package.json`：`description` 可补一句（非必须）；**仅当**新增 `@deepseek-ai/*` 依赖时才改
  `devDependencies` / `peerDependencies` / `peerDependenciesMeta` / `dsh.client.inject`，并 `pnpm install`。
- 可选：`scripts/build-client.mjs` 的 `clients` 加
  `['notification', 'dsh-toolkit/notification', 'index.jsx', true]`（要 `lib/modules/notification/client.js`
  做隔离 harness 时才需要；usage 就没加）。

### 第 8 步：构建 + 全量验证 + 提交产物

```sh
pnpm build          # 重新生成 lib/client.js（必须提交；禁止手改 lib/）
pnpm verify         # = build && typecheck && check && test && build --check
```

若工作树里还有别的未提交改动（见 §5.6），先确认 `pnpm build` 的产物范围，避免把别人的中间状态
一起生成进 `lib/`。

### 第 9 步（仅当确实需要 host 半）

照 `src/modules/usage/host/` 补：

```
src/modules/notification/host/index.js     # name/inject/Config?/apply + default 汇总
src/modules/notification/host/config.js    # 可选：schemastery（若根 schema 改为 import）
src/modules/notification/host/paths.js     # 路由常量 '/_dsh/dsh-toolkit/notification/...'
src/modules/notification/host/route.js     # registerAuthenticatedRoute(ctx, {kind:'exact', path, handler})
src/modules/notification/host/snapshot.js  # 纯函数组装 payload（可单测）
```

并：
- `src/index.js` 加 import + `ctx.plugin(notification, config.notification)`（用 `configuredPlugin` 包装）；
- `src/host/config.js` 改为 `import { Config as NotificationConfig } ...; notification: NotificationConfig.default({})`；
- 路由一律 `registerAuthenticatedRoute`（身份/来源校验）；OAuth 类回调才用 `registerRoute`；
- 错误响应 `sendJson(res, 500, { ok:false, error })`，`cache-control: no-store`，非 GET 404，
  handler 绝不向服务器抛错（`src/modules/usage/host/route.js` 是范本）；
- 测试照 `tests/integration/usage-route.test.mjs`（真 Cordis Context）；
- 若用 TS：加 `tsconfig.json` include，`build-host` 会 emit `.d.ts`；否则纯 JS 不用 `.d.ts`。

---

## 9. 证据索引（便于复核）

- 包/构建：`package.json`、`cordis.patch.yml`、`index.js`、`tsconfig.json`、`scripts/{build,build-host,build-client,check,test,verify-client,jsx-register,jsx-hooks}.mjs`
- Host 中枢：`src/index.js`、`src/host/{config,plugins,routes,http}.js`、`src/host/*.d.ts`
- Client 中枢：`src/client/{index,config,config-write,http,poll,latest-task}.js`、`src/client/ui/{stylesheet,menu,confirm-dialog}*`、`src/client/styles/settings.{js,css}`
- 范例模块：`src/modules/usage/**`（最新、最完整）、`src/modules/archived/client/**`（命名空间导出 + locale + settingsStyles）、`src/modules/theme/client/index.js`（纯客户端）
- 既有测试：`tests/usage/**`、`tests/integration/{client-composition,client-config,usage-client,usage-route,host-composition,runtime-dependencies,split-modules}.test.mjs`
- 文档范例：`docs/usage/README.md`（契约）、`docs/boot/README.md`
- 测试文件全量清单见 §6.1 的分组说明与本节目录；`tests/` 下共 5 个测试分组 + `tests/mobile` 3 个 harness 文件。
