import './react.js'
import React from 'react'
import bootCss from '../host/boot.css'
import bootHtml from '../host/boot.html'
import { createPreviewDocument } from '../host/scene.js'
import { findScopedForm } from '../../../client/config.js'
import { acceptConfigWrite } from '../../../client/config-write.js'
import { installStylesheet } from '../../../client/ui/stylesheet.js'
import { DSH_DESKTOP_LOGO } from '../../../client/ui/dsh-logo.js'
import { registerSettingsIcon } from '../../../client/settings-icon.jsx'
import panelCss from './styles.css'

export const inject = ['slots', 'configForms']
const DEFAULTS = Object.freeze({ animation: 'draw', theme: 'auto', showWordmark: true, allowSkip: true })
const FIELDS = Object.keys(DEFAULTS)
const SETTING_FIELDS = FIELDS.filter((field) => field !== 'animation')
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

function Group({ title, children }) {
  return <section className="boot-section" aria-label={title}><h3 className="boot-section-title">{title}</h3><div className="boot-controls">{children}</div></section>
}

function Toggle({ label, checked, disabled, onChange }) {
  return <button type="button" className="boot-switch" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}><span className="boot-switch-thumb" aria-hidden="true" /></button>
}

export function BootPanel({ form }) {
  const [version, setVersion] = React.useState(0)
  const [draft, setDraft] = React.useState(() => readForm(form))
  const [error, setError] = React.useState('')
  const [saving, setSaving] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [pendingAnimation, setPendingAnimation] = React.useState('')
  const [replay, setReplay] = React.useState(0)
  const dirty = React.useRef(false)
  const savingRef = React.useRef(false)

  React.useEffect(() => {
    if (typeof form?.subscribe !== 'function') return undefined
    return form.subscribe(() => setVersion((value) => value + 1))
  }, [form])
  React.useEffect(() => {
    if (!dirty.current && !savingRef.current) setDraft(readForm(form))
  }, [form, version])

  const current = readForm(form)
  const status = snapshotOf(form)
  const writable = typeof form?.set === 'function' && form?.writable !== false && status?.writable !== false && status?.status !== 'loading'
  const changed = SETTING_FIELDS.some((field) => draft[field] !== current[field])
  const controlsDisabled = !writable || saving !== ''
  const animation = pendingAnimation || current.animation
  const mode = MODES.find((item) => item.id === animation) ?? MODES[0]
  const doc = React.useMemo(() => createPreviewDocument({ css: bootCss, html: bootHtml, script: '' }, { ...draft, animation }), [animation, draft.theme, draft.showWordmark, draft.allowSkip])
  const update = (field, value) => {
    dirty.current = true
    setDraft((values) => ({ ...values, [field]: value }))
    setNotice('')
    setError('')
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
  const save = async () => {
    if (!writable || savingRef.current) return
    savingRef.current = true
    setSaving('settings')
    setNotice('')
    setError('')
    try {
      for (const field of SETTING_FIELDS) {
        if (draft[field] === readForm(form)[field]) continue
        await acceptConfigWrite(() => form.set(field, draft[field]), field)
      }
      dirty.current = false
      setDraft(readForm(form))
      setNotice('设置已保存，下次启动生效。')
    } catch (cause) {
      setError(String(cause?.message ?? cause))
    } finally {
      savingRef.current = false
      setSaving('')
    }
  }

  return <main className="boot-page">
    <header className="boot-head"><h2>启动动画</h2><p>让每一次启程，都有自己的仪式感。</p></header>
    {!writable ? <p className="boot-note" role="status">当前配置不可写，此页只读。</p> : null}
    <section className="boot-preview-section" aria-label="动画预览">
      <div className="boot-preview-title"><h3>实时预览 <span>· {mode.name}</span></h3><button type="button" className="boot-button" onClick={() => setReplay((value) => value + 1)}>重新播放</button></div>
      <iframe key={replay} className="boot-preview" title="启动画面实时预览" sandbox="" srcDoc={doc} />
      <p className="boot-note boot-preview-caption">{mode.detail}{changed ? ' · 显示设置尚未保存' : ''}</p>
    </section>
    <section className="boot-section" aria-label="动画模式">
      <div className="boot-section-heading"><h3 className="boot-section-title">选择动画</h3><span className="boot-note">点选即用</span></div>
      <div className="boot-options">{MODES.map((item) => <button key={item.id} type="button" className="boot-mode" disabled={controlsDisabled} aria-pressed={current.animation === item.id} aria-label={`${item.name}，${item.caption}`} onClick={() => void choose(item.id)}>
        <ModeArt mode={item.id} />
        <span className="boot-mode-copy"><span className="boot-mode-title"><b>{item.name}</b>{current.animation === item.id ? <span className="boot-mode-selected">使用中</span> : null}</span><small>{pendingAnimation === item.id ? '正在应用…' : item.caption}</small></span>
      </button>)}</div>
    </section>
    <div className="boot-feedback" aria-live="polite">{error ? <p className="boot-error" role="alert">{error}</p> : notice ? <p className="boot-ok" role="status">{notice}</p> : null}</div>
    <Group title="显示设置">
      <label className="boot-row"><span className="boot-row-text"><span>画面配色</span><small>独立设置启动画面的明暗</small></span><select disabled={controlsDisabled} value={draft.theme} onChange={(event) => update('theme', event.target.value)}><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <div className="boot-row"><span className="boot-row-text"><span>显示文字标识</span><small>在鲸标下方显示 DEEPSEEK HARNESS</small></span><Toggle label="显示文字标识" checked={draft.showWordmark} disabled={controlsDisabled} onChange={(value) => update('showWordmark', value)} /></div>
    </Group>
    <Group title="交互设置"><div className="boot-row"><span className="boot-row-text"><span>允许跳过</span><small>点击画面，或按 Esc、空格、Enter 跳过</small></span><Toggle label="允许跳过" checked={draft.allowSkip} disabled={controlsDisabled} onChange={(value) => update('allowSkip', value)} /></div></Group>
    <footer className="boot-footer"><span className="boot-note">{changed ? '预览已更新，保存后用于下次启动。' : '动画选择即时生效，显示与交互设置单独保存。'}</span><button type="button" className="boot-save" onClick={() => void save()} disabled={!writable || !changed || saving !== ''}>{saving === 'settings' ? '保存中…' : '保存设置'}</button></footer>
  </main>
}

export function apply(ctx) {
  const { form } = findScopedForm(ctx, 'boot')
  ctx.effect(() => installStylesheet(panelCss, 'toolkit-boot-panel'), 'toolkit-boot:settings-styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'boot', order: 15,
    label: () => '启动动画', inject: () => ({ form }),
  }, BootPanel))
  ctx.effect(() => registerSettingsIcon(ctx, 'boot', 'rocket'), 'toolkit-boot:settings-icon')
}
