/**
 * 「用量统计」中栏页面（从左侧栏按钮打开）。
 *
 * 数据通路：挂载即拉一次 `GET /_dsh/dsh-toolkit/usage/snapshot`，之后由
 * `startPolling`（src/client/poll.js）按快照建议间隔轮询；窗口隐藏时放慢。
 * 失败保留上一份数据并显示错误行，从不把页面清空。
 *
 * 预算编辑走 `findScopedForm(ctx, 'usage')` 投影出的表单（在 index.jsx 解析一次）：
 * `form.set('budget' | 'currency' | 'period', value)`；没有表单时只读展示。
 */
import { fetchJson } from '../../../client/http.js'
import { startPolling } from '../../../client/poll.js'
import { acceptConfigWrite } from '../../../client/config-write.js'
import { createTranslator } from './locale.js'
import { createTimeline } from './timeline.jsx'
import { createSessionTable } from './session-table.jsx'
import { createCpuPanel } from './cpu-panel.jsx'
import {
  CURRENCIES, DEFAULT_REFRESH_MS, PERIODS,
  budgetBarPercent, budgetRatio, budgetTone, formatClock, formatCompactTokens,
  formatCurrency, formatInteger, formatPercent, normalizeBudget, pollIntervalMs,
  pricingSourceKey, readUsageSettings, scanSummary, sessionStats, timelineSummary,
  toNumber,
} from './model.js'

export const USAGE_SNAPSHOT_URL = '/_dsh/dsh-toolkit/usage/snapshot'

function safeSnapshot(form) {
  try {
    return form?.getSnapshot?.()
  } catch {
    return undefined
  }
}

function documentHidden() {
  try {
    return typeof document !== 'undefined' && document.hidden === true
  } catch {
    return false
  }
}

