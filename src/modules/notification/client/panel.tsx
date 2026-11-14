/** Notification preferences, using the host General settings item typography. */
import { CURRENT_MODES, KINDS } from './model.js'
import { CardSection, PageHeader, Row } from '../../../client/ui/components/settings-parts/index.jsx'

const KIND_COPY = { completed: 'typeCompleted', failed: 'typeFailed', question: 'typeQuestion', permission: 'typePermission' }
const MODE_COPY = { never: 'currentNever', unfocused: 'currentUnfocused', always: 'currentAlways' }
const PERMISSION_COPY = { granted: 'permissionGranted', denied: 'permissionDenied', default: 'permissionDefault', unsupported: 'permissionUnsupported' }
const PERMISSION_HINT = { granted: 'permissionHintGranted', denied: 'permissionHintDenied', default: 'permissionHintDefault', unsupported: 'permissionHintUnsupported' }
/**
 * web 端「被拒绝」的成因与修法和桌面外壳不同：Chrome 站点权限被 block 时，Windows 通知设置里
 * Chrome 仍然是「已允许」，照着系统设置那句去改永远改不好，所以这里按宿主分两套文案。
 */
const PERMISSION_COPY_WEB = { denied: 'permissionDeniedWeb' }
const PERMISSION_HINT_WEB = { denied: 'permissionHintDeniedWeb' }

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

/** 偏好源：`useSyncExternalStore` 需要的两件套（快照形状由 `model.ts` 决定）。 */
export interface NotificationSettingsSource {
  /** 当前偏好快照。 */
  getSnapshot: () => any
  /** 订阅偏好变化，返回退订函数。 */
  subscribe: (listener: () => void) => () => void
}

/** 页面工厂的依赖，由 `index.tsx` 装配时传入。 */
export interface NotificationPanelOptions {
  /** 配置表单（`findScopedForm` 的结果），页面的保存链路用。 */
  form?: any
  /** 表单 entry id。 */
  entryId?: string
  /** 文案函数。 */
  t?: (key: string, params?: any) => string
  /** 偏好源。 */
  settings?: NotificationSettingsSource
  /** 最近事件列表。 */
  recent?: any
  /** 页面上的动作集合：播放预览音、申请通知权限、打开会话…返回值各不相同，只能显式 any。 */
  actions?: any
  /** 官方 primitives（降级宿主拿到 null）。 */
  primitives?: any
}

