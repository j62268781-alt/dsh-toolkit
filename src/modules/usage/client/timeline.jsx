/**
 * token 消耗趋势：按天分桶的内联 SVG（柱 + 面积折线）。
 *
 * 不引第三方图表库：柱高/折线坐标全部由 `model.js` 的纯函数算好，这里只拼元素。
 * 颜色一律走样式表里的主题变量，SVG 只用类名。
 */
import {
  buildTimelineChart, formatCompactTokens, formatCurrency, formatDayLabel,
  timelineSummary, timelineTicks,
} from './model.js'

const CHART = Object.freeze({ width: 640, height: 150, gap: 6, padTop: 8, padBottom: 6 })

export function createTimeline(React) {
  function Timeline({ timeline, currency = 'CNY', locale, t }) {
    const buckets = Array.isArray(timeline?.buckets) ? timeline.buckets : []
    const summary = timelineSummary(timeline)
    const chart = buildTimelineChart(buckets, CHART)
    const ticks = timelineTicks(buckets)
    const meta = `${t('timelineMeta', { days: summary.days })} · ${t('timelineTotal', { tokens: formatCompactTokens(summary.totalTokens) })}`

    return (
      <section className="usg-card usg-timeline">
        <header className="usg-cardHead">
          <h3 className="usg-cardTitle">{t('timelineTitle')}</h3>
          <span className="usg-cardMeta">{meta}</span>
        </header>
        {buckets.length === 0 ? (
          <p className="usg-empty">{t('timelineEmpty', { days: summary.days })}</p>
        ) : (
          <>
            <div className="usg-chart" role="img" aria-label={`${t('timelineTitle')} · ${meta}`}>
              <span className="usg-chartPeak">{t('timelinePeak', { tokens: formatCompactTokens(chart.max) })}</span>
              <svg
                className="usg-chartSvg"
                viewBox={`0 0 ${chart.width} ${chart.height}`}
                preserveAspectRatio="none"
                role="presentation"
                focusable="false"
              >
                <path className="usg-chartArea" d={chart.areaPath} />
                <path className="usg-chartLine" d={chart.linePath} />
                {chart.bars.map((bar) => (
                  <rect
                    key={bar.start || bar.index}
                    className="usg-chartBar"
                    data-empty={bar.height === 0 ? 'true' : 'false'}
                    x={bar.x}
                    y={bar.y}
                    width={bar.width}
                    height={bar.height}
                    rx={2}
                  >
                    <title>
                      {t('timelineBarTitle', {
                        date: formatDayLabel(bar.start, locale),
                        tokens: formatCompactTokens(bar.total),
                        cost: formatCurrency(bar.cost, currency, locale),
                      })}
                    </title>
                  </rect>
                ))}
              </svg>
            </div>
            <div className="usg-chartAxis" aria-hidden="true">
              {ticks.map((tick) => (
                <span key={tick.index}>{formatDayLabel(tick.start, locale)}</span>
              ))}
            </div>
          </>
        )}
      </section>
    )
  }
  return Timeline
}
