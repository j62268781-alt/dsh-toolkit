/** Notification preferences, using the host General settings item typography. */
import { CURRENT_MODES, KINDS } from './model.js'

const KIND_COPY = { completed: 'typeCompleted', failed: 'typeFailed', question: 'typeQuestion', permission: 'typePermission' }
const MODE_COPY = { never: 'currentNever', unfocused: 'currentUnfocused', always: 'currentAlways' }
const PERMISSION_COPY = { granted: 'permissionGranted', denied: 'permissionDenied', default: 'permissionDefault', unsupported: 'permissionUnsupported' }
const PERMISSION_HINT = { granted: 'permissionHintGranted', denied: 'permissionHintDenied', default: 'permissionHintDefault', unsupported: 'permissionHintUnsupported' }

/** 乐观回显的对账基准：把 `notification.*` 的扁平字段映射回解码后的快照。 */
function savedFieldValue(snapshot, field) {
  for (const kind of KINDS) {
    if (field === `${kind}Enabled`) return snapshot.types?.[kind]?.enabled === true
    if (field === `${kind}Sound`) return snapshot.types?.[kind]?.sound
  }
  return snapshot[field]
}

function withoutField(values, field) {
  if (!(field in values)) return values
  const next = { ...values }
  delete next[field]
  return next
}

