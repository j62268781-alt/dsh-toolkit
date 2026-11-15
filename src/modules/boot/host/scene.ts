import { sampleMarkOutline } from './constellation.js'

// These keys are persisted in existing profiles; only their artwork and labels change.
type BootAnimation = 'draw' | 'water' | 'abyss'

/** The three texts the preview page and the real boot share. */
export interface BootAssets {
  css: string
  html: string
  script: string
}

export interface BootScene {
  html: string
  css: string
  script?: string
}

const ANIMATIONS: readonly string[] = ['draw', 'water', 'abyss']
const DURATION_MS: Record<BootAnimation, number> = { draw: 2500, water: 3400, abyss: 4200 }

/** The brand mark viewBox the starmark markup maps its star grid onto. */
const MARK_WIDTH = 23.16
const MARK_HEIGHT = 17.04
/** Stars that trace the whale, and the ambient motes behind them. */
const STAR_COUNT = 200
const MOTE_COUNT = 72
/** Everything the CSS stages is timed against this moment (see boot.css). */
const SETTLE_MS = 2400

function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296)
}

/** The brand mark path the lockups share with the draw scene. */
function markPath(assets: BootAssets): string {
  return assets.html.match(/<path class="sk-boot__fill" d="([^"]+)"/)?.[1] ?? ''
}

/* ── water：「代码降落」——字符雨带景深落下，中央解码收敛为品牌标识 ────── */

const CODE_GLYPHS = '0123456789ABCDEFｱｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ{}[]<>=+-*/;:.$#%&'
const CODE_COLUMNS = 44

function codeRainMarkup(assets: BootAssets): string {
  const shape = markPath(assets)
  const random = createRandom(0x7a2f19)
  const columns: string[] = []
  for (let i = 0; i < CODE_COLUMNS; i += 1) {
    const x = (((i + 0.5) / CODE_COLUMNS) * 100 + (random() - 0.5) * 1.6).toFixed(2)
    // Depth drives perspective scale, blur and brightness: near columns run big
    // and sharp, far columns recede into haze.
    const depth = random()
    const z = (-340 + depth * 500).toFixed(0)
    const blur = (depth > 0.62 ? 0 : (0.62 - depth) * 1.9).toFixed(2)
    const dim = (0.42 + depth * 0.58).toFixed(2)
    const dur = (1800 + random() * 2000).toFixed(0)
    const delay = (-(random() * 3200)).toFixed(0)
    const count = 9 + Math.floor(random() * 9)
    const glyphs: string[] = []
    for (let g = 0; g < count; g += 1) {
      const ch = CODE_GLYPHS[Math.floor(random() * CODE_GLYPHS.length)]
      const hot = g === 0 ? ' sk-boot-coderain__glyph--hot' : ''
      glyphs.push(`<span class="sk-boot-coderain__glyph${hot}">${ch}</span>`)
    }
    columns.push(
      `<div class="sk-boot-coderain__col" style="--x:${x}%;--z:${z}px;--blur:${blur}px;--dim:${dim}">`
      + `<div class="sk-boot-coderain__fall" style="--dur:${dur}ms;--delay:${delay}ms">${glyphs.join('')}</div></div>`,
    )
  }
  return `<div class="sk-boot sk-boot--coderain" data-sk-boot aria-hidden="true">`
    + `<div class="sk-boot-coderain__rain">${columns.join('')}</div>`
    + `<div class="sk-boot-coderain__scan"></div>`
    + `<div class="sk-boot-coderain__stage"><div class="sk-boot-coderain__lockup">`
    + `<svg class="sk-boot-coderain__mark" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path fill="currentColor" d="${shape}"/></svg>`
    + `<div class="sk-boot-coderain__wordmark"><span class="sk-boot-coderain__wordmark-name">DEEPSEEK</span><span class="sk-boot-coderain__wordmark-suffix">HARNESS</span></div>`
    + `</div></div>`
    + `<div class="sk-boot-coderain__hud"><div class="sk-boot-coderain__meter"><div class="sk-boot-coderain__meter-track"><div class="sk-boot-coderain__meter-bar"></div></div></div><div class="sk-boot-coderain__status">正在准备应用</div></div>`
    + `</div>`
}

/* ── abyss：「星海成标」——星尘自三维深处汇成鲸标星图，落定即点亮为标识 ── */

/**
 * 200 颗星的目标坐标来自鲸标路径的弧长采样（构建期算完，运行时零脚本），
 * 起点则是环绕标识的一层球壳：四面八方、深浅不一，才有"从深空飞来"的立体感。
 */
