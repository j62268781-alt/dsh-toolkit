/**
 * 用量统计页的文案表。
 *
 * 命名空间固定为 `dsh-toolkit.usage`；页面通过 `ctx.locale.bind(USAGE_NS)` 取文案，
 * 拿不到 locale 服务时回退到内置中文表（页面只读展示，不崩溃）。
 */
export const USAGE_NS = 'dsh-toolkit.usage'

export const USAGE_COPY = {
  zh: {
    nav: '用量统计',
    title: '用量统计',
    intro: '本机会话的 token 消耗、成本估算与 CPU 占用。数据来自真实会话日志，只读不改写。',
    loading: '正在读取用量快照…',
    refresh: '刷新',
    updatedAt: '更新于 {time}',
    autoRefresh: '每 {seconds} 秒自动刷新',
    autoRefreshHidden: '窗口在后台，已降低刷新频率',
    errorTitle: '读取用量快照失败',
    retry: '重试',
    requestFailed: '请求用量快照失败：{reason}',
    invalidPayload: '快照响应格式不正确',
    staleError: '刷新失败，下面是上一次的数据：{reason}',

    kpiTotalTokens: '总 token',
    kpiSessions: '会话数',
    kpiCost: '估算成本',
    kpiBudget: '预算',
    tokensBreakdown: '输入 {input} · 输出 {output} · 缓存读 {cacheRead} · 缓存写 {cacheWrite}',
    sessionsBreakdown: '{live} 个活跃 · {subagents} 个子代理',
    costSourceConfig: '自定义',
    costSourceDefault: '内置',
    costNote: '按{source}单价估算',
    costPeakHint: '按 DeepSeek 高峰单价估算（空闲时段约为一半），不是最终账单。',
    unpricedNote: '{tokens} token 未匹配到单价',

    budgetTitle: '预算使用',
    budgetPeriodMonth: '本自然月',
    budgetPeriodTotal: '全部历史',
    budgetUsed: '已用 {spent} / {amount}',
    budgetRemaining: '剩余 {amount}',
    budgetOver: '超出 {amount}',
    budgetUnset: '未设置预算',
    budgetUnsetHint: '预算为 0（未设置）：填写下方金额即可按比例展示。',
    budgetField: '预算总额',
    currencyField: '货币',
    periodField: '预算周期',
    periodMonth: '本自然月',
    periodTotal: '全部历史',
    save: '保存',
    saving: '保存中…',
    saved: '已保存，下一次刷新生效。',
    budgetInvalid: '预算必须是不小于 0 的数字',
    budgetSaveFailed: '保存失败：{reason}',
    budgetReadOnly: '宿主未提供配置表单，预算只能只读展示。',
    budgetNotWritable: '当前配置不可写，预算只能只读展示。',

    timelineTitle: 'token 消耗趋势',
    timelineMeta: '最近 {days} 天 · 按天分桶',
    timelineTotal: '合计 {tokens}',
    timelineEmpty: '最近 {days} 天还没有 token 记录',
    timelineBarTitle: '{date}：{tokens} token · {cost}',
    timelinePeak: '峰值 {tokens}',

    sessionsTitle: '会话明细',
    sessionsEmpty: '还没有可统计的会话',
    sessionsEmptyHint: '这里会列出本机历史会话的 token 与成本。',
    colSession: '会话',
    colModel: '模型',
    colTime: '更新时间',
    colTokens: 'token',
    colCost: '成本',
    liveBadge: '活跃',
    subagentBadge: '子代理',
    untitled: '无标题会话',
    unknownModel: '未知模型',
    turnsSteps: '{turns} 轮 · {steps} 步',
    sortBy: '按 {column} 排序',

    cpuTitle: 'CPU 与内存',
    cpuProcess: '主进程',
    cpuSystem: '整机',
    cpuMemory: '内存',
    cpuRss: 'RSS {value}',
    cpuHeap: '堆 {used} / {total}',
    cpuSystemMemory: '系统 {used} / {total}',
    cpuSystemMemoryLabel: '系统内存',
    cpuCores: '{cores} 核',
    cpuCoresLabel: '核心',
    cpuLoad: '负载 {values}',
    cpuLoadLabel: '负载',
    cpuUptime: '运行 {value}',
    cpuUptimeLabel: '运行时长',
    cpuWarmingUp: '采样预热中，历史曲线稍后出现',
    cpuSamples: '{count} 个样本',
    cpuSparkTitle: '最近约 2 分钟的 CPU 采样（实线：主进程，虚线：整机）',
    cpuEmpty: '还没有 CPU 采样',
    cpuSampledAt: '采样时间',

    scanNote: '扫描 {files} 个文件 · 解析 {parsed} · 缓存 {cached} · 错误 {errors}',
    pricingNote: '单价：{source} · 货币 {currency}',
  },
  en: {
    nav: 'Usage',
    title: 'Usage',
    intro: 'Token consumption, cost estimate, and CPU usage for the sessions on this machine. Read-only.',
    loading: 'Loading usage snapshot…',
    refresh: 'Refresh',
    updatedAt: 'Updated {time}',
    autoRefresh: 'Auto-refreshes every {seconds}s',
    autoRefreshHidden: 'Window is in the background; refresh is slowed down',
    errorTitle: 'Failed to load the usage snapshot',
    retry: 'Retry',
    requestFailed: 'Usage snapshot request failed: {reason}',
    invalidPayload: 'The snapshot response is malformed',
    staleError: 'Refresh failed; showing the previous data: {reason}',

    kpiTotalTokens: 'Total tokens',
    kpiSessions: 'Sessions',
    kpiCost: 'Estimated cost',
    kpiBudget: 'Budget',
    tokensBreakdown: 'Input {input} · Output {output} · Cache read {cacheRead} · Cache write {cacheWrite}',
    sessionsBreakdown: '{live} live · {subagents} subagents',
    costSourceConfig: 'custom',
    costSourceDefault: 'built-in',
    costNote: 'Estimated with {source} prices',
    costPeakHint: 'Estimated at DeepSeek peak list price (off-peak ≈ half); not a final bill.',
    unpricedNote: '{tokens} tokens had no matching price',

    budgetTitle: 'Budget usage',
    budgetPeriodMonth: 'This month',
    budgetPeriodTotal: 'All time',
    budgetUsed: '{spent} of {amount} used',
    budgetRemaining: '{amount} left',
    budgetOver: '{amount} over',
    budgetUnset: 'No budget',
    budgetUnsetHint: 'Budget is 0 (not set). Enter an amount below to track progress.',
    budgetField: 'Budget amount',
    currencyField: 'Currency',
    periodField: 'Period',
    periodMonth: 'This calendar month',
    periodTotal: 'All history',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved; takes effect on the next refresh.',
    budgetInvalid: 'Budget must be a number greater than or equal to 0',
    budgetSaveFailed: 'Save failed: {reason}',
    budgetReadOnly: 'The host exposes no configuration form, so the budget is read-only.',
    budgetNotWritable: 'The configuration is not writable; the budget is read-only.',

    timelineTitle: 'Token consumption',
    timelineMeta: 'Last {days} days · daily buckets',
    timelineTotal: '{tokens} total',
    timelineEmpty: 'No token usage in the last {days} days',
    timelineBarTitle: '{date}: {tokens} tokens · {cost}',
    timelinePeak: 'Peak {tokens}',

    sessionsTitle: 'Session breakdown',
    sessionsEmpty: 'No sessions to report yet',
    sessionsEmptyHint: 'Sessions on this machine will be listed here with tokens and cost.',
    colSession: 'Session',
    colModel: 'Model',
    colTime: 'Updated',
    colTokens: 'Tokens',
    colCost: 'Cost',
    liveBadge: 'Live',
    subagentBadge: 'Subagent',
    untitled: 'Untitled session',
    unknownModel: 'Unknown model',
    turnsSteps: '{turns} turns · {steps} steps',
    sortBy: 'Sort by {column}',

    cpuTitle: 'CPU & memory',
    cpuProcess: 'Process',
    cpuSystem: 'System',
    cpuMemory: 'Memory',
    cpuRss: 'RSS {value}',
    cpuHeap: 'Heap {used} / {total}',
    cpuSystemMemory: 'System {used} / {total}',
    cpuSystemMemoryLabel: 'System memory',
    cpuCores: '{cores} cores',
    cpuCoresLabel: 'Cores',
    cpuLoad: 'Load {values}',
    cpuLoadLabel: 'Load',
    cpuUptime: 'Uptime {value}',
    cpuUptimeLabel: 'Uptime',
    cpuWarmingUp: 'Warming up; the history chart appears shortly',
    cpuSamples: '{count} samples',
    cpuSparkTitle: 'CPU samples from the last ~2 minutes (solid: process, dashed: system)',
    cpuEmpty: 'No CPU samples yet',
    cpuSampledAt: 'Sampled',

    scanNote: 'Scanned {files} files · parsed {parsed} · cached {cached} · errors {errors}',
    pricingNote: 'Pricing: {source} · {currency}',
  },
}

/** `{name}` 占位符替换；缺参保持原样，避免显示 undefined。 */
export function interpolate(template, params) {
  if (typeof template !== 'string') return ''
  if (params === null || typeof params !== 'object') return template
  return template.replace(/\{(\w+)\}/g, (match, key) => (
    params[key] === undefined || params[key] === null ? match : String(params[key])
  ))
}

/**
 * 生成 `t(key, params)`。
 *
 * `ctx.locale` 缺失、`register` 还没生效或 `bind` 抛错时逐级回退到内置表：
 * 设置页在降级宿主里也必须能显示中文文案，而不是显示 key。
 */
export function createTranslator(ctx, language) {
  const dict = USAGE_COPY[language] ?? USAGE_COPY.zh
  let bind
  try {
    if (typeof ctx?.locale?.bind === 'function') bind = ctx.locale.bind(USAGE_NS)
  } catch {
    bind = undefined
  }
  return function translate(key, params) {
    let text
    if (typeof bind === 'function') {
      try {
        text = bind(key)
      } catch {
        text = undefined
      }
    }
    if (typeof text !== 'string' || text === '' || text === key) text = dict[key] ?? USAGE_COPY.zh[key] ?? key
    return interpolate(text, params)
  }
}
