# usage 模块契约（token 用量 / 成本预算 / CPU 统计）

本文件是 `src/modules/usage/**` 的唯一接口契约。Host 与 Client 各自实现，跨端只通过
下面的 HTTP 快照和根配置 `usage` 命名空间耦合。改契约必须先改本文件并通知两端。

## 目标

常驻**左侧栏**入口（排在「自动化任务」下方），点开即在中栏看到统计页；数据全部来自本机真实会话：

1. 总 token 消耗（输入 / 输出 / 缓存读 / 缓存写）与会话数量；
2. 按 token 用量与可配置单价估算的成本，以及可配置预算的使用比例；
3. token 消耗时间线（按天分桶，默认最近 14 天）；
4. 各会话的 token 用量与成本明细；
5. DSH 主进程与整机 CPU 占用、内存占用（含最近约 2 分钟的采样历史）。

## Host 端

- 目录：`src/modules/usage/host/`，入口 `index.js`：
  ```js
  export const name = "toolkit-usage";
  export const inject = ["sessions", "webServer", "connection"];
  export { Config } from "./config.js";
  export function apply(ctx, config) { /* 采样器 + 路由 + 关闭清理 */ }
  ```
- 只读真实数据：`DSH_HOME/sessions/*/*/session*.jsonl.zstd`（多 zstd frame 的 JSONL）
  与 `DSH_HOME/storages/session_projcache/sessions/<sessionId>.json`（投影缓存）。
  不写任何会话数据。
- **挂载方式（关键）**：`src/index.js` 必须用 `configuredPlugin(usage)` 挂载：
  `ctx.plugin(Usage, config.usage)`。根 Config 已经校验过 `usage`，但 resolve 后的值里
  每个 volatile 字段都是 `Volatile` 包装；若把模块命名空间直接交给 `ctx.plugin`，Cordis
  会用子插件自己的 `Config` 再校验一次，得到
  `invalid config: $.budget expected number but got [object Object]`，子插件的 `apply`
  根本不执行——现象是其它模块全正常、只有统计路由 404。
  `tests/integration/usage-wiring.test.mjs` 用根配置的真实形状锁住了这个回归。
- 活跃会话优先使用 `ctx.sessions.list()` 的内存事件（比落盘日志新）；磁盘与内存按
  session id 去重，内存优先。日志按 `(path, mtimeMs, size)` 缓存解析结果；请求时用
  `src/host/singleflight.js` 合并并发扫描。
- zstd 用 `node:zlib` 的 `zstdDecompressSync`（Node 24 内置）。同一文件是**多个
  zstd frame 首尾相接**：`indexOf` 找 magic `28 b5 2f fd` 后逐帧解压，逐行 JSON.parse。
  解压失败/半帧要跳过并记入 `scan.errors`，不能抛给请求。
- CPU 采样器在 `apply` 里用 `setInterval`（约 2s）采样，`ctx.effect` 清理；环形保留
  最近 60 个样本。样本用 `process.cpuUsage()` 与 `os.cpus()` 的增量计算百分比。
- 价格：`config.prices` 为空时用 `pricing.js` 的内置默认表；单位是「每个 1M token 的
  货币金额」。成本 = Σ(输入×input + 输出×output + 缓存读×cacheRead + 缓存写×cacheWrite)/1e6。
  未命中价格的模型回退到通配价格（`provider: "*"`），仍无则计入 `unpricedTokens`。

## Client 端

- 目录：`src/modules/usage/client/`，入口 `index.jsx` 默认导出工厂：
  ```js
  export default function createUsage(require) {
    const React = require("react");
    globalThis.__dshReact = React; // JSX 走全局 jsxFactory
    return { name: "toolkit-usage-client", inject: ["slots", "locale", "configForms"], apply(ctx) {...} };
  }
  ```
- 入口在左侧栏，不占用设置页：
  - `sidebar.panellist`：`{ id: "usage-tokens", order: 11, label: () => t("nav") }`，组件收到
    owner props `{ size, active }`，画一个 currentColor 图标；order 11 紧跟「自动化任务」
    （schedules，order 10）。
  - `main`：`{ key: "usage-tokens" }`，key 与左侧栏 id 相同，点图标即打开中栏页面。
  - 两者都用 `ctx.slots.inject(<slot>, () => ctx.slots.register(...))` 注册，effect 标签为
    `toolkit-usage:sidebar-icon` / `toolkit-usage:main-panel`。
- 组件闭包拿 `ctx`；配置表单用 `findScopedForm(ctx, "usage")`（`src/client/config.js`），
  缺失时页面只读展示、不得崩溃。
- 轮询用 `src/client/poll.js` 的 `startPolling`，间隔取快照 `refreshMs`（缺省 8s），
  页面 `document.hidden` 时降低频率。请求失败保留上一份数据并显示错误行。
- 样式独立：`import css from "./styles.css"` + `installStylesheet(css, "toolkit-usage")`，
  类名前缀 `usg-`，颜色只用宿主主题变量（`--dsw-alias-*`、`--dsw-radius-*`），不硬编码色值。
  页面常驻中栏，自带 `padding` 与滚动，宽度上限 1120px。

## HTTP 快照

`GET /_dsh/dsh-toolkit/usage/snapshot`（`registerAuthenticatedRoute`，`cache-control: no-store`，
只接受 GET，其他方法 404）。成功 200，失败 500 `{ ok: false, error }`。

