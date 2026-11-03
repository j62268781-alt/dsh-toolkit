/**
 * 会话明细表：按 token / 成本 / 时间 / 标题排序，活跃会话带徽章，子代理带标签。
 * 行数可能很多，容器限高滚动，不把设置页撑成无限长。
 */
import {
  formatCompactTokens, formatCurrency, formatDateTime, formatInteger,
  sessionStats, sortSessions,
} from './model.js'

const SORT_ARIA = { desc: 'descending', asc: 'ascending' }

export function createSessionTable(React) {
  function SessionTable({ sessions, sessionCount, currency = 'CNY', locale, t }) {
    const [sort, setSort] = React.useState({ key: 'totalTokens', direction: 'desc' })
    const list = Array.isArray(sessions) ? sessions : []
    const stats = sessionStats(list, sessionCount)
    const rows = sortSessions(list, sort)

    function toggle(key) {
      setSort((current) => ({
        key,
        direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
      }))
    }

    function header(key, label) {
      const active = sort.key === key
      return (
        <button
          type="button"
          className="usg-sortButton"
          data-active={active}
          aria-label={t('sortBy', { column: label })}
          onClick={() => toggle(key)}
        >
          <span>{label}</span>
          <span className="usg-sortArrow" data-direction={active ? sort.direction : 'none'} aria-hidden="true">
            {active && sort.direction === 'asc' ? '↑' : '↓'}
          </span>
        </button>
      )
    }

    return (
      <section className="usg-card usg-sessions">
        <header className="usg-cardHead">
          <h3 className="usg-cardTitle">{t('sessionsTitle')}</h3>
          <span className="usg-cardMeta">
            {t('sessionsBreakdown', { live: stats.live, subagents: stats.subagents })}
          </span>
        </header>
        {rows.length === 0 ? (
          <div className="usg-emptyBlock">
            <p className="usg-empty">{t('sessionsEmpty')}</p>
            <p className="usg-note">{t('sessionsEmptyHint')}</p>
          </div>
        ) : (
          <div className="usg-tableWrap">
            <table className="usg-table">
              <thead>
                <tr>
                  <th scope="col" aria-sort={sort.key === 'title' ? SORT_ARIA[sort.direction] : undefined}>
                    {header('title', t('colSession'))}
                  </th>
                  <th scope="col">{t('colModel')}</th>
                  <th scope="col" aria-sort={sort.key === 'updatedAt' ? SORT_ARIA[sort.direction] : undefined}>
                    {header('updatedAt', t('colTime'))}
                  </th>
                  <th scope="col" className="usg-num" aria-sort={sort.key === 'totalTokens' ? SORT_ARIA[sort.direction] : undefined}>
                    {header('totalTokens', t('colTokens'))}
                  </th>
                  <th scope="col" className="usg-num" aria-sort={sort.key === 'cost' ? SORT_ARIA[sort.direction] : undefined}>
                    {header('cost', t('colCost'))}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((session) => {
                  const tokens = Number.isFinite(Number(session?.tokens?.totalTokens))
                    ? Number(session.tokens.totalTokens)
                    : Number(session?.totalTokens) || 0
                  const title = String(session?.title ?? '').trim() || t('untitled')
                  const provider = String(session?.provider ?? '').trim()
                  const model = String(session?.model ?? '').trim()
                  const modelText = [provider, model].filter((part) => part !== '').join(' / ') || t('unknownModel')
                  const cwd = String(session?.cwd ?? '')
                  const turns = Number(session?.turns)
                  const steps = Number(session?.steps)
                  const meta = Number.isFinite(turns) || Number.isFinite(steps)
                    ? t('turnsSteps', {
                      turns: Number.isFinite(turns) ? turns : 0,
                      steps: Number.isFinite(steps) ? steps : 0,
                    })
                    : ''
                  return (
                    <tr className="usg-sessionRow" key={String(session?.id ?? `${title}-${modelText}`)} data-live={session?.live === true ? 'true' : 'false'}>
                      <td className="usg-sessionCell">
                        <span className="usg-sessionTitleLine">
                          <span className="usg-sessionTitle" title={title}>{title}</span>
                          {session?.live === true ? <span className="usg-badge" data-tone="live">{t('liveBadge')}</span> : null}
                          {session?.subagent === true ? <span className="usg-badge" data-tone="subagent">{t('subagentBadge')}</span> : null}
                        </span>
                        {cwd !== '' ? <span className="usg-sessionCwd" title={cwd}>{cwd}</span> : null}
                      </td>
                      <td className="usg-sessionCell">
                        <span className="usg-sessionModel">{modelText}</span>
                        {meta !== '' ? <span className="usg-sessionMeta">{meta}</span> : null}
                      </td>
                      <td className="usg-sessionCell usg-sessionTime">{formatDateTime(session?.updatedAt, locale)}</td>
                      <td className="usg-num" title={formatInteger(tokens, locale)}>{formatCompactTokens(tokens)}</td>
                      <td className="usg-num">{formatCurrency(session?.cost, currency, locale)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    )
  }
  return SessionTable
}
