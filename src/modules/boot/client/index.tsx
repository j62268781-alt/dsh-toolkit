import './react.js'
import React from 'react'
import bootCss from '../host/boot.css'
import bootHtml from '../host/boot.html'
import { createPreviewDocument } from '../host/scene.js'
import { findScopedForm } from '../../../client/config.js'
import { acceptConfigWrite } from '../../../client/config-write.js'
import { installStylesheet } from '../../../client/ui/stylesheet.js'
import { settingsStyles } from '../../../client/styles/settings.js'
import { DSH_DESKTOP_LOGO } from '../../../client/ui/components/dsh-logo/index.js'
import { registerSettingsIcon } from '../../../client/ui/components/settings-icon/index.jsx'
import panelStyles from './styles.css'
import { CardSection, OptionGrid, PageHeader } from '../../../client/ui/components/settings-parts/index.jsx'
import { installSettingsParts } from '../../../client/ui/components/settings-parts/install.js'

export const inject = ['slots', 'configForms']
// 面板样式 = 跨面板共用的设置页规则（按 `boot-` 前缀裁剪）+ 本模块自己的规则。
const panelCss = `${settingsStyles('boot')}\n${panelStyles}`
const DEFAULTS = Object.freeze({ animation: 'draw', theme: 'auto', showWordmark: true, allowSkip: true })
const FIELDS = Object.keys(DEFAULTS)
const LABELS = Object.freeze({ animation: '启动动画', theme: '画面配色', showWordmark: '显示文字标识', allowSkip: '允许跳过' })
const MODES = [
  { id: 'draw', name: '经典描摹', caption: '一笔勾勒，安静启程', detail: '保留原版描摹，鲸标稳定呈现' },
  { id: 'water', name: '跃浪成标', caption: '跃出水面，收拢成标', detail: '鲸鱼沿弧线跃出，收拢成 Logo，字标随后浮现' },
  { id: 'abyss', name: '鲸跃归海', caption: '掠过海面，再次入海', detail: '鲸鱼沿抛物线跃出，再入水激起水花与涟漪' },
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

export function BootPanel({ form }) {
  const [, setVersion] = React.useState(0)
  const [error, setError] = React.useState('')
  const [saving, setSaving] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [pendingAnimation, setPendingAnimation] = React.useState('')
  const [replay, setReplay] = React.useState(0)
  const savingRef = React.useRef(false)

  React.useEffect(() => {
    if (typeof form?.subscribe !== 'function') return undefined
    return form.subscribe(() => setVersion((value) => value + 1))
  }, [form])

  const current = readForm(form)
  const status = snapshotOf(form)
  const writable = typeof form?.set === 'function' && form?.writable !== false && status?.writable !== false && status?.status !== 'loading'
  const controlsDisabled = !writable || saving !== ''
  const animation = pendingAnimation || current.animation
  const mode = MODES.find((item) => item.id === animation) ?? MODES[0]
  const doc = React.useMemo(() => createPreviewDocument({ css: bootCss, html: bootHtml, script: '' }, { ...current, animation }), [animation, current.theme, current.showWordmark, current.allowSkip])
  // Every field is volatile and already lives in the profile patch, so a click
  // writes straight through `form.set` — same contract as the pet and
  // notification panels — instead of staging a draft behind a Save button.
  const write = async (field, next) => {
    if (!writable || savingRef.current || current[field] === next) return
    savingRef.current = true
    setSaving(field)
    setNotice('')
    setError('')
    try {
      await acceptConfigWrite(() => form.set(field, next), field)
      setVersion((value) => value + 1)
      setNotice(`${LABELS[field]}已更新，下次启动生效。`)
    } catch (cause) {
      setError(String(cause?.message ?? cause))
    } finally {
      savingRef.current = false
      setSaving('')
    }
  }
  const choose = async (next) => {
    if (!writable || savingRef.current) return
    if (next === current.animation) { setReplay((value) => value + 1); return }
    savingRef.current = true
    setSaving('animation')
    setPendingAnimation(next)
    setNotice('')
    setError('')
    try {
      await acceptConfigWrite(() => form.set('animation', next), 'animation')
      setVersion((value) => value + 1)
      setNotice(`已使用${MODES.find((item) => item.id === next).name}，下次启动生效。`)
    } catch (cause) {
      setError(String(cause?.message ?? cause))
    } finally {
      savingRef.current = false
      setPendingAnimation('')
      setSaving('')
    }
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
      <OptionGrid>{MODES.map((item) => <button key={item.id} type="button" className="boot-mode" disabled={controlsDisabled} aria-pressed={current.animation === item.id} aria-label={`${item.name}，${item.caption}`} onClick={() => void choose(item.id)}>
        <ModeArt mode={item.id} />
        <span className="boot-mode-copy"><span className="boot-mode-title"><b>{item.name}</b>{current.animation === item.id ? <span className="boot-mode-selected">使用中</span> : null}</span><small>{pendingAnimation === item.id ? '正在应用…' : item.caption}</small></span>
      </button>)}</OptionGrid>
    </CardSection>
    <div className="boot-feedback" aria-live="polite">{error ? <p className="boot-error" role="alert">{error}</p> : notice ? <p className="boot-ok" role="status">{notice}</p> : null}</div>
    <CardSection title="显示设置" aria-label="显示设置">
      <label className="boot-row"><span className="boot-row-text"><span>画面配色</span><small>独立设置启动画面的明暗</small></span><select className="boot-select" disabled={controlsDisabled} value={current.theme} onChange={(event) => void write('theme', event.target.value)}><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <div className="boot-row"><span className="boot-row-text"><span>显示文字标识</span><small>在鲸标下方显示 DEEPSEEK HARNESS</small></span><Toggle label="显示文字标识" checked={current.showWordmark} disabled={controlsDisabled} onChange={(value) => void write('showWordmark', value)} /></div>
    </CardSection>
    <CardSection title="交互设置" aria-label="交互设置"><div className="boot-row"><span className="boot-row-text"><span>允许跳过</span><small>点击画面，或按 Esc、空格、Enter 跳过</small></span><Toggle label="允许跳过" checked={current.allowSkip} disabled={controlsDisabled} onChange={(value) => void write('allowSkip', value)} /></div></CardSection>
    <footer className="boot-footer"><span className="boot-note">{saving === '' ? '以上设置点选即写入配置，下次启动生效。' : `正在保存${LABELS[saving]}…`}</span></footer>
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
    name: 'settings.section', id: 'boot', order: 15,
    label: () => '启动动画', inject: () => ({ form }),
  }, BootPanel))
  ctx.effect(() => registerSettingsIcon(ctx, 'boot', 'rocket'), 'dsh-toolkit-boot:settings-icon')
}