export function createNotificationPanel(React, options: NotificationPanelOptions = {}) {
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

  /** 三个互斥选项，原生 <select>：弹出列表交还系统，键盘与 Escape 都由浏览器和设置弹窗处理。 */
  function Timing({ value, disabled, translate, onChange }) {
    return <select className="ntf-select ntf-selectTiming" aria-label={translate('currentTitle')} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{CURRENT_MODES.map((mode) => <option key={mode} value={mode}>{translate(MODE_COPY[mode])}</option>)}</select>
  }

  return function NotificationSection(props) {
    const translate = typeof props?.t === 'function' ? props.t : t
    const snapshot = React.useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot)
    const [permission, setPermission] = React.useState(() => actions.permission?.() ?? 'unsupported')
    // 拿不到判定就按浏览器处理：web shell 是本插件的默认场景，桌面外壳会显式返回 true。
    const webShell = typeof actions.desktopShell === 'function' ? actions.desktopShell() !== true : true
    const permissionCopy = (webShell && PERMISSION_COPY_WEB[permission]) || PERMISSION_COPY[permission] || 'permissionUnsupported'
    const permissionHint = (webShell && PERMISSION_HINT_WEB[permission]) || PERMISSION_HINT[permission] || 'permissionHintUnsupported'
    // 权限可能在页面之外被改（地址栏图标、系统设置、另一个标签页）：回到前台就重读一次，
    // 否则用户改完回来看到的还是「已关闭」，只能靠手点「重新检查」自救。
    React.useEffect(() => {
      const sync = () => setPermission(actions.permission?.() ?? 'unsupported')
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync)
      if (typeof window !== 'undefined') window.addEventListener('focus', sync)
      return () => {
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', sync)
        if (typeof window !== 'undefined') window.removeEventListener('focus', sync)
      }
    }, [])
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
      if (!await actions.testNotification()) setError(translate('testFailed', { reason: translate(permissionCopy) }))
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
      <PageHeader title={translate('title')} subtitle={translate('intro')} />
      <CardSection title={translate('preferencesHeading')} aria-label={translate('preferencesHeading')}>
        <Row title={translate('enabledTitle')} description={translate('enabledDesc')}><Toggle checked={enabled} disabled={readOnly} label={translate('enabledTitle')} onChange={(next) => changeField('enabled', next, () => actions.setEnabled(next))} /></Row>
        <Row title={translate('currentTitle')} description={translate('currentDesc')}><Timing value={currentMode} disabled={inactive} translate={translate} onChange={(next) => changeField('currentMode', next, () => actions.setCurrentMode(next))} /></Row>
        <Row title={translate('testTitle')} description={translate('testHint')}><div className="ntf-actions"><ActionButton disabled={inactive || busy || permission === 'denied' || permission === 'unsupported'} onClick={testNotification}>{translate('testButton')}</ActionButton></div></Row>
        <Row title={translate('permissionTitle')} description={translate(permissionHint)}><div className="ntf-actions">{permission === 'default' ? <ActionButton disabled={busy} onClick={requestPermission}>{translate('grantButton')}</ActionButton> : permission === 'unsupported' ? null : <ActionButton disabled={busy} onClick={recheckPermission}>{translate('recheckButton')}</ActionButton>}</div></Row>
      </CardSection>
      <CardSection title={translate('typesHeading')} aria-label={translate('typesHeading')}>
        {KINDS.map((kind) => { const title = translate(`${KIND_COPY[kind]}Title`); const field = `${kind}Enabled`; return <Row key={kind} title={title} description={translate(`${KIND_COPY[kind]}Desc`)}><Toggle checked={valueOf(field) === true} disabled={inactive} label={title} onChange={(next) => changeField(field, next, () => actions.setKindEnabled(kind, next))} /></Row> })}
      </CardSection>
      <CardSection title={translate('soundsHeading')} aria-label={translate('soundsHeading')}>
        <Row title={translate('soundTitle')} description={translate('soundDesc')}><Toggle checked={soundEnabled} disabled={inactive} label={translate('soundTitle')} onChange={(next) => changeField('soundEnabled', next, () => actions.setSoundEnabled(next))} /></Row>
        <Row title={translate('soundTypeTitle')} description={translate(soundStatus === 'unavailable' ? 'soundCatalogUnavailable' : 'soundTypeDesc')}><div className="ntf-actions"><select className="ntf-select ntf-selectSound" aria-label={translate('soundTypeTitle')} value={selectedSound} disabled={inactive || soundStatus === 'loading'} onChange={(event) => changeField('sound', event.target.value, () => actions.setSound(event.target.value))}>{soundChoices.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}</select><ActionButton disabled={inactive || soundStatus !== 'ready' || busy} onClick={preview}>{translate('previewButton')}</ActionButton></div></Row>
        <Row title={translate('volumeTitle')} description={translate('volumeDesc')}><div className="ntf-volume"><input className="ntf-range" type="range" min="0" max="100" step="1" value={Math.round(volume * 100)} aria-label={translate('volumeTitle')} disabled={inactive} onChange={(event) => changeVolume(Number(event.target.value) / 100)} /><span className="ntf-volumeValue">{translate('volumeValue', { percent: Math.round(volume * 100) })}</span></div></Row>
      </CardSection>
      {error !== '' ? <p className="ntf-error" role="alert">{error}</p> : null}
      {notice !== '' ? <p className="ntf-notice" role="status">{notice}</p> : null}
      {readOnly ? <p className="ntf-note">{translate('readOnly')}</p> : null}
    </div>
  }
}