export function createUsagePanel(React, options = {}) {
  const form = options.form
  const t = typeof options.t === 'function' ? options.t : createTranslator(undefined)
  const locale = options.locale
  const Timeline = createTimeline(React)
  const SessionTable = createSessionTable(React)
  const CpuPanel = createCpuPanel(React)

  function UsageDashboard() {
    const [snapshot, setSnapshot] = React.useState(null)
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState('')
    const [formTick, setFormTick] = React.useState(0)
    const [budgetDraft, setBudgetDraft] = React.useState(null)
    const [budgetBusy, setBudgetBusy] = React.useState(false)
    const [budgetError, setBudgetError] = React.useState('')
    const [budgetSaved, setBudgetSaved] = React.useState(false)
    const refreshMsRef = React.useRef(DEFAULT_REFRESH_MS)
    const pollRef = React.useRef(null)

    // 轮询：首次立即执行，卸载时停止；间隔取快照 refreshMs，隐藏时放慢。
    React.useEffect(() => {
      let alive = true
      const poll = startPolling(async (signal) => {
        let response
        try {
          response = await fetchJson(USAGE_SNAPSHOT_URL, { method: 'GET', signal })
        } catch (cause) {
          if (signal?.aborted) throw cause
          throw new Error(t('requestFailed', { reason: cause?.message ?? cause }))
        }
        let payload
        try {
          payload = await response.json()
        } catch {
          throw new Error(t('invalidPayload'))
        }
        if (response.ok !== true || payload?.ok === false) {
          throw new Error(payload?.error ?? payload?.message ?? `HTTP ${response.status}`)
        }
        refreshMsRef.current = toNumber(payload?.refreshMs, DEFAULT_REFRESH_MS)
        if (!alive) return
        setSnapshot(payload)
        setError('')
        setLoading(false)
      }, {
        intervalMs: () => pollIntervalMs({ refreshMs: refreshMsRef.current }, { hidden: documentHidden() }),
        onError: (cause) => {
          if (!alive) return
          setError(String(cause?.message ?? cause))
          setLoading(false)
        },
      })
      pollRef.current = poll
      return () => {
        alive = false
        pollRef.current = null
        poll.stop()
      }
      // 只挂一次轮询：t 的变化由渲染闭包承担，不需要重启轮询。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // 回到前台立刻补一次刷新（隐藏期间已经降频）。
    React.useEffect(() => {
      try {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const onVisibility = () => {
          if (document.hidden !== true) pollRef.current?.refresh?.()
        }
        document.addEventListener('visibilitychange', onVisibility)
        return () => document.removeEventListener('visibilitychange', onVisibility)
      } catch {
        return undefined
      }
    }, [])

    // 宿主的设置镜像变了就重画（预算可能被别处写回）。
    React.useEffect(() => {
      try {
        if (typeof form?.subscribe !== 'function') return undefined
        return form.subscribe(() => setFormTick((count) => count + 1))
      } catch {
        return undefined
      }
    }, [])

    void formTick
    const settings = readUsageSettings(safeSnapshot(form))
    const writable = typeof form?.set === 'function' && form?.writable !== false
    const budget = normalizeBudget(snapshot?.budget)
    const budgetAmount = settings.budget ?? budget.amount
    const budgetCurrency = settings.currency ?? budget.currency ?? snapshot?.cost?.currency ?? 'CNY'
    const budgetPeriod = settings.period ?? budget.period ?? 'month'
    const configured = budgetAmount > 0
    const ratio = budgetRatio(budget.spent, budgetAmount)
    const barPercent = budgetBarPercent(ratio)
    const tone = budgetTone(ratio, configured)
    const periodLabel = budgetPeriod === 'total' ? t('periodTotal') : t('periodMonth')
    const draft = budgetDraft ?? {
      amount: configured ? String(budgetAmount) : '',
      currency: budgetCurrency,
      period: budgetPeriod,
    }
    const totals = snapshot?.totals ?? {}
    const cost = snapshot?.cost ?? {}
    const stats = sessionStats(snapshot?.sessions, snapshot?.sessionCount)
    const sourceLabel = t(pricingSourceKey(snapshot?.pricing))
    const timeline = timelineSummary(snapshot?.timeline)
    const hidden = documentHidden()
    const refreshMs = pollIntervalMs({ refreshMs: refreshMsRef.current }, { hidden })

    function refreshNow() {
      pollRef.current?.refresh?.()
    }

    async function saveBudget(event) {
      if (event !== null && typeof event === 'object' && typeof event.preventDefault === 'function') event.preventDefault()
      if (!writable) {
        setBudgetError(form === undefined ? t('budgetReadOnly') : t('budgetNotWritable'))
        return
      }
      const raw = String(draft.amount ?? '').trim()
      const amount = raw === '' ? 0 : Number(raw)
      if (!Number.isFinite(amount) || amount < 0) {
        setBudgetError(t('budgetInvalid'))
        return
      }
      const currency = draft.currency === 'USD' ? 'USD' : 'CNY'
      const period = draft.period === 'total' ? 'total' : 'month'
      setBudgetBusy(true)
      setBudgetError('')
      setBudgetSaved(false)
      try {
        await acceptConfigWrite(() => form.set('budget', amount), 'budget')
        await acceptConfigWrite(() => form.set('currency', currency), 'currency')
        await acceptConfigWrite(() => form.set('period', period), 'period')
        setBudgetDraft(null)
        setBudgetSaved(true)
        refreshNow()
      } catch (cause) {
        setBudgetError(String(cause?.message ?? cause))
      } finally {
        setBudgetBusy(false)
      }
    }

    const remaining = budgetAmount - budget.spent
    const costDetail = [
      t('costNote', { source: sourceLabel }),
      toNumber(cost.unpricedTokens) > 0 ? t('unpricedNote', { tokens: formatCompactTokens(cost.unpricedTokens) }) : '',
    ].filter((part) => part !== '').join(' · ')

    return (
      <div className="usg-page">
        <header className="usg-pageHead">
          <div className="usg-pageHeadText">
            <h2 className="usg-pageTitle">{t('title')}</h2>
            <p className="usg-pageIntro">{t('intro')}</p>
          </div>
          <div className="usg-headActions">
            <span className="usg-updated">
              {snapshot === null ? '' : t('updatedAt', { time: formatClock(snapshot.generatedAt, locale) })}
            </span>
            <span className="usg-refreshNote">
              {hidden ? t('autoRefreshHidden') : t('autoRefresh', { seconds: Math.max(1, Math.round(refreshMs / 1000)) })}
            </span>
            <button
              type="button"
              className="usg-button"
              data-variant="outline"
              onClick={refreshNow}
              disabled={loading && snapshot === null}
            >
              {t('refresh')}
            </button>
          </div>
        </header>

        {error !== '' ? (
          <p className="usg-error" role="alert">
            {snapshot === null ? `${t('errorTitle')}：${error}` : t('staleError', { reason: error })}
          </p>
        ) : null}

        {snapshot === null ? (
          <div className="usg-placeholder">
            {loading ? <p className="usg-status" role="status">{t('loading')}</p> : null}
            {!loading ? (
              <button type="button" className="usg-button" data-variant="outline" onClick={refreshNow}>
                {t('retry')}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <section className="usg-kpis" aria-label={t('title')}>
              <article className="usg-kpi" data-kpi="tokens">
                <span className="usg-kpiLabel">{t('kpiTotalTokens')}</span>
                <strong className="usg-kpiValue usg-totalTokens">{formatCompactTokens(totals.totalTokens)}</strong>
                <span className="usg-kpiDetail usg-tokenBreakdown">
                  {t('tokensBreakdown', {
                    input: formatCompactTokens(totals.inputTokens),
                    output: formatCompactTokens(totals.outputTokens),
                    cacheRead: formatCompactTokens(totals.cacheReadTokens),
                    cacheWrite: formatCompactTokens(totals.cacheWriteTokens),
                  })}
                </span>
              </article>
              <article className="usg-kpi" data-kpi="sessions">
                <span className="usg-kpiLabel">{t('kpiSessions')}</span>
                <strong className="usg-kpiValue usg-sessionCount">{formatInteger(stats.count, locale)}</strong>
                <span className="usg-kpiDetail">
                  {t('sessionsBreakdown', { live: stats.live, subagents: stats.subagents })}
                </span>
              </article>
              <article className="usg-kpi" data-kpi="cost">
                <span className="usg-kpiLabel">{t('kpiCost')}</span>
                <strong className="usg-kpiValue usg-cost">{formatCurrency(cost.amount, cost.currency, locale)}</strong>
                <span className="usg-kpiDetail">{costDetail}</span>
                <span className="usg-kpiHint">{t('costPeakHint')}</span>
              </article>
              <article className="usg-kpi" data-kpi="budget">
                <span className="usg-kpiLabel">{t('kpiBudget')}</span>
                <strong className="usg-kpiValue usg-budget">
                  {configured ? formatCurrency(budgetAmount, budgetCurrency, locale) : t('budgetUnset')}
                </strong>
                <span className="usg-kpiDetail">
                  {configured
                    ? (remaining >= 0
                      ? t('budgetRemaining', { amount: formatCurrency(remaining, budgetCurrency, locale) })
                      : t('budgetOver', { amount: formatCurrency(-remaining, budgetCurrency, locale) }))
                    : t('budgetUnsetHint')}
                </span>
                <span className="usg-kpiHint">{periodLabel}</span>
              </article>
            </section>

            <section className="usg-card usg-budget">
              <header className="usg-cardHead">
                <h3 className="usg-cardTitle">{t('budgetTitle')}</h3>
                <span className="usg-cardMeta">{periodLabel}</span>
              </header>
              <div
                className="usg-budgetBar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={barPercent}
                data-tone={tone}
              >
                <span className="usg-budgetFill" style={{ width: `${barPercent}%` }} />
              </div>
              <div className="usg-budgetInfo">
                <span>
                  {configured
                    ? t('budgetUsed', {
                      spent: formatCurrency(budget.spent, budgetCurrency, locale),
                      amount: formatCurrency(budgetAmount, budgetCurrency, locale),
                    })
                    : t('budgetUnsetHint')}
                </span>
                <strong className="usg-budgetPercent">{configured ? formatPercent(ratio, locale) : '—'}</strong>
              </div>

              <form className="usg-budgetForm" onSubmit={saveBudget}>
                <label className="usg-field">
                  <span className="usg-fieldLabel">{t('budgetField')}</span>
                  <input
                    className="usg-input usg-budgetInput"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={draft.amount}
                    disabled={!writable}
                    onChange={(event) => setBudgetDraft({ ...draft, amount: event.target.value })}
                  />
                </label>
                <label className="usg-field">
                  <span className="usg-fieldLabel">{t('currencyField')}</span>
                  <select
                    className="usg-select usg-budgetCurrency"
                    value={draft.currency}
                    disabled={!writable}
                    onChange={(event) => setBudgetDraft({ ...draft, currency: event.target.value })}
                  >
                    {CURRENCIES.map((code) => <option value={code} key={code}>{code}</option>)}
                  </select>
                </label>
                <label className="usg-field">
                  <span className="usg-fieldLabel">{t('periodField')}</span>
                  <select
                    className="usg-select usg-budgetPeriod"
                    value={draft.period}
                    disabled={!writable}
                    onChange={(event) => setBudgetDraft({ ...draft, period: event.target.value })}
                  >
                    {PERIODS.map((period) => (
                      <option value={period} key={period}>
                        {period === 'month' ? t('periodMonth') : t('periodTotal')}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="usg-button usg-budgetSave"
                  data-variant="primary"
                  disabled={!writable || budgetBusy}
                >
                  {budgetBusy ? t('saving') : t('save')}
                </button>
              </form>
              {!writable ? <p className="usg-note">{form === undefined ? t('budgetReadOnly') : t('budgetNotWritable')}</p> : null}
              {budgetError !== '' ? (
                <p className="usg-error" role="alert">{t('budgetSaveFailed', { reason: budgetError })}</p>
              ) : null}
              {budgetSaved ? <p className="usg-note" role="status">{t('saved')}</p> : null}
              <p className="usg-note usg-budgetHint">{t('costPeakHint')}</p>
            </section>

            <Timeline
              timeline={snapshot.timeline}
              currency={cost.currency ?? snapshot?.pricing?.currency ?? 'CNY'}
              locale={locale}
              t={t}
            />

            <SessionTable
              sessions={snapshot.sessions}
              sessionCount={snapshot.sessionCount}
              currency={cost.currency ?? snapshot?.pricing?.currency ?? 'CNY'}
              locale={locale}
              t={t}
            />

            <CpuPanel cpu={snapshot.cpu} locale={locale} t={t} />

            <footer className="usg-foot">
              <span>
                {t('pricingNote', {
                  source: sourceLabel,
                  currency: cost.currency ?? snapshot?.pricing?.currency ?? 'CNY',
                })}
              </span>
              {snapshot.scan !== undefined && snapshot.scan !== null ? (
                <span>{t('scanNote', scanSummary(snapshot.scan))}</span>
              ) : null}
              <span>
                {t('timelineTotal', { tokens: formatCompactTokens(timeline.totalTokens) })}
              </span>
            </footer>
          </>
        )}
      </div>
    )
  }

  return UsageDashboard
}
