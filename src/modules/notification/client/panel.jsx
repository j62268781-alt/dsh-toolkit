/**
 * 「通知」设置页。
 *
 * 版式取自宿主内置「通用设置」页的 item 行（title 14px / 20px，副标题 12px / 18px，
 * 底部分隔线 .5px，控件靠右），标题/副标题的层级与 Skills & MCP 的卡片一致；
 * 控件用原生 `<select>`/`<input>` + 主题变量，Switch/Button 优先用官方 primitives
 * （缺 primitives 的降级宿主回落到自绘控件）。
 *
 * 数据通路全部由 index.jsx 注入：
 *   - `settings` 是一个 `{ getSnapshot, subscribe }` 快照源（配置表单 → 容错解码）；
 *   - `recent` 记录本次已发出的通知，用来展示「标题 = 会话标题 / 副标题 = 最后回复」；
 *   - `actions` 负责写配置、试听、测试通知与打开会话。
 */
import {
  CURRENT_MODES, KINDS, SCOPES, SOUNDS, relativeTime,
} from './model.js'

/** 配置字段缺失/只读时展示的降级文案（与 locale.readOnly 对应）。 */
function optionValue(value, options, fallback) {
  return options.includes(value) ? value : fallback
}

/** 类型 → 标题/描述文案 key。 */
const KIND_COPY = {
  completed: 'typeCompleted',
  failed: 'typeFailed',
  question: 'typeQuestion',
  permission: 'typePermission',
}

/** 提示音 → 文案 key。 */
const SOUND_COPY = {
  chime: 'soundChime',
  fault: 'soundFault',
  pop: 'soundPop',
  alert: 'soundAlert',
  none: 'soundNone',
}

/** 当前会话时机 → 文案 key。 */
const CURRENT_COPY = {
  hidden: 'currentHidden',
  unfocused: 'currentUnfocused',
  always: 'currentAlways',
}

/** 通知范围 → 文案 key。 */
const SCOPE_COPY = {
  all: 'scopeAll',
  main: 'scopeMain',
  'main-wait': 'scopeMainWait',
}

/** 权限状态 → 文案 key。 */
const PERMISSION_COPY = {
  granted: 'permissionGranted',
  denied: 'permissionDenied',
  default: 'permissionDefault',
  unsupported: 'permissionUnsupported',
}

/**
 * 创建设置页组件。
 * @param {object} React React 运行时。
 * @param {object} options 注入的依赖（见文件头）。
 */
