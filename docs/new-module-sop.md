# 新增一个模块（SOP）

按顺序做，每步都能单独验证。目录约定见 [AGENTS.md](../AGENTS.md) §5。

## 0. 先决定形态

| 形态 | 什么时候用 | 要动的地方 |
| --- | --- | --- |
| 聚合内模块（默认） | 只是多一个设置面板 / 多一组工具 | 建目录 + 两个入口注册 |
| 独立包（`packages/<m>/`） | 需要被单独安装、单独发版 | 额外 4 处：包清单、包补丁、`PACKAGE_MODULES`、独立 client bundle |

十个现有模块都是独立包，所以两条路最终都要走；先按「聚合内模块」把功能跑通，再补包。

## 1. 建骨架

```text
src/modules/<m>/host/
  index.ts          # 装配：name / inject / apply
  constants.ts      # 路由路径等纯常量（无 import，client 也会求值）
  config.ts         # 可选：schemastery Schema
  routes/<组>.ts    # 协议适配（只有需要 HTTP 时）
  <domain>/         # 领域 + 纯 I/O
src/modules/<m>/client/
  index.ts          # 装配：inject / apply
  locale.ts         # 本模块字典 {NS, COPY}（有文案时）
  surfaces/<挂载点>/index.tsx (+ style.css)
  model.ts          # 可选：纯投影
```

`src/modules/<m>/host/index.ts` 最小形态：

```ts
import { registerJsonRoutes } from '../../../host/routes.js'
import { createFooRoutes } from './routes/foo.js'

export const name = 'dsh-toolkit-<m>'
export const inject = ['webServer', 'connection']

export function apply(ctx: any): void {
  registerJsonRoutes(ctx, createFooRoutes())
}

export default { name, inject, apply }
```

- `name` 必须是 `dsh-toolkit-<m>`（与包名、`cordis.patch.yml` 的 id 一致）。
- `inject` 的顺序会被测试断言，写完不要随手调整。
- 路由前缀用 `pluginApiPath('<m>')`（`src/host/paths.ts`），不要手写字符串。

`src/modules/<m>/client/index.ts` 最小形态：

```ts
import { installSlot } from '../../../client/ui/slot.js'
import * as settings from './surfaces/settings/index.js'

export const inject = ['slots', 'locale']

const SURFACES = [settings]

export function apply(ctx: any): void {
  for (const surface of SURFACES) {
    ctx.effect(() => surface.install(ctx), `dsh-toolkit-<m>:${surface.NAME}`)
  }
}
```

## 2. 注册（聚合内，两处）

| 文件 | 加什么 |
| --- | --- |
| `src/index.ts` | `import * as foo from './modules/<m>/host/index.js'` + `ctx.plugin(foo, config.<m>)` |
| `src/client/index.ts` | `import createFoo from '../modules/<m>/client/index.jsx'` + `ctx.plugin({ name: 'dsh-toolkit-<m>-client', ...createFoo(require) })` |

**client 的 `ctx.plugin` 必须追加在列表最后**：集成测试按 `children[i]` 断言顺序。

如果模块有可配项，还要在 `src/host/config.ts` 的 `s.object({...})` 里加一行 `<m>: FooConfig`。

## 3. 注册（独立包，四处）

1. `packages/<m>/package.json` —— 复制 `packages/archived/package.json` 改 `name` / `description` /
   `dsh.client.inject`（宿主侧依赖的服务名）；`client.platform` 与 `immediately` 按需。
2. `packages/<m>/index.js` —— 包装层，`export * from './lib/modules/<m>/host/index.js'`，
   并把 `name` 固定成 `dsh-toolkit-<m>`。
3. `packages/<m>/cordis.patch.yml` —— 只有一条 `insert: [{ id: dsh-toolkit-<m>, name: dsh-toolkit-<m> }]`。
4. `cordis.patch.yml`（根） —— 在 `insert` 列表里加同一条。

pnpm workspace 已覆盖 `packages/*`，不需要改 `pnpm-workspace.yaml`。

## 4. 构建脚本（两处）

| 文件 | 加什么 | 什么时候 |
| --- | --- | --- |
| `scripts/package-layout.mjs` | `PACKAGE_MODULES` 里加 `{ name: '<m>', client: { entry: 'src/modules/<m>/client/index', factory: false }, skills: [] }` | 有独立包 |
| `scripts/build-client.mjs` | `clients` 数组里加 `['<m>', '<npm 名>', 'src/modules/<m>/client/index', false]` | 需要独立 client bundle |

`PACKAGE_MODULES` 的 `client.entry` **不写扩展名**：`resolveSourceEntry()` 会按 `.ts → .tsx → .js → .jsx` 探测。
第四列 `factory` 表示入口是工厂函数（`createXxx(require)`）还是普通模块对象。

## 5. 测试

```text
tests/<m>/*.test.mjs
```

- host 侧测域逻辑与路由（复用 `tests/integration/archived-deletion.test.mjs` 里的假 `req`/`res`/`ctx` 桩）。
- client 侧用 `jsdom` + 手写 slots 桩，断言「注册了什么 id」「卸载后有没有残留」「迟到响应是否被丢弃」。
- 测试 import 源码写 `.js` / `.jsx`（由 `scripts/jsx-hooks.mjs` 解析到 `.ts` / `.tsx`）；
  但 esbuild `entryPoints`、`readFileSync` 之类**按字符串用路径**的地方要写真实扩展名。

## 6. 验证与提交

```powershell
pnpm build          # 产物是 git 跟踪的，必须重新生成
pnpm typecheck      # host 侧 strict，新模块也要零错误
pnpm check          # 契约检查（会校验包清单、client bundle、未定义名字）
node --test tests/<m>/*.test.mjs
```

按 AGENTS.md §14 拆 commit：`feat(<m>): …`（src + lib + packages 一起）、`test(<m>): …` 视情况合并。

## 7. 常见坑

- **忘记 `pnpm build`**：`lib/` 与 `packages/<m>/lib/` 是产物但入库，没构建的提交会让 `build:check` 红。
- **搬/改文件名后残留旧产物**：`build-host` 抛 `Unexpected generated host file` —— 手工删
  `lib/modules/<m>/host/<旧文件>.js` 与 `packages/<m>/lib/modules/<m>/host/<旧文件>.js`。
- **client 里手写路由字符串**：会被 `pluginApiPath()` 与 client 常量的双份来源坑一把，一律从
  `host/constants.ts` 取。
- **在 client 里 import `node:*`**：esbuild 会直接失败；需要 Node 能力就加到 host 侧，用路由暴露。
- **给 `.js` 资产写 TS 语法**（`boot.js`、`renderer.js`）：运行时 `eval` 会抛 `SyntaxError`。