export function createNotificationPanel(React, options = {}) {
  const t = typeof options.t === 'function' ? options.t : (key) => key
  const { settings, actions = {}, primitives } = options
  const Switch = primitives?.Switch
  const Button = primitives?.Button

  function Toggle({ checked, disabled, label, onChange }) {
    if (typeof Switch === 'function') return <Switch checked={checked} disabled={disabled} label={label} onChange={(next) => onChange(next === true)} />
    return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="ntf-switch" data-on={checked} disabled={disabled} onClick={() => onChange(!checked)}><span className="ntf-switchKnob" /></button>
  }
  function ActionButton({ disabled, onClick, children }) {
    if (typeof Button === 'function') return <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>{children}</Button>
    return <button type="button" className="ntf-button" data-variant="outline" disabled={disabled} onClick={onClick}>{children}</button>
  }
  function Row({ title, description, children }) {
    return <div className="ntf-row"><div className="ntf-rowText"><div className="ntf-title">{title}</div>{description ? <div className="ntf-desc">{description}</div> : null}</div><div className="ntf-rowControl">{children}</div></div>
  }
  function Group({ title, children }) {
    return <section className="ntf-section" aria-label={title}><h3 className="ntf-sectionTitle">{title}</h3><div className="ntf-card">{children}</div></section>
  }

  /** Three-option popup; Escape dismisses this menu before the settings dialog. */
  function Timing({ value, disabled, translate, onChange }) {
    const [open, setOpen] = React.useState(false)
    const root = React.useRef(null)
    const trigger = React.useRef(null)
    const items = React.useRef([])
    const close = () => { setOpen(false); trigger.current?.focus() }
    React.useEffect(() => {
      if (!open) return
      items.current[Math.max(0, CURRENT_MODES.indexOf(value))]?.focus()
      const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
      const escape = (event) => {
        if (event.key !== 'Escape') return
        event.preventDefault(); event.stopImmediatePropagation(); close()
      }
      document.addEventListener('pointerdown', outside, true)
      window.addEventListener('keydown', escape, true)
      return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', escape, true) }
    }, [open])
    React.useEffect(() => { if (disabled) setOpen(false) }, [disabled])
    return <div className="ntf-timing" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <button ref={trigger} type="button" className="ntf-select ntf-timingTrigger" aria-label={translate('currentTitle')} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }}>{translate(MODE_COPY[value])}</button>
      {open ? <div className="ntf-menu" role="menu" aria-label={translate('currentTitle')} onKeyDown={(event) => {
        const index = items.current.indexOf(document.activeElement)
        let next
        if (event.key === 'ArrowDown') next = (index + 1) % CURRENT_MODES.length
        if (event.key === 'ArrowUp') next = (index + CURRENT_MODES.length - 1) % CURRENT_MODES.length
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = CURRENT_MODES.length - 1
        if (next !== undefined) { event.preventDefault(); items.current[next]?.focus() }
        if (event.key === 'Tab') setOpen(false)
      }}>{CURRENT_MODES.map((mode, index) => <button key={mode} ref={(node) => { items.current[index] = node }} type="button" role="menuitemradio" aria-checked={value === mode} className="ntf-menuItem" onClick={() => { onChange(mode); close() }}><span>{translate(MODE_COPY[mode])}</span><span aria-hidden="true">{value === mode ? '✓' : ''}</span></button>)}</div> : null}
    </div>
  }

  return function NotificationSection(props) {
    const translate = typeof props?.t === 'function' ? props.t : t
    const snapshot = React.useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot)
    const [permission, setPermission] = React.useState(() => actions.permission?.() ?? 'unsupported')
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState('')
    const [notice, setNotice] = React.useState('')
    const [sounds, setSounds] = React.useState([])
    const [soundStatus, setSoundStatus] = React.useState('loading')
    const [volume, setVolume] = React.useState(snapshot.volume)
    const volumeWrites = React.useRef({ pending: 0, tail: Promise.resolve() })
    // 配置开关的乐观回显：点击立刻写进这里，等该字段的写入全部落定（changeField 的 finally）再交还快照。
    const [pending, setPending] = React.useState({})
    const writeQueue = React.useRef(Promise.resolve())
    // 每个字段在途的写入数：归零才摘掉 pending，否则连点两次会被前一次的落定提前盖回旧值。
    const fieldInflight = React.useRef({})
    React.useEffect(() => {
      if (volumeWrites.current.pending === 0) setVolume(snapshot.volume)
    }, [snapshot.volume])
    const changeVolume = (value) => {
      setVolume(value)
      setError('')
      const writes = volumeWrites.current
      writes.pending += 1
      writes.tail = writes.tail.then(() => actions.setVolume(value)).catch((cause) => {
        setError(translate('saveFailed', { reason: String(cause?.message ?? cause) }))
      }).finally(() => {
        writes.pending -= 1
        if (writes.pending === 0) setVolume(settings.getSnapshot().volume)
      })
    }
    React.useEffect(() => {
      let disposed = false
      Promise.resolve().then(() => actions.loadSounds?.()).then((catalog) => {
        if (disposed) return
        setSounds(Array.isArray(catalog?.sounds) ? catalog.sounds : [])
        setSoundStatus(catalog?.sounds?.length > 0 ? 'ready' : 'unavailable')
      }).catch(() => { if (!disposed) setSoundStatus('unavailable') })
      return () => { disposed = true }
    }, [])
    const readOnly = actions.isWritable?.() !== true
    // 开关是纯本地意图：点击立刻回显，写入在后台排队；只有「不可写」和「总开关关闭」才禁用。
    const valueOf = (field) => (field in pending ? pending[field] : savedFieldValue(snapshot, field))
    const enabled = valueOf('enabled') === true
    const soundEnabled = valueOf('soundEnabled') === true
    const inactive = readOnly || !enabled
    // 「播放声音」只关掉通知的自动播放；选音、试听、音量是显式的本地动作，不该跟着它变灰。
    const run = async (task) => {
      setBusy(true); setError(''); setNotice('')
      try { await task() } catch (cause) { setError(translate('saveFailed', { reason: String(cause?.message ?? cause) })) } finally { setBusy(false) }
    }
    const change = (task) => { void run(task) }
    /** 配置写入：乐观回显 + 串行队列，写入期间不禁用控件、不改灰。 */
    const changeField = (field, value, task) => {
      setError(''); setNotice('')
      setPending((prev) => ({ ...prev, [field]: value }))
      const inflight = fieldInflight.current
      inflight[field] = (inflight[field] ?? 0) + 1
      // 队列只串行落盘；一次失败不该卡住后续点击，所以 catch 就地消化掉。
      writeQueue.current = writeQueue.current.then(() => task()).catch((cause) => {
        setError(translate('saveFailed', { reason: String(cause?.message ?? cause) }))
      }).finally(() => {
        inflight[field] -= 1
        // 该字段的写入全部落定才交还配置快照：成功时快照已追上，失败时退回原值。
        if (inflight[field] === 0) setPending((prev) => withoutField(prev, field))
      })
    }
    const requestPermission = () => change(async () => {
      const next = await actions.requestPermission()
      setPermission(next)
      if (next === 'granted') setNotice(translate('grantedJustNow'))
      else if (next === 'denied') setError(translate('deniedHint'))
    })
    const testNotification = () => change(async () => {
      if (!await actions.testNotification()) setError(translate('testFailed', { reason: translate(PERMISSION_COPY[permission] ?? 'permissionUnsupported') }))
    })
    const recheckPermission = () => { setError(''); setNotice(''); setPermission(actions.permission?.() ?? 'unsupported') }
    const preview = () => change(async () => {
      if (await actions.previewSound(valueOf('sound') ?? 'system') === false) setError(translate('soundUnavailable'))
    })
    const selectedSound = valueOf('sound') ?? 'system'
    const soundChoices = [{ id: 'system', label: translate('soundSystem') }, ...sounds.filter((entry) => entry.id !== 'system')]
    if (!soundChoices.some((entry) => entry.id === selectedSound)) soundChoices.push({ id: selectedSound, label: translate('soundMissing') })
    const modeValue = valueOf('currentMode')
    const currentMode = CURRENT_MODES.includes(modeValue) ? modeValue : 'unfocused'
    return <div className="ntf-page">
      <header className="ntf-pageHead"><h2 className="ntf-pageTitle">{translate('title')}</h2><p className="ntf-pageIntro">{translate('intro')}</p></header>
      <Group title={translate('preferencesHeading')}>
        <Row title={translate('enabledTitle')} description={translate('enabledDesc')}><Toggle checked={enabled} disabled={readOnly} label={translate('enabledTitle')} onChange={(next) => changeField('enabled', next, () => actions.setEnabled(next))} /></Row>
        <Row title={translate('currentTitle')} description={translate('currentDesc')}><Timing value={currentMode} disabled={inactive} translate={translate} onChange={(next) => changeField('currentMode', next, () => actions.setCurrentMode(next))} /></Row>
        <Row title={translate('testTitle')} description={translate('testHint')}><div className="ntf-actions"><ActionButton disabled={inactive || busy || permission === 'denied' || permission === 'unsupported'} onClick={testNotification}>{translate('testButton')}</ActionButton></div></Row>
        <Row title={translate('permissionTitle')} description={translate(PERMISSION_HINT[permission] ?? 'permissionHintUnsupported')}><div className="ntf-actions">{permission === 'default' ? <ActionButton disabled={busy} onClick={requestPermission}>{translate('grantButton')}</ActionButton> : permission === 'unsupported' ? null : <ActionButton disabled={busy} onClick={recheckPermission}>{translate('recheckButton')}</ActionButton>}</div></Row>
      </Group>
      <Group title={translate('typesHeading')}>
        {KINDS.map((kind) => { const title = translate(`${KIND_COPY[kind]}Title`); const field = `${kind}Enabled`; return <Row key={kind} title={title} description={translate(`${KIND_COPY[kind]}Desc`)}><Toggle checked={valueOf(field) === true} disabled={inactive} label={title} onChange={(next) => changeField(field, next, () => actions.setKindEnabled(kind, next))} /></Row> })}
      </Group>
      <Group title={translate('soundsHeading')}>
        <Row title={translate('soundTitle')} description={translate('soundDesc')}><Toggle checked={soundEnabled} disabled={inactive} label={translate('soundTitle')} onChange={(next) => changeField('soundEnabled', next, () => actions.setSoundEnabled(next))} /></Row>
        <Row title={translate('soundTypeTitle')} description={translate(soundStatus === 'unavailable' ? 'soundCatalogUnavailable' : 'soundTypeDesc')}><div className="ntf-actions"><select className="ntf-select ntf-selectSound" aria-label={translate('soundTypeTitle')} value={selectedSound} disabled={inactive || soundStatus === 'loading'} onChange={(event) => changeField('sound', event.target.value, () => actions.setSound(event.target.value))}>{soundChoices.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}</select><ActionButton disabled={inactive || soundStatus !== 'ready' || busy} onClick={preview}>{translate('previewButton')}</ActionButton></div></Row>
        <Row title={translate('volumeTitle')} description={translate('volumeDesc')}><div className="ntf-volume"><input className="ntf-range" type="range" min="0" max="100" step="1" value={Math.round(volume * 100)} aria-label={translate('volumeTitle')} disabled={inactive} onChange={(event) => changeVolume(Number(event.target.value) / 100)} /><span className="ntf-volumeValue">{translate('volumeValue', { percent: Math.round(volume * 100) })}</span></div></Row>
      </Group>
      {error !== '' ? <p className="ntf-error" role="alert">{error}</p> : null}
      {notice !== '' ? <p className="ntf-notice" role="status">{notice}</p> : null}
      {readOnly ? <p className="ntf-note">{translate('readOnly')}</p> : null}
    </div>
  }
}
