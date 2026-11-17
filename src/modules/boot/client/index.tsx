import './react.js'
import React from 'react'
import bootCss from '../host/boot.css'
import bootHtml from '../host/boot.html'
import { createPreviewDocument } from '../host/scene.js'
import { findScopedForm } from '../../../client/config.js'
import { acceptConfigWrite } from '../../../client/config-write.js'
import { installStylesheet } from '../../../client/ui/stylesheet.js'
import { toast } from '../../../client/ui/toast.js'
import { settingsStyles } from '../../../client/styles/settings.js'
import { DSH_DESKTOP_LOGO } from '../../../client/ui/components/dsh-logo/index.js'
import { registerSettingsIcon } from '../../../client/ui/components/settings-icon/index.jsx'
import panelStyles from './styles.css'
import { CardSection, OptionCard, OptionGrid, PageHeader } from '../../../client/ui/components/settings-parts/index.jsx'
import { installSettingsParts } from '../../../client/ui/components/settings-parts/install.js'

export const inject = ['slots', 'configForms']
// 面板样式 = 跨面板共用的设置页规则（按 `boot-` 前缀裁剪）+ 本模块自己的规则。
const panelCss = `${settingsStyles('boot')}\n${panelStyles}`
const DEFAULTS = Object.freeze({ animation: 'draw', theme: 'auto', showWordmark: true, allowSkip: true })
const FIELDS = Object.keys(DEFAULTS)
const MODES = [
  { id: 'draw', name: '经典描摹', caption: '笔尖微光，勾勒启程', detail: '描边勾勒鲸标，填充成形，字标随后浮现' },
  { id: 'water', name: '代码降落', caption: '代码如雨，解码成标', detail: '纵深字雨自天而降，中央解码收敛为品牌标识' },
  { id: 'abyss', name: '星海成标', caption: '星尘聚拢，点亮成标', detail: '深空里数百颗星尘自四面八方飞来，拼成鲸标星图，落定一刻点亮为真正的标识' },
]

function snapshotOf(form) {
  try { return form?.getSnapshot?.() ?? form?.store?.getSnapshot?.() ?? form?.snapshot }
  catch { return undefined }
}

function readForm(form) {
  const value = snapshotOf(form)?.value ?? snapshotOf(form) ?? {}
  return Object.fromEntries(FIELDS.map((field) => [field, value?.[field] ?? DEFAULTS[field]]))
}

function ModeArt({ mode }) {
  return <span className={`boot-mode-art boot-mode-art--${mode}`} aria-hidden="true">
    <img src={DSH_DESKTOP_LOGO} alt="" draggable="false" />
  </span>
}


function Toggle({ label, checked, disabled, onChange }) {
  return <button type="button" className="boot-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span className="boot-switch-thumb" aria-hidden="true" /></button>
}

/** Drop one optimistic field (used when the form snapshot settles or a write fails). */
function without(record, field) {
  const next = { ...record }
  delete next[field]
  return next
}