function starmarkMarkup(assets: BootAssets): string {
  const shape = markPath(assets)
  const random = createRandom(0x5eed1a)
  const stars: string[] = []
  for (const point of sampleMarkOutline(shape, STAR_COUNT, random)) {
    const x = ((point.x / MARK_WIDTH) * 100).toFixed(2)
    const y = ((point.y / MARK_HEIGHT) * 100).toFixed(2)
    const angle = random() * Math.PI * 2
    const radius = 420 + random() * 920
    const sx = (Math.cos(angle) * radius).toFixed(0)
    const sy = (Math.sin(angle) * radius * 0.78).toFixed(0)
    const sz = (-380 + random() * 680).toFixed(0)
    // 延迟只决定"谁先出发"：飞行时长补成 SETTLE_MS，所有星点在同一帧落定。
    const delay = Math.round(140 + random() * 1320)
    const cold = random() < 0.16 ? ' sk-boot-starmark__star--cold' : ''
    stars.push(
      `<i class="sk-boot-starmark__star${cold}" style="--x:${x}%;--y:${y}%;--sx:${sx}px;--sy:${sy}px;--sz:${sz}px;`
      + `--s:${(0.7 + random() * 1.2).toFixed(2)};--o:${(0.55 + random() * 0.45).toFixed(2)};`
      + `--d:${delay}ms;--u:${SETTLE_MS - delay}ms"></i>`,
    )
  }

  const motes: string[] = []
  for (let i = 0; i < MOTE_COUNT; i += 1) {
    // 远景星尘：只负责"深空不是黑的"，靠极慢漂移提供持续视差。
    const x = (random() * 100).toFixed(2)
    const y = (random() * 100).toFixed(2)
    const dur = (3600 + random() * 5200).toFixed(0)
    motes.push(
      `<i class="sk-boot-starmark__mote" style="--x:${x}%;--y:${y}%;--s:${(0.4 + random() * 1.5).toFixed(2)};`
      + `--o:${(0.14 + random() * 0.5).toFixed(2)};--drift:${(6 + random() * 30).toFixed(0)}px;`
      + `--dur:${dur}ms;--delay:${-(random() * 4800).toFixed(0)}ms"></i>`,
    )
  }

  const half = Math.floor(MOTE_COUNT / 2)
  return `<div class="sk-boot sk-boot--starmark" data-sk-boot aria-hidden="true">`
    + `<div class="sk-boot-starmark__sky">`
    + `<div class="sk-boot-starmark__nebula"></div>`
    + `<div class="sk-boot-starmark__nebula sk-boot-starmark__nebula--far"></div>`
    + `<div class="sk-boot-starmark__motes sk-boot-starmark__motes--far">${motes.slice(0, half).join('')}</div>`
    + `<div class="sk-boot-starmark__motes sk-boot-starmark__motes--near">${motes.slice(half).join('')}</div>`
    + `</div>`
    + `<div class="sk-boot-starmark__stage3d"><div class="sk-boot-starmark__world">`
    + `<div class="sk-boot-starmark__rig">`
    + `<div class="sk-boot-starmark__constellation">${stars.join('')}</div>`
    + `<svg class="sk-boot-starmark__mark" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true">`
    + `<path class="sk-boot-starmark__glow" d="${shape}"/>`
    + `<path class="sk-boot-starmark__fill" d="${shape}"/>`
    + `</svg>`
    + `<div class="sk-boot-starmark__wordmark"><span class="sk-boot-starmark__wordmark-name">DEEPSEEK</span><span class="sk-boot-starmark__wordmark-suffix">HARNESS</span></div>`
    + `</div></div></div>`
    + `<div class="sk-boot-starmark__hud">`
    + `<div class="sk-boot-starmark__hud-row"><span class="sk-boot-starmark__hud-label">星图锚定</span><span class="sk-boot-starmark__hud-count">200 / 200</span></div>`
    + `<div class="sk-boot-starmark__meter"><div class="sk-boot-starmark__meter-track"><div class="sk-boot-starmark__meter-bar"></div></div></div>`
    + `</div>`
    + `</div>`
}

export function createBootScene(assets: BootAssets, config: any, { preview = false }: { preview?: boolean } = {}): BootScene {
  const animation: BootAnimation = ANIMATIONS.includes(config?.animation) ? (config.animation as BootAnimation) : 'draw'
  const settings = {
    animation,
    durationMs: DURATION_MS[animation],
    theme: ['auto', 'light', 'dark'].includes(config?.theme) ? config.theme : 'auto',
    showWordmark: config?.showWordmark !== false,
    allowSkip: config?.allowSkip !== false,
  }
  const rootAttributes = [
    `data-sk-animation="${settings.animation}"`,
    `data-sk-theme="${settings.theme}"`,
    `data-sk-duration="${settings.durationMs}"`,
    `data-sk-wordmark="${settings.showWordmark}"`,
    `data-sk-skip="${settings.allowSkip}"`,
  ].join(' ')
  const template = settings.animation === 'draw'
    ? assets.html
    : settings.animation === 'water'
      ? codeRainMarkup(assets)
      : starmarkMarkup(assets)
  const html = template.replace('data-sk-boot aria-hidden="true"', `data-sk-boot ${rootAttributes} aria-hidden="true"`)
  if (preview) return { html, css: assets.css }
  return { html, css: assets.css, script: assets.script }
}

export function createPreviewDocument(assets: BootAssets, config: any): string {
  const { html, css } = createBootScene(assets, config, { preview: true })
  const theme = config?.theme === 'dark' ? ' data-ds-dark-theme' : config?.theme === 'light' ? ' data-ds-light-theme' : ''
  const safeCss = css.replace(/<\/style/gi, '<\\3C /style')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{--dsh-boot-bg:#fff;font-family:system-ui,sans-serif}${safeCss}</style></head><body${theme}>${html}</body></html>`
}

export function renderBootScript(assets: BootAssets): string {
  return assets.script
}
