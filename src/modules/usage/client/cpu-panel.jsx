/**
 * CPU 与内存面板：主进程 / 整机百分比、RSS、堆、整机内存，以及来自
 * `cpu.history` 的最近约 2 分钟双折线迷你图（实线主进程，虚线整机）。
 */
import {
  cpuHistorySeries, formatBytes, formatClock, formatPercentValue, formatUptime, memorySummary,
} from './model.js'

const SPARK = Object.freeze({ width: 260, height: 48, padTop: 4, padBottom: 4 })

function clampPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return 0
  return Math.min(100, number)
}

export function createCpuPanel(React) {
  function CpuPanel({ cpu, locale, t }) {
    const series = cpuHistorySeries(cpu?.history, SPARK)
    const memory = memorySummary(cpu?.memory)
    const load = Array.isArray(cpu?.load) ? cpu.load.slice(0, 3) : []
    const loadText = load.length === 0
      ? '—'
      : load.map((value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—')).join(' / ')
    const cores = Number(cpu?.cores)
    const process = clampPercent(cpu?.processPercent)
    const system = clampPercent(cpu?.systemPercent)

    return (
      <section className="usg-card usg-cpu">
        <header className="usg-cardHead">
          <h3 className="usg-cardTitle">{t('cpuTitle')}</h3>
          <span className="usg-cardMeta">
            {cpu?.warmingUp === true ? t('cpuWarmingUp') : t('cpuSamples', { count: series.count })}
          </span>
        </header>
        {cpu === null || cpu === undefined ? (
          <p className="usg-empty">{t('cpuEmpty')}</p>
        ) : (
          <>
            <div className="usg-cpuGrid">
              <div className="usg-cpuStat" data-series="process">
                <span className="usg-cpuLabel">{t('cpuProcess')}</span>
                <strong className="usg-cpuValue usg-cpuProcess">{formatPercentValue(cpu.processPercent, locale)}</strong>
                <span className="usg-meter" aria-hidden="true"><span className="usg-meterFill" style={{ width: `${process}%` }} /></span>
              </div>
              <div className="usg-cpuStat" data-series="system">
                <span className="usg-cpuLabel">{t('cpuSystem')}</span>
                <strong className="usg-cpuValue usg-cpuSystem">{formatPercentValue(cpu.systemPercent, locale)}</strong>
                <span className="usg-meter" aria-hidden="true"><span className="usg-meterFill" style={{ width: `${system}%` }} /></span>
              </div>
              <div className="usg-cpuStat" data-series="memory">
                <span className="usg-cpuLabel">{t('cpuMemory')}</span>
                <strong className="usg-cpuValue usg-cpuMemory">{formatBytes(memory.rss)}</strong>
                <span className="usg-cpuDetail">{t('cpuHeap', { used: formatBytes(memory.heapUsed), total: formatBytes(memory.heapTotal) })}</span>
              </div>
            </div>
            {series.count >= 2 ? (
              <div className="usg-spark" role="img" aria-label={t('cpuSparkTitle')}>
                <svg
                  className="usg-sparkSvg"
                  viewBox={`0 0 ${series.width} ${series.height}`}
                  preserveAspectRatio="none"
                  role="presentation"
                  focusable="false"
                >
                  <path className="usg-sparkArea" d={series.areaPath} />
                  <polyline className="usg-sparkLine" data-series="system" points={series.systemPoints} />
                  <polyline className="usg-sparkLine" data-series="process" points={series.processPoints} />
                </svg>
              </div>
            ) : null}
            <dl className="usg-cpuFacts">
              <div>
                <dt>{t('cpuSystemMemoryLabel')}</dt>
                <dd>{`${formatBytes(memory.systemUsed)} / ${formatBytes(memory.systemTotal)}`}</dd>
              </div>
              <div>
                <dt>{t('cpuCoresLabel')}</dt>
                <dd>{Number.isFinite(cores) && cores > 0 ? t('cpuCores', { cores }) : '—'}</dd>
              </div>
              <div>
                <dt>{t('cpuLoadLabel')}</dt>
                <dd>{loadText}</dd>
              </div>
              <div>
                <dt>{t('cpuUptimeLabel')}</dt>
                <dd>{Number.isFinite(Number(cpu.uptimeSec)) ? formatUptime(cpu.uptimeSec) : '—'}</dd>
              </div>
              <div>
                <dt>{t('cpuSampledAt')}</dt>
                <dd>{formatClock(cpu.sampledAt, locale)}</dd>
              </div>
            </dl>
          </>
        )}
      </section>
    )
  }
  return CpuPanel
}