export function BootPanel({ form }) {
  const [, setVersion] = React.useState(0)
  // Render the clicked value before the form snapshot catches up: the write is a
  // local webServer round-trip of a few dozen milliseconds, but waiting for it
  // makes a click look like a two-step operation (old value → new value).
  const [pending, setPending] = React.useState<Record<string, any>>({})
  const [replay, setReplay] = React.useState(0)
  const queue = React.useRef<Promise<unknown>>(Promise.resolve())

  React.useEffect(() => {
    if (typeof form?.subscribe !== 'function') return undefined
    return form.subscribe(() => {
      setVersion((value) => value + 1)
      setPending((previous) => {
        const fields = Object.keys(previous)
        if (fields.length === 0) return previous
        const written = readForm(form)
        let settled = false
        let next = previous
        for (const field of fields) {
          if (written[field] !== previous[field]) continue
          next = without(next, field)
          settled = true
        }
        return settled ? next : previous
      })
    })
  }, [form])

  const current = { ...readForm(form), ...pending }
  const status = snapshotOf(form)
  const writable = typeof form?.set === 'function' && form?.writable !== false && status?.writable !== false && status?.status !== 'loading'
  const animation = current.animation
  const mode = MODES.find((item) => item.id === animation) ?? MODES[0]
  const doc = React.useMemo(() => createPreviewDocument({ css: bootCss, html: bootHtml, script: '' }, { ...current, animation }), [animation, current.theme, current.showWordmark, current.allowSkip])
  // Every field is volatile and already lives in the profile patch, so a click
  // writes straight through `form.set` — same contract as the pet and
  // notification panels — instead of staging a draft behind a Save button.
  // The click is the whole interaction: the local value flips immediately, the
  // write queues behind it, and only a failure reverts the field. No progress
  // copy and no disabled state, since the write is local and effectively instant.
  const write = (field, next) => {
    if (!writable || current[field] === next) return
    setPending((previous) => ({ ...previous, [field]: next }))
    queue.current = queue.current
      .then(() => acceptConfigWrite(() => form.set(field, next), field))
      .then(() => setVersion((value) => value + 1))
      .catch((cause) => {
        // 失败提示走全局 toast：这块反馈曾经是页面里的一行（`.boot-feedback`），
        // 出现/消失会把整页推高推低，而它本来只是一次性的告知。
        toast.error(String(cause?.message ?? cause))
        setPending((previous) => (previous[field] === next ? without(previous, field) : previous))
      })
  }
  const choose = (next) => {
    if (!writable) return
    if (next === current.animation) { setReplay((value) => value + 1); return }
    write('animation', next)
  }

  return <main className="boot-page">
    <PageHeader title="启动动画" subtitle="让每一次启程，都有自己的仪式感。" />
    {!writable ? <p className="boot-note" role="status">当前配置不可写，此页只读。</p> : null}
    <section className="boot-preview-section" aria-label="动画预览">
      <div className="boot-preview-title"><h3>实时预览 <span>· {mode.name}</span></h3><button type="button" className="boot-button" onClick={() => setReplay((value) => value + 1)}>重新播放</button></div>
      <iframe key={replay} className="boot-preview" title="启动画面实时预览" sandbox="" srcDoc={doc} />
      <p className="boot-note boot-preview-caption">{mode.detail}</p>
    </section>
    <CardSection bare title="选择动画" hint={<span className="boot-note">点选即用</span>} aria-label="动画模式">
      <OptionGrid>{MODES.map((item) => <OptionCard
        key={item.id}
        role="button"
        selected={current.animation === item.id}
        label={item.name}
        hint={item.caption}
        badge={current.animation === item.id ? '使用中' : undefined}
        media={<ModeArt mode={item.id} />}
        disabled={!writable}
        onSelect={() => choose(item.id)}
      />)}</OptionGrid>
    </CardSection>
    <CardSection title="显示设置" aria-label="显示设置">
      <label className="boot-row"><span className="boot-row-text"><span>画面配色</span><small>独立设置启动画面的明暗</small></span><select className="boot-select" disabled={!writable} value={current.theme} onChange={(event) => write('theme', event.target.value)}><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <div className="boot-row"><span className="boot-row-text"><span>显示文字标识</span><small>在鲸标下方显示 DEEPSEEK HARNESS</small></span><Toggle label="显示文字标识" checked={current.showWordmark} disabled={!writable} onChange={(value) => write('showWordmark', value)} /></div>
    </CardSection>
    <CardSection title="交互设置" aria-label="交互设置"><div className="boot-row"><span className="boot-row-text"><span>允许跳过</span><small>点击画面，或按 Esc、空格、Enter 跳过</small></span><Toggle label="允许跳过" checked={current.allowSkip} disabled={!writable} onChange={(value) => write('allowSkip', value)} /></div></CardSection>
  </main>
}

export function apply(ctx) {
  const { form } = findScopedForm(ctx, 'boot')
  // Panel-local CSS injected globally: every selector is a `.boot-*` class under the settings
  // panel, so an inline <style> would work too — kept as-is so the plugin keeps using the host's
  // `data-plugin` reclaim contract (tests assert `style[data-plugin="dsh-toolkit-boot-panel"]`).
  ctx.effect(() => installSettingsParts(), 'dsh-toolkit-boot:settings-parts')
  ctx.effect(() => installStylesheet(panelCss, 'dsh-toolkit-boot-panel'), 'dsh-toolkit-boot:settings-styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'boot', order: 7,
    label: () => '启动动画', inject: () => ({ form }),
  }, BootPanel))
  ctx.effect(() => registerSettingsIcon(ctx, 'boot', 'rocket'), 'dsh-toolkit-boot:settings-icon')
}