```jsonc
{
  "ok": true,
  "generatedAt": 1793710332797,
  "refreshMs": 8000,
  "sessionCount": 12,
  "totals": { "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "totalTokens": 0 },
  "cost": { "amount": 0.0123, "currency": "CNY", "unpricedTokens": 0 },
  "budget": {
    "amount": 100, "currency": "CNY", "period": "month",
    "spent": 0.0123, "remaining": 99.9877, "ratio": 0.000123,
    "periodStart": 1790000000000, "configured": true
  },
  "timeline": {
    "bucket": "day", "days": 14,
    "buckets": [
      { "start": 1790000000000, "inputTokens": 0, "outputTokens": 0,
        "cacheReadTokens": 0, "cacheWriteTokens": 0, "totalTokens": 0, "cost": 0.0 }
    ]
  },
  "sessions": [
    {
      "id": "session-4333208a-...", "title": "Greeting", "cwd": "D:\\项目\\dsh-toolkit",
      "createdAt": 1793710327384, "updatedAt": 1793710332797,
      "provider": "turing", "model": "deepseek-flash", "live": true, "subagent": false,
      "turns": 1, "steps": 3,
      "tokens": { "inputTokens": 0, "outputTokens": 0, "cacheReadTokens": 0, "cacheWriteTokens": 0, "totalTokens": 0 },
      "totalTokens": 0, "cost": 0.0, "unpricedTokens": 0
    }
  ],
  "cpu": {
    "processPercent": 3.2, "systemPercent": 12.5, "cores": 16, "load": [0, 0, 0],
    "memory": { "rss": 0, "heapUsed": 0, "heapTotal": 0, "systemTotal": 0, "systemFree": 0 },
    "uptimeSec": 3600, "sampledAt": 1793710332797, "warmingUp": false,
    "history": [ { "t": 1793710330797, "processPercent": 2.1, "systemPercent": 10.4, "rss": 0 } ]
  },
  "pricing": {
    "currency": "CNY", "source": "config|default",
    "models": [ { "provider": "*", "model": "deepseek-flash", "input": 2, "output": 8, "cacheRead": 0.04, "cacheWrite": 2 } ]
  },
  "scan": {
    "home": "D:\\DeepSeekHarnessHome", "sessionDirs": 12, "files": 12,
    "parsed": 2, "cached": 10, "skipped": 0, "errors": []
  }
}
```

- token 字段名固定，`totals.totalTokens = input + output + cacheRead + cacheWrite`（由 Host 计算）。
- `timeline.buckets` 连续、升序，长度 = `days`，最后一个是今天；按本机时区的自然日分桶，
  `start` 是该日 00:00 的 epoch ms。
- `sessions` 按 `totalTokens` 降序；`live` 表示当前在内存中加载。
- `cpu.history` 升序，最多 60 项；首次采样前 `warmingUp: true`。
- 金额保留 6 位小数即可，Client 负责展示精度。

## 根配置 `usage`（`src/host/config.js` 已接入）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `budget` | number ≥ 0 | 100 | 预算总额；0 = 未设置 |
| `currency` | "CNY" \| "USD" | "CNY" | 成本/预算货币 |
| `period` | "month" \| "total" | "month" | 预算周期；month = 本自然月 |
| `historyDays` | int 1..90 | 14 | 时间线天数 |
| `refreshMs` | int 2000..120000 | 8000 | 建议客户端轮询间隔 |
| `includeSubagents` | boolean | true | 是否把子代理会话计入 |
| `prices` | array | [] | `[{provider?, model, input, output, cacheRead?, cacheWrite?}]`，每 1M token |

全部字段 `.volatile()`（设置页写 volatile 字段才会生效）。

## 内置单价（DEFAULT_PRICES）

`config.prices` 为空时使用这一张表（CNY / 每 1M token，详见 [pricing-research.md](<pricing-research.md>)）：
`deepseek-flash` = input 2 / output 8 / cacheRead 0.04 / cacheWrite 2，另加 `*/*` 通配行。
这是 DeepSeek 官方**高峰时段**价目（空闲时段为 50%，静态表无法分时，取上界）；`currency: USD`
时使用官方美元价目（0.30 / 1.20 / 0.006 / 0.30）。价格只影响金额展示，不影响 token 计数。

## 生效方式

- **Client 半**随 `lib/client.js` 重建，运行中的页面通过 client HMR 自动换包（无需重启）。
- **Host 半**在 DSH 启动时挂载；从 `link:` 本地包开发时 Node 的 ESM 缓存不会因 profile
  recomposition 而失效（`plugin_manager` 的 enable/disable、remove/install 都只做到
  `application: applied`，实测路由仍不出现）。因此 **Host 半改动需要重启一次 DSH 桌面应用**
  才生效——这与仓库 README「装完重启才生效」的既有说明一致。

## 验收

- `node --test tests/usage/*.test.mjs`：日志解析、定价、扫描聚合、CPU 采样、客户端格式化。
- `tests/integration/usage-route.test.mjs`：路由鉴权与快照结构。
- `tests/integration/usage-client.test.mjs`：左侧栏 `sidebar.panellist`（id/order/label）与
  `main` 面板（key）注册；`tests/integration/usage-wiring.test.mjs`：用根配置真实形状挂载
  后路由必须存在（volatile 包装回归）。
- `pnpm verify` 全绿。
- 真实数据：对 `DSH_HOME` 实跑一次扫描，数字与磁盘上的会话数量/用量一致。
- 页面验证：左侧栏「自动化任务」下方出现「用量统计」图标，点开中栏页面后卡片/时间线/
  表格/CPU 有真实数字，预算条可编辑。
