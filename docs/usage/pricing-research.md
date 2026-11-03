# deepseek-flash 定价调研（provider `turing`）

调研人：verify-usage（验证侧）。调研日期：**2026-11-03**（Asia/Shanghai，星期二）。
用途：为 `src/modules/usage/host/pricing.js` 的内置 `DEFAULT_PRICES` 提供可引用的真实价格依据。
结论只影响"金额展示/预算比例"，不影响 token 计数。

## 1. 事实来源

| 来源 | URL | 抓取时间 |
|---|---|---|
| DeepSeek 官方定价页（中文） | https://api-docs.deepseek.com/zh-cn/quick_start/pricing | 2026-11-03 21:47 +08 |
| DeepSeek 官方定价页（英文） | https://api-docs.deepseek.com/quick_start/pricing | 2026-11-03 21:47 +08 |

两页数字互相对得上（人民币与美元按约 6.67 折算：2 元 ↔ $0.30，8 元 ↔ $1.20，
0.04 元 ↔ $0.006），可以认为中文页是权威价格表。

本机实际使用的模型（来自 `D:\DeepSeekHarness-home\profiles\desktop\cordis.patch.yml`）：

```yaml
turing:
  apiKeyEnv: TURING_API_KEY
  api: openai-completions
  baseURL: https://live-turing.cn.llm.tcljd.com/api/v1
  models: [{ id: deepseek-flash, ... }]
```

即 `provider: "turing"` 是一个 OpenAI 兼容的 DeepSeek 代理网关，模型名就是官方名
`deepseek-flash`（官方说明该名对应 DeepSeek-V4.1-Flash-1017）。**代理网关本身没有公开价目
表**，本文件假定其计费与 DeepSeek 官方一致；这是本调研最大的未验证假设。

## 2. 官方价格（每 1M tokens）

| 计费项 | 空闲时段 CNY | 高峰时段 CNY | 空闲时段 USD | 高峰时段 USD |
|---|---|---|---|---|
| 输入（缓存未命中 / cache miss） | 1.00 | 2.00 | $0.15 | $0.30 |
| 输出 | 4.00 | 8.00 | $0.60 | $1.20 |
| 输入（缓存命中 / cache read） | 0.02 | 0.04 | $0.003 | $0.006 |
| 缓存写入（cache write） | **官方不单独计费** | — | — | — |

补充事实：

- **高峰时段**：北京时间周一至周五（不含中国法定节假日）**09:00–12:00、14:00–18:00**；
  其余时段（含周末与法定节假日全天）为空闲时段。空闲 = 高峰的 **50%**。
- DeepSeek 的账单里没有独立的 "cache write" 单价：写入缓存的部分按**缓存未命中的输入**
  （即 input 价）计费。所以插件里的 `cacheWrite` 应取 `input` 的量级，而不是 0。
- `deepseek-flash` 是思考/非思考都支持、1M 上下文、最大输出 384K 的模型；本 profile 用
  `reasoningEffort: max`，输出 token 里通常含大量 reasoning token（本机真实数据可见）。

## 3. 推荐的内置默认表（`DEFAULT_PRICES`）

货币 **CNY**，单位「每 1M token」：

| provider | model | input | output | cacheRead | cacheWrite |
|---|---|---|---|---|---|
| `*` | `deepseek-flash` | **2** | **8** | **0.04** | **2** |
| `*` | `*`（通配回退） | **2** | **8** | **0.04** | **2** |

即：

```js
export const DEFAULT_PRICES = [
  { provider: '*', model: 'deepseek-flash', input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 },
  { provider: '*', model: '*',             input: 2, output: 8, cacheRead: 0.04, cacheWrite: 2 },
]
```

若 `config.currency === "USD"`，内置表等价数字为 `input 0.30 / output 1.20 /
cacheRead 0.006 / cacheWrite 0.30`（实现只需一套表 + 显示货币；不要做汇率换算，见风险 3）。

