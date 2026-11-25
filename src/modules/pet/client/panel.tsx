import { DEFAULT_SETTINGS, LIMITS } from './model.js'
import { petPreviewUrl } from './connection.js'
import { ResizableDialog } from '../../../client/ui/components/resizable-dialog/index.jsx'
import { CardSection, OptionGrid, PageHeader, Row } from '../../../client/ui/components/settings-parts/index.jsx'
import { toast } from '../../../client/ui/toast.js'

// 宠物库一批 60 只（host 的上限也是 60）：目录有 5000+ 条，滚到底再续拉下一批，
// 页面里永远只有「已经滚过的那些」，不把整份目录一次性搬进来。
const LIBRARY_BATCH = 60

export function createPetPanel(React, { t, settings, connection, actions, primitives }) {
  const { useEffect, useRef, useState, useSyncExternalStore } = React
  const Switch = primitives?.Switch
  const Modal = ResizableDialog
  function Toggle({ field, value, disabled, change }) {
    if (Switch !== undefined) return <Switch checked={value} disabled={disabled} label={t(field)} onChange={(next) => change(field, next === true)} />
    return <button type="button" className="pet-switch" role="switch" aria-label={t(field)} aria-checked={value} disabled={disabled} onClick={() => change(field, !value)}><span /></button>
  }
  function Slider({ field, value, disabled, change, label = t(field) }) {
    const [draft, setDraft] = useState(value)
    const timer = useRef()
    const actual = useRef(value)
    actual.current = value
    useEffect(() => { if (!timer.current) setDraft(value) }, [value])
    useEffect(() => () => clearTimeout(timer.current), [])
    const [min, max, step] = LIMITS[field]
    const update = (next) => {
      setDraft(next)
      clearTimeout(timer.current)
      timer.current = setTimeout(async () => {
        timer.current = undefined
        if (await change(field, next) === false) setDraft(actual.current)
      }, 180)
    }
    return <label className="pet-slider"><input type="range" aria-label={label} min={min} max={max} step={step} value={draft} disabled={disabled} onChange={(event) => update(Number(event.target.value))} /><output>{draft}{field === 'bubbleWidth' ? ' px' : '%'}</output></label>
  }
  function Preview({ builtIn = false, width, height }) {
    return <div className="pet-preview"><div className={`pet-screen${builtIn ? ' pet-screenNotch' : ''}`} aria-label={t('preview')}><span className="pet-island" style={{ width: `${(builtIn ? 52 : 40) * width / 100}%`, height: `${builtIn ? 14 : 14 * height / 100}px` }}><span className="pet-previewEyes" aria-hidden="true"><span>●</span><span>•••</span></span></span></div><div className="pet-previewLabel">{t(builtIn ? 'builtIn' : 'external')}</div></div>
  }
  return function PetPanel() {
    const value = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot)
    const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
    // 正在跑的动作（只禁用它自己那个控件）：共用一个 busy 会让点任何一下都把整页控件闪成灰。
    const [pending, setPending] = useState(null)
    // 配置写入的乐观回显：写下去就立刻按新值画，等宿主回执到了再撤掉。
    const [echo, setEcho] = useState({})
    const [query, setQuery] = useState('')
    // refreshing 只在「换关键词/换筛选」时为真，用来压暗旧卡片；滚动续拉不改它，否则每批都闪一下。
    const [library, setLibrary] = useState({ open: false, loading: false, refreshing: false, pets: [], error: '', matched: 0, filter: 'all', done: false })
    const [installing, setInstalling] = useState(null)
    // 目录请求的序号：换关键词/切筛选/续拉时旧的响应直接丢掉，这样控件不必禁用（禁用会让输入框闪一下）。
    const searchTicket = useRef(0)
    // 每个字段一条写入队列：同一字段的多次点击按顺序排队，后到的值覆盖先到的。
    const queue = useRef(new Map())
    const readonly = !actions.isWritable()
    useEffect(() => { let active = true; connection.refresh().catch((reason) => { if (active) toast.error(String(reason.message ?? reason)) }); return () => { active = false } }, [])
    const run = async (key, work) => {
      setPending(key)
      try { await work(); return true } catch (reason) { toast.error(String(reason.message ?? reason)); return false } finally { setPending((current) => (current === key ? null : current)) }
    }
    const busyFor = (key) => pending === key
    // 配置写入期间**不**禁用控件：宿主的 Switch 是原生 <button disabled>，写入时它会变灰并吃掉点击；
    // range 拖到一半被 disabled 更会直接中断这次拖动 —— 用户感知就是「点一下卡一下」。
    // 这里改成乐观回显 + 按字段排队，控件始终保持可点。
    const drain = async (field, slot) => {
      slot.running = true
      let ok = true
      try {
        // 连续点击 / 拖动只把最后一个值写下去，中间的过渡值不必打扰宿主。
        while (slot.next !== undefined) {
          const next = slot.next
          slot.next = undefined
          await actions.write(field, next)
        }
      } catch (reason) {
        ok = false
        slot.next = undefined
        toast.error(String(reason?.message ?? reason))
      }
      slot.running = false
      if (slot.next !== undefined) { void drain(field, slot); return }
      queue.current.delete(field)
      // 回执已落进配置快照，撤掉回显让界面回到唯一真源；失败时这一步就是回滚。
      setEcho((current) => { if (!(field in current)) return current; const copy = { ...current }; delete copy[field]; return copy })
      const { waiters } = slot
      slot.waiters = []
      for (const settle of waiters) settle(ok)
    }
    const write = (field, next) => {
      setEcho((current) => (current[field] === next ? current : { ...current, [field]: next }))
      let slot = queue.current.get(field)
      if (!slot) { slot = { next: undefined, running: false, waiters: [] }; queue.current.set(field, slot) }
      slot.next = next
      const settled = new Promise((resolve) => slot.waiters.push(resolve))
      if (!slot.running) void drain(field, slot)
      return settled
    }
    const change = (field, next) => write(field, next)
    // 显示值：回显优先，其余读配置快照。
    const shown = (field) => (Object.prototype.hasOwnProperty.call(echo, field) ? echo[field] : value[field])
    // 服务端按 offset 切片：每批只多拉 60 条元数据，不用把 5000+ 条目录搬进页面。
    // offset 为 0 是「换关键词/换筛选」，旧卡片先留着（压暗）等新结果到；否则是续拉，追加在末尾。
    const searchLibrary = async (term, offset = 0, nextFilter = library.filter) => {
      const from = Number.isInteger(offset) && offset > 0 ? offset : 0
      const filter = ['all', 'installed', 'missing'].includes(nextFilter) ? nextFilter : 'all'
      const ticket = searchTicket.current + 1
      searchTicket.current = ticket
      setLibrary((current) => ({ ...current, open: true, loading: true, refreshing: from === 0, error: '', filter }))
      try {
        const result = await connection.catalog(term, from, LIBRARY_BATCH, filter)
        if (searchTicket.current !== ticket) return
        const found = Array.isArray(result?.pets) ? result.pets.filter((pet) => typeof pet?.slug === 'string') : []
        const matched = Number.isFinite(Number(result?.matched)) ? Number(result.matched) : from + found.length
        setLibrary((current) => {
          const known = new Set(from === 0 ? [] : current.pets.map((pet) => pet.slug))
          const pets = from === 0 ? found : [...current.pets, ...found.filter((pet) => !known.has(pet.slug))]
          // 空批次也当到底：host 的 matched 与实际可切片数量未必严格一致，来回滚不该反复空转。
          return { open: true, loading: false, refreshing: false, pets, error: '', matched, filter, done: found.length === 0 || pets.length >= matched }
        })
      } catch (reason) {
        if (searchTicket.current !== ticket) return
        setLibrary((current) => ({ ...current, open: true, loading: false, refreshing: false, error: String(reason?.message ?? reason) }))
      }
    }
    // 滚到底自动续拉：loading/done 都在 state 上，滚动事件再密也只会发一次。
    const loadMore = () => {
      if (!library.open || library.loading || library.done || library.error) return
      void searchLibrary(query, library.pets.length, library.filter)
    }
    const openLibrary = () => { setLibrary((current) => ({ ...current, open: true })); return searchLibrary(query, 0) }
    const closeLibrary = () => setLibrary((current) => ({ ...current, open: false }))
    // 安装期间 host 会把下载百分比写进 snapshot（petdex.progress），这里据此把按钮画成进度条。
    const progressOf = (slug) => {
      if (installing !== slug) return null
      const live = state.petdex?.progress
      return live?.slug === slug && Number.isFinite(Number(live.percent)) ? Math.round(Number(live.percent)) : 0
    }
    // 安装/卸载只改这一张卡：目录页不重拉，否则整块宫格会闪一下、滚动位置也会跳（看起来像整页刷新）。
    const patchInstalled = (slug, installed) => {
      setLibrary((current) => {
        const stillMatches = current.filter === 'all' || (current.filter === 'installed') === installed
        const patched = current.pets.map((pet) => (pet.slug === slug ? { ...pet, installed } : pet))
        const pets = stillMatches ? patched : patched.filter((pet) => pet.slug !== slug)
        const matched = stillMatches ? current.matched : Math.max(0, current.matched - 1)
        return { ...current, pets, matched, done: pets.length >= matched }
      })
    }
    const togglePet = async (pet, installed) => {
      if (installed) await connection.removePet(pet.slug)
      else {
        setInstalling(pet.slug)
        try { await connection.installPet(pet.slug) } finally { setInstalling(null) }
      }
      const stillMatches = library.filter === 'all' || (library.filter === 'installed') === !installed
      patchInstalled(pet.slug, !installed)
      // 只同步一次状态（「当前形象」下拉要用新的 pets 列表），不重拉目录：重拉会把滚动位置跳回顶部。
      await connection.refresh()
      // 被筛选掉的那张卡带走最后一屏时补拉一批，别让用户对着空列表手动滚。
      if (!stillMatches && library.pets.length <= 1 && !library.done) void searchLibrary(query, library.pets.length, library.filter)
    }
    const toggle = (field) => <Row title={t(field)} description={t(`${field}Desc`)}><Toggle field={field} value={shown(field)} disabled={readonly} change={change} /></Row>
    const runtime = state.runtime ?? {}
    const runtimeText = !state.loaded ? 'runtimeUnknown' : runtime.status === 'error' ? 'runtimeError' : runtime.status === 'starting' ? 'runtimeStarting' : runtime.status === 'running' ? 'runtimeRunning' : runtime.available === false ? 'runtimeUnavailable' : 'runtimeStopped'
    // 准备运行时期间的进度（host 在 `runtime.progress` 里推）：一次 138MB 的下载没有百分比，
    // 用户看到的就是「一直在安装」。
    const runtimeProgress = runtime.progress && Number.isFinite(Number(runtime.progress.percent)) ? runtime.progress : undefined
    const runtimePercent = runtimeProgress ? Math.max(0, Math.min(100, Math.round(Number(runtimeProgress.percent)))) : null
    const megabytes = (bytes) => (Math.max(0, Number(bytes) || 0) / (1024 * 1024)).toFixed(1)
    const runtimePhase = String(runtimeProgress?.phase ?? '')
    const runtimeDescription = runtime.error
      ?? (runtimePercent === null ? undefined
        : runtimePhase === 'tidy' ? t('runtimeTrimming')
          : runtimePhase === 'download' && Number(runtimeProgress.total) > 0 ? t('runtimeDownload', { percent: runtimePercent, received: megabytes(runtimeProgress.received), total: megabytes(runtimeProgress.total) })
            : t('runtimeProgress', { percent: runtimePercent }))
    const selected = state.pets.some((pet) => pet.id === shown('activePet'))
    const skippedPets = Array.isArray(state.petdex?.skipped) ? state.petdex.skipped.length : 0
    // 官方预览条是 idle 的前 6 帧横排（1152x208）：容器里只露第一格，就是这只宠物的样子。
    const tile = (pet) => {
      const name = pet.displayName || pet.slug
      const installed = pet.installed === true || state.pets.some((entry) => entry.id === `petdex:${pet.slug}`)
      return <article className={installed ? 'pet-tile pet-tileInstalled' : 'pet-tile'} key={pet.slug} title={installed ? `${name} · ${t('installed')}` : name}>
        <span className="pet-tileArt" role="img" aria-label={name}><img src={petPreviewUrl(pet.slug)} alt="" loading="lazy" decoding="async" /></span>
        <div className="pet-tileCopy"><div className="pet-title">{name}</div><div className="pet-desc">{pet.slug}</div></div>
        <div className="pet-tileActions">
          {progressOf(pet.slug) !== null
            ? <span className="pet-button pet-tileButton pet-tileProgress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressOf(pet.slug)} aria-label={t('installing', { name })}>
              <span className="pet-tileProgressFill" style={{ width: `${progressOf(pet.slug)}%` }} aria-hidden="true" />
              <span className="pet-tileProgressText">{progressOf(pet.slug)}%</span>
            </span>
            : installed
              ? <button type="button" className="pet-button pet-quietButton pet-tileButton" disabled={busyFor(`pet:${pet.slug}`)} onClick={() => void run(`pet:${pet.slug}`, () => togglePet(pet, true))}>{t('uninstall')}</button>
              : <button type="button" className="pet-button pet-tileButton" disabled={busyFor(`pet:${pet.slug}`)} onClick={() => void run(`pet:${pet.slug}`, () => togglePet(pet, false))}>{t('install')}</button>}
        </div>
      </article>
    }
    // 换关键词/切筛选时保留上一屏卡片（只压暗），避免整块宫格消失又重建造成「整页刷新」的观感。
    // 滚动续拉不压暗：那只是末尾多一批，旧卡片本身就还是有效的。
    const libraryBody = library.error
      ? <p className="pet-error" role="alert">{t('catalogFailed')}</p>
      : library.pets.length === 0
        ? (library.loading ? <p className="pet-desc pet-libraryNote">{t('searching')}</p> : <p className="pet-desc pet-libraryNote">{t('noResults')}</p>)
        : <OptionGrid columns={6} className={library.refreshing ? 'pet-grid pet-gridBusy' : 'pet-grid'} aria-busy={library.refreshing || undefined}>{library.pets.map(tile)}</OptionGrid>
    return <div className="pet-page">
      <PageHeader title={t('title')} subtitle={t('intro')} />
      {readonly && <p className="pet-notice" role="status">{t('readOnly')}</p>}
      <CardSection className="pet-section" title={t('appearance')} aria-label={t('appearance')} hint={<button type="button" className="pet-button pet-quietButton" disabled={busyFor('catalog')} onClick={() => void run('catalog', openLibrary)}>{t('browseLibrary')}</button>}><Row title={t('identity')} description={t('identityDesc')}><select aria-label={t('identity')} value={shown('activePet')} disabled={readonly || !state.pets.length} onChange={(event) => void change('activePet', event.target.value)}>{!selected && <option value={shown('activePet')}>{state.pets.length ? t('missingPet') : t('emptyPets')}</option>}{state.pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></Row></CardSection>
      <CardSection className="pet-section" title={t('desktop')} aria-label={t('desktop')}>{toggle('petEnabled')}<Row title={t('petSize')} description={t('petSizeDesc')}><Slider field="petSize" value={shown('petSize')} disabled={readonly} change={change} /></Row><Row title={t('bubbleWidth')} description={t('bubbleWidthDesc')}><Slider field="bubbleWidth" value={shown('bubbleWidth')} disabled={readonly} change={change} /></Row></CardSection>
      <CardSection className="pet-section" title={t('screenTop')} aria-label={t('screenTop')}>{toggle('islandEnabled')}{toggle('islandIdle')}{toggle('islandAllDisplays')}<div className="pet-size"><div className="pet-sectionHeader"><div><div className="pet-title">{t('islandSize')}</div><p className="pet-desc">{t('islandSizeDesc')}</p></div><button type="button" className="pet-button pet-quietButton" disabled={readonly || (shown('islandWidth') === DEFAULT_SETTINGS.islandWidth && shown('islandHeight') === DEFAULT_SETTINGS.islandHeight)} onClick={() => { void write('islandWidth', DEFAULT_SETTINGS.islandWidth); void write('islandHeight', DEFAULT_SETTINGS.islandHeight) }}>{t('restore')}</button></div><div className="pet-previews"><Preview builtIn width={shown('islandWidth')} height={shown('islandHeight')} /><Preview width={shown('islandWidth')} height={shown('islandHeight')} /></div><Row title={t('width')}><Slider field="islandWidth" label={t('width')} value={shown('islandWidth')} disabled={readonly} change={change} /></Row><Row title={t('height')}><Slider field="islandHeight" label={t('height')} value={shown('islandHeight')} disabled={readonly} change={change} /></Row></div></CardSection>
      <CardSection className="pet-section" title={t('runtime')} aria-label={t('runtime')}><Row title={t(runtimeText)} description={runtimeDescription}><div className="pet-runtime">{runtimePercent === null ? null : <div className="pet-runtimeBar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={runtimePercent} aria-label={t('runtime')}><span className="pet-runtimeBarFill" style={{ width: `${runtimePercent}%` }} aria-hidden="true" /></div>}<div className="pet-runtimeActions">{state.loaded && runtime.status === 'error' ? <button className="pet-button" disabled={busyFor('action:retry')} onClick={() => run('action:retry', () => connection.action('retry'))}>{t('retry')}</button> : state.loaded && runtime.available === false && runtime.status !== 'starting' ? <button className="pet-button" disabled={busyFor('action:prepare')} onClick={() => run('action:prepare', () => connection.action('prepare'))}>{t('prepare')}</button> : state.loaded && runtime.available === true && runtime.status === 'stopped' && (value.petEnabled || value.islandEnabled) ? <button className="pet-button" disabled={busyFor('action:start')} onClick={() => run('action:start', () => connection.action('start'))}>{t('start')}</button> : null}</div></div></Row>{state.loaded && !state.connected && <p className="pet-desc" role="status">{t('reconnecting')}</p>}</CardSection>
      <Modal open={library.open} onClose={closeLibrary} storageKey="dsh-toolkit:pet-library-size" title={t('library')} closeLabel={t('close')} resizeLabel={t('resizeDialog')} description={t('libraryIntro')} onBodyScroll={(event) => { const body = event.currentTarget; if (body.scrollHeight - body.scrollTop - body.clientHeight <= 320) loadMore() }} toolbar={<form className="pet-search" onSubmit={(event) => { event.preventDefault(); void searchLibrary(query, 0, library.filter) }}><input type="search" aria-label={t('searchPets')} placeholder={t('searchPets')} value={query} onChange={(event) => setQuery(event.target.value)} /><button type="submit" className="pet-button">{t('search')}</button><div className="pet-filter" role="group" aria-label={t('filterByInstall')}>{[['all', 'filterAll'], ['installed', 'filterInstalled'], ['missing', 'filterMissing']].map(([key, label]) => <button key={key} type="button" className={library.filter === key ? 'pet-filterChip pet-filterChipActive' : 'pet-filterChip'} aria-pressed={library.filter === key} onClick={() => void searchLibrary(query, 0, key)}>{t(label)}</button>)}</div></form>} footer={!library.error && library.pets.length > 0
        ? <p className="pet-desc pet-libraryCount" aria-live="polite">{library.done ? t('libraryDone', { matched: library.matched }) : t('libraryCount', { loaded: library.pets.length, matched: library.matched })}</p>
        : undefined}>
        {libraryBody}
        {skippedPets > 0 && <p className="pet-desc pet-libraryNote">{t('skippedPets', { count: skippedPets })}</p>}
      </Modal>
    </div>
  }
}
