

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
.sk-boot[data-sk-animation="abyss"] { --dsh-boot-bg:radial-gradient(ellipse at 50% 44%,#123e5d 0%,#09253c 45%,#061522 100%); --sk-ink:#e9fbff; --sk-ink-2:#9bd9ea; --sk-grid:rgba(118,218,246,.13); overflow:hidden; isolation:isolate; }
.sk-boot[data-sk-animation="abyss"][data-sk-theme="light"] { --dsh-boot-bg:radial-gradient(ellipse at 50% 44%,#e5faff 0%,#b8e5f0 52%,#75b8cc 100%); --sk-ink:#06334a; --sk-ink-2:#27647b; --sk-grid:rgba(4,61,82,.12); }
.sk-boot[data-sk-animation="abyss"][data-sk-theme="dark"],body[data-ds-dark-theme] .sk-boot[data-sk-animation="abyss"][data-sk-theme="auto"] { --dsh-boot-bg:radial-gradient(ellipse at 50% 44%,#123e5d 0%,#09253c 45%,#061522 100%); --sk-ink:#e9fbff; --sk-ink-2:#9bd9ea; --sk-grid:rgba(118,218,246,.13); }
.sk-boot[data-sk-animation="abyss"] .sk-boot__grid { opacity:.9; background-image:radial-gradient(rgba(114,224,247,.38) .7px,transparent .8px),linear-gradient(115deg,transparent 43%,rgba(117,224,247,.12) 50%,transparent 55%); background-size:31px 31px,100% 100%; animation:sk-abyss-particles 6s ease-in-out infinite alternate; }
.sk-boot[data-sk-animation="abyss"]::before,.sk-boot[data-sk-animation="abyss"]::after { content:""; position:absolute; left:50%; top:50%; width:min(66vw,540px); aspect-ratio:1; border:1px solid rgba(120,228,247,.36); border-radius:50%; box-shadow:0 0 32px rgba(74,208,244,.15),inset 0 0 24px rgba(74,208,244,.08); transform:translate(-50%,-50%) scale(.2); animation:sk-sonar 2.4s cubic-bezier(.12,.48,.25,1) infinite; }
.sk-boot[data-sk-animation="abyss"]::after { animation-delay:800ms; border-color:rgba(169,244,255,.24); }
.sk-boot[data-sk-animation="abyss"] .sk-boot__lockup { z-index:1; animation:sk-abyss-lock 2.4s cubic-bezier(.2,.7,.2,1) infinite; }
.sk-boot[data-sk-animation="abyss"] .sk-boot__mark { color:var(--sk-ink); filter:drop-shadow(0 0 20px rgba(100,233,255,.62)); animation:sk-whale-dive 2.4s cubic-bezier(.2,.7,.2,1) infinite; }
.sk-boot[data-sk-animation="abyss"] .sk-boot__trace { stroke:#9df3ff; animation:sk-abyss-trace 2.4s ease-in-out infinite; }
.sk-boot[data-sk-animation="abyss"] .sk-boot__fill { opacity:0; animation:sk-abyss-assemble 2.4s ease-in-out infinite; }
.sk-boot[data-sk-animation="abyss"] .sk-boot__wordmark { color:var(--sk-ink); animation:sk-abyss-wordmark 2.4s ease-in-out infinite; }
.sk-boot[data-sk-animation="abyss"] .sk-boot__wordmark b { color:var(--sk-ink-2); }
.sk-boot[data-sk-theme="light"] { --dsh-boot-bg:#f4fbfa; --sk-ink:#10292a; --sk-ink-2:#3d7471; --sk-grid:rgba(16,41,42,.08); }
.sk-boot[data-sk-theme="dark"] { --dsh-boot-bg:#101a1d; --sk-ink:#e5faf4; --sk-ink-2:#a8c9c1; --sk-grid:rgba(229,250,244,.08); }
.sk-boot[data-sk-wordmark="false"] .sk-boot__wordmark { display:none; }
@keyframes sk-water-rise { from { opacity:0; transform:translateY(26px) scale(.96); filter:blur(5px); } 65% { opacity:1; filter:blur(0); } to { transform:none; } }
@keyframes sk-water-reflect { 0% { transform:translateY(17px) scaleY(.76); opacity:.25; } 65% { transform:translateY(-2px); opacity:1; } 100% { transform:none; } }
@keyframes sk-water-shimmer { 0% { opacity:0; transform:translateY(18px); } 55% { opacity:.8; } 100% { opacity:.52; transform:none; } }
@keyframes sk-ripple { 0% { opacity:0; transform:translate(-50%,12px) scale(.38); } 34% { opacity:.85; } 100% { opacity:0; transform:translate(-50%,12px) scale(1.35); } }
@keyframes sk-sonar { 0% { opacity:0; transform:translate(-50%,-50%) scale(.2); } 18% { opacity:.72; } 100% { opacity:0; transform:translate(-50%,-50%) scale(1.15); } }
@keyframes sk-abyss-particles { from { transform:translateY(0); opacity:.48; } to { transform:translateY(-18px); opacity:.92; } }
@keyframes sk-whale-dive { 0%,10% { transform:translateY(-28px) rotate(-8deg) scale(.78); opacity:0; } 34% { opacity:1; } 55% { transform:translateY(4px) rotate(2deg) scale(1.08); } 76%,100% { transform:none; opacity:1; } }
@keyframes sk-abyss-trace { 0%,12% { stroke-dashoffset:1; opacity:0; } 28% { opacity:1; } 58%,100% { stroke-dashoffset:0; opacity:.28; } }
@keyframes sk-abyss-assemble { 0%,35% { opacity:0; filter:drop-shadow(0 0 2px #a4f4ff); } 58% { opacity:.92; filter:drop-shadow(0 0 24px #77eaff); } 76%,100% { opacity:1; filter:drop-shadow(0 0 10px rgba(100,233,255,.45)); } }
@keyframes sk-abyss-lock { 0%,52% { transform:translateY(8px) scale(.94); } 72%,100% { transform:none; } }
@keyframes sk-abyss-wordmark { 0%,64% { opacity:0; transform:translateY(8px); } 82%,100% { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .sk-boot *, .sk-boot::before, .sk-boot::after { animation:none !important; } }
`
   const css = `${assets.css}\n${modeCss}`
  if (preview) return { html, css }
  return { html, css, script: assets.script }
}

export function createPreviewDocument(assets, config) {
  const { html, css } = createBootScene(assets, config, { preview: true })
  const theme = config?.theme === 'dark' ? ' data-ds-dark-theme' : config?.theme === 'light' ? ' data-ds-light-theme' : ''
  const safeCss = css.replace(/<\/style/gi, '<\\3C /style')
  const autoDark = config?.theme === 'auto' ? '<style>@media (prefers-color-scheme:dark){body{--dsh-boot-bg:#101a1d;--sk-ink:#e5faf4;--sk-ink-2:#a8c9c1;--sk-grid:rgba(229,250,244,.08)}.sk-boot[data-sk-animation="abyss"]{--dsh-boot-bg:radial-gradient(ellipse at 50% 44%,#123e5d 0%,#09253c 45%,#061522 100%);--sk-ink:#e9fbff;--sk-ink-2:#9bd9ea;--sk-grid:rgba(118,218,246,.13)}}body[data-ds-dark-theme]{--dsh-boot-bg:#101a1d;--sk-ink:#e5faf4;--sk-ink-2:#a8c9c1;--sk-grid:rgba(229,250,244,.08)}body[data-ds-dark-theme] .sk-boot[data-sk-animation="abyss"]{--dsh-boot-bg:radial-gradient(ellipse at 50% 44%,#123e5d 0%,#09253c 45%,#061522 100%);--sk-ink:#e9fbff;--sk-ink-2:#9bd9ea;--sk-grid:rgba(118,218,246,.13)}</style>' : ''
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{--dsh-boot-bg:#fff;font-family:system-ui,sans-serif}${safeCss}</style>${autoDark}</head><body${theme}>${html}</body></html>`
}

export function renderBootScript(assets) {
  return assets.script
}
