import './react.js'
import React from 'react'
import { acceptConfigWrite } from '../../../client/config-write.js'
import { createPaletteScene, readPalette } from './palette.js'

const MODE_CARDS = [
  { id: 'light', label: '浅色', hint: '明亮界面' },
  { id: 'dark', label: '深色', hint: '低光环境' },
  { id: 'system', label: '跟随系统', hint: '随系统切换' },
]

const PALETTE_CARDS = [
  { id: 'codex', label: 'Codex', hint: '当前桌面风格' },
  { id: 'ocean', label: '大海蓝鲸', hint: '深海呼吸，鲸跃海面' },
  { id: 'hope', label: '希望红', hint: '朝阳与余烬' },
]

const isWritable = (form) => {
  let writable = form?.writable
  if (typeof writable === 'function') {
    try { writable = writable() } catch { return false }
  }
  return writable !== false
}

/** One live scene inside a fixed-size preview box. */
function SceneBox({ palette, compact = false }) {
  const host = React.useRef(null)
  React.useEffect(() => {
    const mount = host.current
    if (!mount) return undefined
    mount.replaceChildren()
    const scene = createPaletteScene(palette, { compact })
    if (scene) mount.append(scene)
    return () => mount.replaceChildren()
  }, [palette, compact])
  return <span ref={host} className="sk-theme-scene-mount" aria-hidden="true" />
}

function PreviewWindow({ palette, colorScheme }) {
  return (
    <div className="sk-theme-preview-window" data-preview-mode={colorScheme}>
      <div className="sk-theme-preview-rail" aria-hidden="true">
        <span className="sk-theme-preview-logo" />
        <span className="sk-theme-preview-nav" />
        <span className="sk-theme-preview-nav sk-theme-preview-nav--short" />
        <span className="sk-theme-preview-nav" />
      </div>
      <div className="sk-theme-preview-main">
        <div className="sk-theme-preview-hero" data-sk-preview-hero="">
          <SceneBox palette={palette} />
          <div className="sk-theme-preview-copy" aria-hidden="true">
            <b>DeepSeek</b>
            <span>今天想一起探索什么？</span>
          </div>
          <div className="sk-theme-preview-composer" aria-hidden="true">
            <span>给 DeepSeek 发送消息</span>
            <i />
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemeCard({ selected, label, hint, onClick, children, disabled = false }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      className={`sk-theme-card${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={disabled ? undefined : onClick}
    >
      <span className="sk-theme-card__art">{children}</span>
      <span className="sk-theme-card__caption">
        <span className="sk-theme-card__name">{label}</span>
        <span className="sk-theme-card__hint">{hint}</span>
      </span>
    </button>
  )
}

export function ThemeCenterPanel({ form, theme, subscribeTheme }) {
  const [snapshot, setSnapshot] = React.useState(() => theme?.getTheme?.() ?? {})
  const [palette, setPalette] = React.useState(() => readPalette(form))
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (typeof subscribeTheme !== 'function') return undefined
    return subscribeTheme(() => setSnapshot(theme?.getTheme?.() ?? {}))
  }, [theme, subscribeTheme])

  React.useEffect(() => {
    if (typeof form?.subscribe !== 'function') return undefined
    return form.subscribe(() => setPalette(readPalette(form)))
  }, [form])

  const writable = isWritable(form)
  const preference = snapshot.preference ?? 'system'
  const colorScheme = snapshot.colorScheme ?? 'light'

  const pickMode = async (id) => {
    if (!writable || busy) return
    setBusy(true)
    setError('')
    try {
      theme?.setTheme?.(id)
      if (readPalette(form) !== 'codex') {
        acceptConfigWrite(() => form?.set?.('palette', 'codex'), 'palette')
        setPalette('codex')
      }
    } catch (err) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  const pickPalette = async (id) => {
    if (!writable || busy || palette === id) return
    setBusy(true)
    setError('')
    try {
      acceptConfigWrite(() => form?.set?.('palette', id), 'palette')
      setPalette(id)
    } catch (err) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="sk-theme-page" aria-label="外观">
      <header className="sk-theme-head">
        <div className="sk-theme-head__copy">
          <h2 className="sk-theme-title">外观</h2>
          <p className="sk-theme-subtitle">选择原始外观，或为空白新对话换上一套有呼吸感的主题。</p>
        </div>
        <span className="sk-theme-badge">实时预览</span>
      </header>

      <div className="sk-theme-stage" aria-label="主题实时预览">
        <PreviewWindow palette={palette} colorScheme={colorScheme} />
      </div>

      <div className="sk-theme-grid-section">
        <div className="sk-theme-grid-head">
          <h3>全部主题</h3>
          <span>系统原生明暗与主题风格独立保存</span>
        </div>
        <div className="sk-theme-grid" role="radiogroup" aria-label="全部主题">
          {MODE_CARDS.map((card) => (
            <ThemeCard
              key={card.id}
              label={card.label}
              hint={card.hint}
              selected={palette === 'codex' && preference === card.id}
              onClick={() => pickMode(card.id)}
            >
              <span className="sk-theme-mode-art" data-mode={card.id} />
            </ThemeCard>
          ))}
          {PALETTE_CARDS.map((card) => (
            <ThemeCard
              key={card.id}
              label={card.label}
              hint={card.hint}
              selected={palette === card.id}
              onClick={() => pickPalette(card.id)}
            >
              <SceneBox palette={card.id} compact />
            </ThemeCard>
          ))}
          <ThemeCard label="敬请期待" hint="更多主题正在打磨" disabled>
            <span className="sk-theme-mode-art" data-mode="soon" />
          </ThemeCard>
        </div>
      </div>

      {!writable || error || busy ? (
        <p className="sk-theme-status" role="status" data-tone={error ? 'error' : 'idle'}>
          {error || (busy ? '正在保存…' : '当前配置为只读，主题选择暂不可修改。')}
        </p>
      ) : null}
    </section>
  )
}

export const themeCenterMeta = Object.freeze({
  name: 'settings.section',
  id: 'theme',
  order: 5,
  label: () => '外观',
})

export { MODE_CARDS, PALETTE_CARDS }
