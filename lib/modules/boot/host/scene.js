// These keys are persisted in existing profiles; only their artwork and labels change.
const ANIMATIONS = ['draw', 'water', 'abyss']
const DURATION_MS = { draw: 2400, water: 2900, abyss: 4500 }

function splashMarkup(x, y, count, strength, delay, seed) {
  // Generate the demo's finite droplets before injection, so the sandbox preview
  // and the real boot share identical particles without timers or script access.
  let state = seed
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296)
  const px = (value) => `${value.toFixed(2)}px`
  const particles = []
  for (let i = 0; i < count; i++) {
    const spread = (random() - .5) * 2 * (48 * strength)
    particles.push(`<span class="sk-boot-ocean__drop" style="--s:${px(3 + random() * 6)};--dx:${px(spread * .55)};--dx2:${px(spread)};--up:${px(40 + random() * 130 * strength)};--down:${px(10 + random() * 30)};--dur:${(620 + random() * 520).toFixed(2)}ms;--delay:${(delay + random() * 90).toFixed(2)}ms"></span>`)
  }
  particles.push(`<span class="sk-boot-ocean__foam" style="--delay:${delay}ms"></span>`)
  for (let i = 0; i < 3; i++) particles.push(`<span class="sk-boot-ocean__ripple" style="--delay:${delay + i * 160}ms"></span>`)
  return `<div class="sk-boot-ocean__splash" style="left:${x};top:${y}">${particles.join('')}</div>`
}

function oceanMarkup(assets, animation) {
  const shape = assets.html.match(/<path class="sk-boot__fill" d="([^"]+)"/)?.[1] ?? ''
  const mark = (className) => `<svg class="${className}" viewBox="0 0 23.16 17.04" fill="none" aria-hidden="true"><path fill="currentColor" d="${shape}"/></svg>`
  const wordmark = '<span class="sk-boot-ocean__wordmark-name">DEEPSEEK</span><span class="sk-boot-ocean__wordmark-suffix">HARNESS</span>'
  const morph = animation === 'water'
  const hero = morph
    ? `<div class="sk-boot-ocean__stage"><div class="sk-boot-ocean__lockup"><div class="sk-boot-ocean__mark-slot"><div class="sk-boot-ocean__arc-x"><div class="sk-boot-ocean__arc-y"><div class="sk-boot-ocean__arc-rot">${mark('sk-boot-ocean__mark')}</div></div></div><div class="sk-boot-ocean__shock-layer">${[0, 120, 260].map((ms) => `<span class="sk-boot-ocean__shock" style="--delay:${1500 + ms}ms"></span>`).join('')}</div></div><div class="sk-boot-ocean__wordmark">${wordmark}</div></div></div>`
    : `<div class="sk-boot-ocean__whale-track"><div class="sk-boot-ocean__whale-lift"><div class="sk-boot-ocean__whale-tilt">${mark('sk-boot-ocean__whale')}</div></div></div>`
  // Exact wave profiles from the two design demos, including the taller back wave
  // in the leap-and-dive scene. The sea remains above the whale for water occlusion.
  const back = morph ? 'M0,26 C160,6 320,6 480,26 C640,46 800,46 960,26 C1120,6 1280,6 1440,26 L1440,200 L0,200 Z' : 'M0,96 C160,52 320,52 480,96 C640,140 800,140 960,96 C1120,52 1280,52 1440,96 L1440,160 L0,160 Z'
  const sea = `<div class="sk-boot-ocean__sea"><div class="sk-boot-ocean__sea-fill"></div>${[
    ['back', back],
    ['mid', 'M0,40 C180,22 340,22 520,40 C700,58 880,58 1060,40 C1220,24 1340,24 1440,38 L1440,200 L0,200 Z'],
    ['front', 'M0,52 C200,34 360,34 540,52 C720,70 900,70 1080,52 C1260,34 1360,36 1440,48 L1440,200 L0,200 Z'],
  ].map(([layer, path]) => `<svg class="sk-boot-ocean__sea-wave sk-boot-ocean__sea-wave--${layer}" viewBox="0 0 1440 ${morph ? 200 : 160}" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/></svg>`).join('')}<div class="sk-boot-ocean__sea-mist"></div><div class="sk-boot-ocean__sea-shine"></div></div>`
  const splashes = morph ? splashMarkup('10%', '72%', 20, 1.15, 220, 41) : [
    splashMarkup('9%', '68%', 18, 1.15, 250, 71),
    splashMarkup('67%', '70%', 22, 1.3, 2450, 113),
    splashMarkup('calc(67% - 40px)', 'calc(70% + 4px)', 12, .8, 2650, 197),
  ].join('')
  const brand = morph ? '' : `<div class="sk-boot-ocean__brand">${mark('sk-boot-ocean__brand-mark')}<div class="sk-boot-ocean__wordmark sk-boot-ocean__brand-text"><span class="sk-boot-ocean__brand-name">DEEPSEEK</span><span class="sk-boot-ocean__brand-suffix">HARNESS</span></div></div>`
  return `<div class="sk-boot sk-boot--ocean" data-sk-boot aria-hidden="true"><div class="sk-boot-ocean__halo"></div>${hero}${sea}<div class="sk-boot-ocean__fx">${splashes}</div><div class="sk-boot-ocean__flash"></div><div class="sk-boot-ocean__hud">${brand}<div class="sk-boot-ocean__meter"><div class="sk-boot-ocean__meter-track"><div class="sk-boot-ocean__meter-bar"></div></div></div><div class="sk-boot-ocean__status">正在准备应用</div></div></div>`
}

export function createBootScene(assets, config, { preview = false } = {}) {
  const animation = ANIMATIONS.includes(config?.animation) ? config.animation : 'draw'
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
  const template = settings.animation === 'draw' ? assets.html : oceanMarkup(assets, settings.animation)
  const html = template.replace('data-sk-boot aria-hidden="true"', `data-sk-boot ${rootAttributes} aria-hidden="true"`)
  if (preview) return { html, css: assets.css }
  return { html, css: assets.css, script: assets.script }
}

export function createPreviewDocument(assets, config) {
  const { html, css } = createBootScene(assets, config, { preview: true })
  const theme = config?.theme === 'dark' ? ' data-ds-dark-theme' : config?.theme === 'light' ? ' data-ds-light-theme' : ''
  const safeCss = css.replace(/<\/style/gi, '<\\3C /style')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{--dsh-boot-bg:#fff;font-family:system-ui,sans-serif}${safeCss}</style></head><body${theme}>${html}</body></html>`
}

export function renderBootScript(assets) {
  return assets.script
}