export function createNotificationPanel(React, options = {}) {
  const t = typeof options.t === 'function' ? options.t : (key) => key
  const settings = options.settings
  const recent = options.recent
  const actions = options.actions ?? {}
  const primitives = options.primitives ?? null

  const Switch = primitives?.Switch
  const Button = primitives?.Button

  /** 官方 Switch 优先；降级宿主的自绘开关保持同样的可达语义。 */
  function Toggle({ checked, disabled, label, onChange }) {
    const isOn = checked === true
    const isDisabled = disabled === true
    if (typeof Switch === 'function') {
      return <Switch checked={isOn} disabled={isDisabled} label={label} onChange={(next) => onChange(next === true)} />
    }
    return (
      <button
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-label={label}
        className="ntf-switch"
        data-on={isOn}
        disabled={isDisabled}
        onClick={() => onChange(!isOn)}
      >
        <span className="ntf-switchKnob" />
      </button>
    )
  }

  /** 官方 Button 优先，样式仍走本模块的类名。 */
  function ActionButton({ variant, disabled, onClick, children }) {
    if (typeof Button === 'function') {
      return <Button type="button" variant={variant} size="sm" disabled={disabled} onClick={onClick}>{children}</Button>
    }
    return (
      <button
        type="button"
        className="ntf-button"
        data-variant={variant}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    )
  }

  /** 一行设置项：左侧 title + 副标题，右侧控件。 */
  function Row({ title, description, disabled, children }) {
    return (
      <div className="ntf-row" data-disabled={disabled === true}>
        <div className="ntf-rowText">
          <div className="ntf-title">{title}</div>
          {description ? <div className="ntf-desc">{description}</div> : null}
        </div>
        <div className="ntf-rowControl">{children}</div>
      </div>
    )
  }

  return function NotificationSection(props) {
    const translate = typeof props?.t === 'function' ? props.t : t
    const snapshot = React.useSyncExternalStore(
      settings.subscribe,
      settings.getSnapshot,
      settings.getSnapshot,
    )
    const entries = React.useSyncExternalStore(
      recent.subscribe,
      recent.getSnapshot,
      recent.getSnapshot,
    )
    const [permission, setPermission] = React.useState(() => (typeof actions.permission === 'function' ? actions.permission() : 'unsupported'))
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [notice, setNotice] = React.useState('')

    const writable = typeof actions.isWritable === 'function' ? actions.isWritable() : false
    const readOnly = !writable

    /** 执行一个可能写配置的动作：统一 busy/错误/成功提示，失败保留页面与当前值。 */
    const run = async (task) => {
      setBusy(true)
      setError('')
      setNotice('')
      try {
        await task()
      } catch (cause) {
        setError(translate('saveFailed', { reason: String(cause?.message ?? cause) }))
      } finally {
        setBusy(false)
      }
    }

    const change = (task) => {
      void run(task)
    }

    const requestPermission = () => {
      void run(async () => {
        const next = await actions.requestPermission()
        setPermission(next)
        if (next === 'granted') setNotice(translate('grantedJustNow'))
        else if (next === 'denied') setError(translate('deniedHint'))
      })
    }

    const testNotification = () => {
      setError('')
      setNotice('')
      const sent = actions.testNotification()
      if (sent === true) setNotice(translate('testSent'))
      else setError(translate('testFailed', { reason: translate(PERMISSION_COPY[permission] ?? 'permissionUnsupported') }))
    }

    const volumePercent = Math.round((Number(snapshot.volume) || 0) * 100)
    const currentMode = optionValue(snapshot.currentMode, CURRENT_MODES, 'hidden')
    const scope = optionValue(snapshot.scope, SCOPES, 'main-wait')
    const types = snapshot.types ?? {}

    return (
      <div className="ntf-page">
        <header className="ntf-pageHead">
          <div className="ntf-pageHeadText">
            <h2 className="ntf-pageTitle">{translate('title')}</h2>
            <p className="ntf-pageIntro">{translate('intro')}</p>
          </div>
        </header>

        <section className="ntf-section" aria-label={translate('title')}>
          <Row title={translate('enabledTitle')} description={translate('enabledDesc')}>
            <Toggle
              checked={snapshot.enabled === true}
              disabled={readOnly || busy}
              label={translate('enabledTitle')}
              onChange={(next) => change(() => actions.setEnabled(next))}
            />
          </Row>
          <Row title={translate('soundTitle')} description={translate('soundDesc')}>
            <Toggle
              checked={snapshot.soundEnabled === true}
              disabled={readOnly || busy || snapshot.enabled !== true}
              label={translate('soundTitle')}
              onChange={(next) => change(() => actions.setSoundEnabled(next))}
            />
          </Row>
          <Row title={translate('volumeTitle')} description={translate('volumeDesc')}>
            <div className="ntf-volume">
              <input
                className="ntf-range"
                type="range"
                min="0"
                max="100"
                step="1"
                value={volumePercent}
                aria-label={translate('volumeTitle')}
                disabled={readOnly || busy || snapshot.soundEnabled !== true}
                onChange={(event) => change(() => actions.setVolume(Number(event.target.value) / 100))}
              />
              <span className="ntf-volumeValue">{translate('volumeValue', { percent: volumePercent })}</span>
            </div>
          </Row>
          <Row title={translate('currentTitle')} description={translate('currentDesc')}>
            <select
              className="ntf-select"
              value={currentMode}
              aria-label={translate('currentTitle')}
              disabled={readOnly || busy}
              onChange={(event) => change(() => actions.setCurrentMode(event.target.value))}
            >
              {CURRENT_MODES.map((mode) => (
                <option value={mode} key={mode}>{translate(CURRENT_COPY[mode])}</option>
              ))}
            </select>
          </Row>
          <Row title={translate('scopeTitle')} description={translate('scopeDesc')}>
            <select
              className="ntf-select"
              value={scope}
              aria-label={translate('scopeTitle')}
              disabled={readOnly || busy}
              onChange={(event) => change(() => actions.setScope(event.target.value))}
            >
              {SCOPES.map((entry) => (
                <option value={entry} key={entry}>{translate(SCOPE_COPY[entry])}</option>
              ))}
            </select>
          </Row>
        </section>

        <section className="ntf-section" aria-label={translate('typesHeading')}>
          <div className="ntf-sectionHead">
            <h3 className="ntf-sectionTitle">{translate('typesHeading')}</h3>
            <p className="ntf-sectionHint">{translate('typesHint')}</p>
          </div>
          {KINDS.map((kind) => {
            const type = types[kind] ?? { enabled: false, sound: 'none' }
            const sound = optionValue(type.sound, SOUNDS, 'none')
            const title = translate(`${KIND_COPY[kind]}Title`)
            return (
              <Row
                key={kind}
                title={title}
                description={translate(`${KIND_COPY[kind]}Desc`)}
              >
                <div className="ntf-kindControls">
                  <select
                    className="ntf-select ntf-selectSound"
                    value={sound}
                    aria-label={`${title} ${translate('soundLabel')}`}
                    disabled={readOnly || busy || type.enabled !== true}
                    onChange={(event) => change(() => actions.setKindSound(kind, event.target.value))}
                  >
                    {SOUNDS.map((id) => (
                      <option value={id} key={id}>{translate(SOUND_COPY[id])}</option>
                    ))}
                  </select>
                  <ActionButton
                    variant="outline"
                    disabled={type.enabled !== true || sound === 'none'}
                    onClick={() => actions.previewSound(sound)}
                  >
                    {translate('soundLabel')}
                  </ActionButton>
                  <Toggle
                    checked={type.enabled === true}
                    disabled={readOnly || busy || snapshot.enabled !== true}
                    label={title}
                    onChange={(next) => change(() => actions.setKindEnabled(kind, next))}
                  />
                </div>
              </Row>
            )
          })}
        </section>

        <section className="ntf-section" aria-label={translate('testTitle')}>
          <Row
            title={translate('testTitle')}
            description={`${translate(PERMISSION_COPY[permission] ?? 'permissionUnsupported')} · ${translate('testDesc')}`}
          >
            <div className="ntf-actions">
              {permission === 'default' ? (
                <ActionButton variant="outline" disabled={busy} onClick={requestPermission}>
                  {translate('grantButton')}
                </ActionButton>
              ) : null}
              <ActionButton
                variant="primary"
                disabled={busy || permission !== 'granted'}
                onClick={testNotification}
              >
                {translate('testButton')}
              </ActionButton>
            </div>
          </Row>
          {error !== '' ? <p className="ntf-error" role="alert">{error}</p> : null}
          {notice !== '' ? <p className="ntf-notice" role="status">{notice}</p> : null}
          {readOnly ? <p className="ntf-note">{translate('readOnly')}</p> : null}
        </section>

        <section className="ntf-section" aria-label={translate('recentTitle')}>
          <div className="ntf-sectionHead">
            <h3 className="ntf-sectionTitle">{translate('recentTitle')}</h3>
            <p className="ntf-sectionHint">{translate('recentHint')}</p>
          </div>
          {entries.length === 0 ? (
            <p className="ntf-empty">{translate('recentEmpty')}</p>
          ) : (
            <ul className="ntf-recent">
              {entries.map((entry) => (
                <li className="ntf-recentItem" key={entry.id}>
                  <button
                    type="button"
                    className="ntf-recentButton"
                    title={translate('openSession')}
                    onClick={() => actions.openSession(entry.sessionId)}
                  >
                    <span className="ntf-recentTitle">{entry.title || translate('untitled')}</span>
                    <span className="ntf-recentBody">{entry.body || translate('noReply')}</span>
                    <span className="ntf-recentMeta">
                      {translate(`${KIND_COPY[entry.kind] ?? 'typeCompleted'}Title`)}
                      {' · '}
                      {relativeTime(entry.at, Date.now(), translate)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="ntf-foot">{translate('footerNote')}</footer>
      </div>
    )
  }
}
