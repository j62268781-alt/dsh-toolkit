import './react.js'
import React from 'react'
import { acceptConfigWrite } from '../../../client/config-write.js'
import { DSH_DESKTOP_LOGO } from '../../../client/ui/dsh-logo.js'
import { HERO_FISH_PATH, HERO_ICONS, SEND_PATH } from './hero-art.js'
import { createPaletteScene, readPalette } from './palette.js'

const MODE_CARDS = [
  { id: 'light', label: '浅色', hint: '明亮界面' },
  { id: 'dark', label: '深色', hint: '低光环境' },
  { id: 'system', label: '跟随系统', hint: '随系统切换' },
]

const PALETTE_CARDS = [
  { id: 'native', label: '原始 DSH', hint: '纯粹，熟悉的界面' },
  { id: 'codex', label: 'Codex', hint: '专注的工作空间' },
  { id: 'ocean', label: '大海蓝鲸', hint: '潜入深蓝，与巨鲸同行' },
  { id: 'hope', label: '昼夜流光', hint: '随当地时间，日升星落' },
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

/** Host icon geometry, drawn as a plain inline SVG. */
function HeroIcon({ name, size, className }) {
  const icon = HERO_ICONS[name]
  return (
    <svg
      className={className}
      viewBox={icon.viewBox}
      width={size}
      height={size}
      fill="none"
      strokeWidth={icon.strokeWidth}
      aria-hidden="true"
    >
      {icon.paths.map((path, index) => <path key={index} {...path} />)}
    </svg>
  )
}

/**
 * A look-alike of the real new-session page, so the preview shows what the app
 * actually looks like today. The real hero is a host React component behind
 * CSS-module hashes the plugin must not reference, so the markup mirrors it with
 * local classes: the artwork (fish mark, chip icons, send arrow) is the host's own
 * path data from hero-art.js, the copy is the live locale text, and the geometry
 * follows the measured hero metrics.
 */
function PreviewWindow({ palette, colorScheme }) {
  return (
    <div className="sk-theme-preview-window" data-preview-mode={colorScheme} data-preview-palette={palette}>
      <div className="sk-theme-preview-rail" aria-hidden="true">
        <span className="sk-theme-preview-logo" />
        <span className="sk-theme-preview-nav" />
        <span className="sk-theme-preview-nav sk-theme-preview-nav--short" />
        <span className="sk-theme-preview-nav" />
      </div>
      <div className="sk-theme-preview-main">
        <div className="sk-theme-preview-hero" data-sk-preview-hero="">
          <SceneBox palette={palette} />
          <div className="sk-theme-preview-stack" aria-hidden="true">
            <div className="sk-theme-preview-headline">
              <span className="sk-theme-preview-fish">
                <svg viewBox="0 0 23.16 17.04" width="34" height="25" fill="none">
                  <path d={HERO_FISH_PATH} fill="currentColor" />
                </svg>
              </span>
              <span className="sk-theme-preview-titles">
                <span className="sk-theme-preview-title">探索未至之境</span>
                <span className="sk-theme-preview-badge">预览版</span>
              </span>
            </div>
            <div className="sk-theme-preview-chips">
              <span className="sk-theme-preview-chip">
                <HeroIcon name="folder" size={16} className="sk-theme-preview-chipIcon" />
                <span className="sk-theme-preview-chipLabel">dsh-toolkit</span>
                <HeroIcon name="chevron" size={12} className="sk-theme-preview-chevron" />
              </span>
              <span className="sk-theme-preview-chip">
                <HeroIcon name="preset" size={16} className="sk-theme-preview-chipIcon" />
                <span className="sk-theme-preview-chipLabel">标准模式</span>
                <HeroIcon name="chevron" size={14} className="sk-theme-preview-chevron" />
              </span>
            </div>
            <div className="sk-theme-preview-composer">
              <div className="sk-theme-preview-input">
                <span className="sk-theme-preview-placeholder">描述你想要构建的内容, / 调用指令, @ 文件或对话</span>
              </div>
              <div className="sk-theme-preview-row">
                <span className="sk-theme-preview-tools">
                  <span className="sk-theme-preview-add">
                    <HeroIcon name="plus" size={14} className="sk-theme-preview-addIcon" />
                  </span>
                  <span className="sk-theme-preview-chip sk-theme-preview-chip--muted">
                    <HeroIcon name="shield" size={16} className="sk-theme-preview-chipIcon" />
                    <span className="sk-theme-preview-chipLabel">工作区内修改</span>
                    <HeroIcon name="chevron" size={14} className="sk-theme-preview-chevron" />
                  </span>
                </span>
                <span className="sk-theme-preview-trailing">
                  <span className="sk-theme-preview-chip sk-theme-preview-chip--muted">
                    <span className="sk-theme-preview-chipLabel">DeepSeek-Flash · x0.1</span>
                    <span className="sk-theme-preview-effort">Max</span>
                  </span>
                  <span className="sk-theme-preview-send">
                    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                      <path d={SEND_PATH} fill="currentColor" />
                    </svg>
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemeEmblem({ palette }) {
  if (palette === 'codex') return (
    <svg className="sk-theme-emblem sk-theme-emblem--codex" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {/* OpenAI mark, Simple Icons 13.21.0 (CC0). */}
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  )
  return <img className="sk-theme-emblem sk-theme-emblem--native" src={DSH_DESKTOP_LOGO} alt="" draggable={false} aria-hidden="true" />
}

function ThemeCard({ selected, label, hint, onClick, children, disabled = false, colorScheme, palette }) {
  return (
    <button
      type="button"
      role="radio"
      aria-label={label}
      aria-checked={selected}
      disabled={disabled}
      className={`sk-theme-card${selected ? ' is-selected' : ''}`}
      onClick={onClick}
    >
      <span className="sk-theme-card__art" data-preview-mode={colorScheme} data-preview-palette={palette}>{children}</span>
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

  const writable = isWritable(form) && typeof form?.set === 'function'
  const preference = snapshot.preference ?? 'system'
  const colorScheme = snapshot.colorScheme ?? 'light'

  const pickMode = async (id) => {
    if (typeof theme?.setTheme !== 'function' || busy || preference === id) return
    setBusy(true)
    setError('')
    try {
      await theme.setTheme(id)
      setSnapshot(theme.getTheme?.() ?? {})
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
      await acceptConfigWrite(() => form?.set?.('palette', id), 'palette')
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
          <p className="sk-theme-subtitle">分别选择界面明暗与主题风格，搭配你喜欢的外观。</p>
        </div>
        <span className="sk-theme-badge">实时预览</span>
      </header>

      <div className="sk-theme-stage" aria-label="主题实时预览">
        <PreviewWindow palette={palette} colorScheme={colorScheme} />
      </div>

      <div className="sk-theme-grid-section">
        <div className="sk-theme-grid-head">
          <h3>颜色模式</h3>
          <span>控制界面明暗</span>
        </div>
        <div className="sk-theme-grid sk-theme-grid--modes" role="radiogroup" aria-label="颜色模式">
          {MODE_CARDS.map((card) => (
            <ThemeCard
              key={card.id}
              label={card.label}
              hint={card.hint}
              selected={preference === card.id}
              disabled={busy || typeof theme?.setTheme !== 'function'}
              onClick={() => pickMode(card.id)}
            >
              <span className="sk-theme-mode-art" data-mode={card.id} data-resolved-mode={colorScheme} />
            </ThemeCard>
          ))}
        </div>
      </div>

      <div className="sk-theme-grid-section">
        <div className="sk-theme-grid-head">
          <h3>主题风格</h3>
          <span>保留所选颜色模式</span>
        </div>
        <div className="sk-theme-grid" role="radiogroup" aria-label="主题风格">
          {PALETTE_CARDS.map((card) => (
            <ThemeCard
              key={card.id}
              label={card.label}
              hint={card.hint}
              selected={palette === card.id}
              disabled={!writable || busy}
              colorScheme={colorScheme}
              palette={card.id}
              onClick={() => pickPalette(card.id)}
            >
              {['native', 'codex'].includes(card.id)
                ? <ThemeEmblem palette={card.id} />
                : <SceneBox palette={card.id} compact />}
            </ThemeCard>
          ))}
        </div>
      </div>

      {!writable || error || busy ? (
        <p className="sk-theme-status" role="status" data-tone={error ? 'error' : 'idle'}>
          {error || (busy ? '正在保存…' : '当前配置为只读，主题风格暂不可修改。')}
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
