import './react.js'
import React from 'react'
import bootCss from '../host/boot.css'
import bootHtml from '../host/boot.html'
import { createPreviewDocument } from '../host/scene.js'
import { findScopedForm } from '../../../client/config.js'
import { acceptConfigWrite } from '../../../client/config-write.js'
import { installStylesheet } from '../../../client/ui/stylesheet.js'
import panelCss from './styles.css'

export const inject = ['slots', 'configForms']
const DEFAULTS = Object.freeze({ animation: 'draw', durationMs: 2400, theme: 'auto', showWordmark: true, allowSkip: true })
const FIELDS = Object.keys(DEFAULTS)

function snapshotOf(form) {
  try { return form?.getSnapshot?.() ?? form?.store?.getSnapshot?.() ?? form?.snapshot }
  catch { return undefined }
}

function readForm(form) {
  const value = snapshotOf(form)?.value ?? snapshotOf(form) ?? {}
  return Object.fromEntries(FIELDS.map((field) => [field, value?.[field] ?? DEFAULTS[field]]))
}

export function BootPanel({ form }) {
  const [version, setVersion] = React.useState(0)
  const [draft, setDraft] = React.useState(() => readForm(form))
  const [error, setError] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
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
  const changed = FIELDS.some((field) => draft[field] !== current[field])
  const controlsDisabled = !writable || saving
  const doc = createPreviewDocument({ css: bootCss, html: bootHtml, script: '' }, draft)
  const update = (field, value) => {
    dirty.current = true
    setDraft((values) => ({ ...values, [field]: value }))
    setSaved(false)
    setError('')
  }
  const save = async () => {
    if (!writable || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      for (const field of FIELDS) {
        if (draft[field] === readForm(form)[field]) continue
        await acceptConfigWrite(() => form.set(field, draft[field]), field)
      }
      dirty.current = false
      setDraft(readForm(form))
      setSaved(true)
    } catch (cause) {
      setError(String(cause?.message ?? cause))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return <main className="boot-page">
    <header className="boot-head"><div><h2>启动动画</h2><p>选择启动场景与显示方式。</p></div>
      <button type="button" className="boot-save" onClick={() => void save()} disabled={!writable || !changed || saving}>{saving ? '保存中…' : '保存'}</button>
    </header>
    {!writable ? <p className="boot-note" role="status">当前配置不可写，此页只读。</p> : null}
    {error ? <p className="boot-error" role="alert">{error}</p> : null}
    {saved ? <p className="boot-ok" role="status">设置已保存。</p> : null}
    <div className="boot-grid">
      <div className="boot-settings">
        <section className="boot-options" aria-label="动画模式">
      <button type="button" className="boot-mode" disabled={controlsDisabled} aria-pressed={draft.animation === 'draw'} onClick={() => update('animation', 'draw')}><span className="boot-mode-art boot-mode-art--draw" aria-hidden="true">◌</span><span><b>描摹</b><small>先画出轮廓，再显现鲸标</small></span></button>
      <button type="button" className="boot-mode" disabled={controlsDisabled} aria-pressed={draft.animation === 'water'} onClick={() => update('animation', 'water')}><span className="boot-mode-art boot-mode-art--water" aria-hidden="true">≋</span><span><b>水面浮现</b><small>涟漪、折射与柔和倒影</small></span></button>
      <button type="button" className="boot-mode" disabled={controlsDisabled} aria-pressed={draft.animation === 'abyss'} onClick={() => update('animation', 'abyss')}><span className="boot-mode-art boot-mode-art--abyss" aria-hidden="true">◉</span><span><b>深海跃迁</b><small>声呐扩散、鲸影下潜与光中聚合</small></span></button>
    </section>
    <section className="boot-controls" aria-label="启动动画设置">
      <label className="boot-row"><span>配色</span><select disabled={controlsDisabled} value={draft.theme} onChange={(event) => update('theme', event.target.value)}><option value="auto">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <label className="boot-row"><span>最短展示时间</span><span className="boot-duration"><input disabled={controlsDisabled} type="range" min="1700" max="8000" step="100" value={draft.durationMs} onChange={(event) => update('durationMs', Number(event.target.value))} /><output>{(draft.durationMs / 1000).toFixed(1)} 秒</output></span></label>
      <label className="boot-row"><span>显示文字标识</span><input disabled={controlsDisabled} type="checkbox" checked={draft.showWordmark} onChange={(event) => update('showWordmark', event.target.checked)} /></label>
      <label className="boot-row"><span>允许点击或按键跳过</span><input disabled={controlsDisabled} type="checkbox" checked={draft.allowSkip} onChange={(event) => update('allowSkip', event.target.checked)} /></label>
    </section>
      </div>
      <section className="boot-preview-section">
        <div className="boot-preview-title"><h3>实时预览</h3><span>{draft.animation === 'draw' ? '描摹' : draft.animation === 'water' ? '水面浮现' : '深海跃迁'}</span></div>
        <iframe className="boot-preview" title="启动画面实时预览" sandbox="" srcDoc={doc} />
      </section>
    </div>
  </main>
}

export function apply(ctx) {
  const { form } = findScopedForm(ctx, 'boot')
  ctx.effect(() => installStylesheet(panelCss, 'toolkit-boot-panel'), 'toolkit-boot:settings-styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'boot', order: 15,
    label: () => '启动动画', inject: () => ({ form }),
  }, BootPanel))
}
