export function createBootScene(assets, config, { preview = false } = {}) {
  const settings = {
    animation: ['draw', 'water', 'abyss'].includes(config?.animation) ? config.animation : 'draw',
    durationMs: Number.isFinite(config?.durationMs) ? Math.min(8000, Math.max(1700, config.durationMs)) : 2400,
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
  const html = assets.html.replace('<div class="sk-boot" data-sk-boot aria-hidden="true">', `<div class="sk-boot" data-sk-boot ${rootAttributes} aria-hidden="true">`)
  const modeCss = `
.sk-boot[data-sk-animation="water"] .sk-boot__lockup { animation: sk-water-rise 1.2s cubic-bezier(.2,.72,.24,1) both; }
.sk-boot[data-sk-animation="water"] .sk-boot__mark { filter: drop-shadow(0 13px 12px rgba(28, 125, 156, .2)); animation: sk-water-reflect 1.7s ease-out both; }
.sk-boot[data-sk-animation="water"] .sk-boot__grid { opacity: .52; animation: sk-water-shimmer 2.1s ease-out both; }
.sk-boot[data-sk-animation="water"]::before { content:""; position:absolute; left:50%; top:50%; width:min(50vw,420px); aspect-ratio:2.6; border:1px solid rgba(42,157,181,.24); border-radius:50%; transform:translate(-50%,12px) scale(.5); animation:sk-ripple 1.8s ease-out both; }
.sk-boot[data-sk-animation="water"]::after { content:""; position:absolute; left:50%; top:50%; width:min(38vw,320px); aspect-ratio:3; border-top:1px solid rgba(105,196,207,.26); border-radius:50%; transform:translate(-50%,32px) scale(.35); animation:sk-ripple 1.8s ease-out 180ms both; }
.sk-boot[data-sk-theme="light"]:not([data-sk-animation="abyss"]) { --dsh-boot-bg:#f4fbfa; --sk-ink:#10292a; --sk-ink-2:#3d7471; --sk-grid:rgba(16,41,42,.08); }
.sk-boot[data-sk-theme="dark"]:not([data-sk-animation="abyss"]) { --dsh-boot-bg:#101a1d; --sk-ink:#e5faf4; --sk-ink-2:#a8c9c1; --sk-grid:rgba(229,250,244,.08); }
.sk-boot[data-sk-wordmark="false"] .sk-boot__wordmark { display:none; }
@keyframes sk-water-rise { from { opacity:0; transform:translateY(26px) scale(.96); filter:blur(5px); } 65% { opacity:1; filter:blur(0); } to { transform:none; } }
@keyframes sk-water-reflect { 0% { transform:translateY(17px) scaleY(.76); opacity:.25; } 65% { transform:translateY(-2px); opacity:1; } 100% { transform:none; } }
@keyframes sk-water-shimmer { 0% { opacity:0; transform:translateY(18px); } 55% { opacity:.8; } 100% { opacity:.52; transform:none; } }
@keyframes sk-ripple { 0% { opacity:0; transform:translate(-50%,12px) scale(.38); } 34% { opacity:.85; } 100% { opacity:0; transform:translate(-50%,12px) scale(1.35); } }
@media (prefers-reduced-motion: reduce) {
  .sk-boot *, .sk-boot::before, .sk-boot::after { animation:none !important; }
  .sk-boot .sk-boot__fill,.sk-boot .sk-boot__wordmark,.sk-boot .sk-boot__grid { opacity:1; }
  .sk-boot .sk-boot__trace,.sk-boot::before,.sk-boot::after { opacity:0; }
  .sk-boot .sk-boot__mark,.sk-boot .sk-boot__lockup { transform:none; }
}
`
  const css = `${assets.css}\n${modeCss}`
  if (preview) return { html, css }
  return { html, css, script: assets.script }
}

export function createPreviewDocument(assets, config) {
  const { html, css } = createBootScene(assets, config, { preview: true })
  const theme = config?.theme === 'dark' ? ' data-ds-dark-theme' : config?.theme === 'light' ? ' data-ds-light-theme' : ''
  const safeCss = css.replace(/<\/style/gi, '<\\3C /style')
  const autoDark = config?.theme === 'auto' ? '<style>@media (prefers-color-scheme:dark){body{--dsh-boot-bg:#101a1d;--sk-ink:#e5faf4;--sk-ink-2:#a8c9c1;--sk-grid:rgba(229,250,244,.08)}}</style>' : ''
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{--dsh-boot-bg:#fff;font-family:system-ui,sans-serif}${safeCss}</style>${autoDark}</head><body${theme}>${html}</body></html>`
}

export function renderBootScript(assets) {
  return assets.script
}