**为什么用高峰价而不是空闲价/折中价**：契约里的价格表是**单一静态表**，无法按
时间/星期分段。选高峰价 = 永不低于官方实际账单的"上界"，预算条不会在用户不知情时穿越
100%。代价是空闲时段用量会把成本高估最多 2 倍。若更想要"期望值"，替代表是折中价
`input 1.5 / output 6 / cacheRead 0.03 / cacheWrite 1.5`（见第 5 节实测）。

**不要照抄 docs/usage/README.md 里的示例价格**（示例写的是 `input 2 / output 3 /
cacheRead 0.2 / cacheWrite 2`）：`output 3` 明显低于官方 8，`cacheRead 0.2` 比官方 0.04
高 5 倍且会主导成本（真实数据里缓存读占 token 的 98.7%）。示例只是 HTTP 快照的字段示意，
不是价格契约。

## 4. 本机真实数据上的价格影响（用于交叉校验实现）

独立 counter（`.cache/usage-ground-truth.mjs`）对 `D:\DeepSeekHarness-home` 的实测
（2026-11-03 21:47 抓取，含正在写入的活跃会话，数字会随时间增长）：

| 指标 | 值 |
|---|---|
| 会话文件 | 13（2 个工作区，13 个 projcache 条目，id 一一对应） |
| assistant/message 事件 | 815 |
| input（缓存未命中） | 1,277,580 |
| output | 598,805 |
| cacheRead | 137,506,560 |
| cacheWrite | 0（所有真实日志里都是 0） |
| totalTokens | 139,382,945 |

- 按官方**分时段**计费回放（逐条 assistant/message 时间戳判峰谷）：实际账单 **≈ 6.51 CNY**。
- 本机全部 815 条消息都落在**空闲时段**（会话时间 20:53–23:47 北京时间的晚上），
  因此高峰默认表算出的 13.02 CNY 恰为实际值的 **2.00 倍**；空闲表 6.51 CNY 与之一致。
- 真实数据的 token 结构：cacheRead 占 98.66%，output 占 0.43%，input 占 0.92%；
  在高峰表下成本结构约为 cacheRead 5.50 / output 4.79 / input 2.56 CNY。
  因此 `cacheRead` 单价若填错（例如 0.2），成本会虚高约 5 倍——这是最敏感的一个数。

## 5. 风险与未验证项

1. **代理加价未知**：`live-turing.cn.llm.tcljd.com` 是内部 OpenAI 兼容网关，没有公开价目；
   若其按官方价 1:1 结算，则本表正确；若加价或走赠送额度，展示金额会与实际扣费不符。
   这只能靠用户核对账单验证，插件无法自行得知。
2. **分时段价格不可建模**：静态表无法区分高峰/空闲，误差最大 2×（方向总是"高估"，
   在高峰价默认下安全）。如果以后要精确，需要 `prices` 支持 `peak`/`offPeak` 两套或
   在 Host 侧按事件时间戳分段计价——超出当前契约，需先改 `docs/usage/README.md`。
3. **不要做 USD↔CNY 汇率换算**：官方两套价目是各自独立标价的（约 6.67 折算），
   插件只需要选择展示货币；用实时汇率换算只会引入噪声。
4. 官方价格页声明"产品价格可能变动"；本文件是 2026-11-03 快照，长期应允许
   `config.prices` 覆盖（契约已支持）。

## 6. 建议的代码注释（给 host-usage）

```js
// Source: https://api-docs.deepseek.com/zh-cn/quick_start/pricing (fetched 2026-11-03).
// CNY per 1M tokens, DeepSeek peak-hours list price (off-peak = 50%; DeepSeek bills
// cache writes as cache-miss input, hence cacheWrite == input). Static table cannot
// model peak/off-peak, so peak (upper bound) is the default; see docs/usage/pricing-research.md.
```
