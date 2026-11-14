import { DEFAULT_SETTINGS, LIMITS } from './model.js'
import { petPreviewUrl } from './connection.js'
import { Pagination } from '../../../client/ui/components/pagination/index.jsx'
import { ResizableDialog } from '../../../client/ui/components/resizable-dialog/index.jsx'

/** 宠物库一页 20 只，宫格每行 4 个。 */
const PAGE_SIZE = 20

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
  function Row({ title, description = undefined, children }) {
    return <div className="pet-row"><div className="pet-rowCopy"><div className="pet-title">{title}</div>{description && <div className="pet-desc">{description}</div>}</div><div className="pet-control">{children}</div></div>
  }
  function Preview({ builtIn = false, width, height }) {
    return <div className="pet-preview"><div className={`pet-screen${builtIn ? ' pet-screenNotch' : ''}`} aria-label={t('preview')}><span className="pet-island" style={{ width: `${(builtIn ? 52 : 40) * width / 100}%`, height: `${builtIn ? 14 : 14 * height / 100}px` }}><span className="pet-previewEyes" aria-hidden="true"><span>●</span><span>•••</span></span></span></div><div className="pet-previewLabel">{t(builtIn ? 'builtIn' : 'external')}</div></div>
  }
  return function PetPanel() {
    const value = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot)
    const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [query, setQuery] = useState('')
    const [library, setLibrary] = useState({ open: false, loading: false, pets: [], error: '', page: 0, pages: 1, matched: 0, filter: 'all' })
    const [installing, setInstalling] = useState(null)
    // 目录请求的序号：切筛选/翻页时旧的响应直接丢掉，这样控件不必禁用（禁用会让输入框和分页条闪一下）。
    const searchTicket = useRef(0)
    const readonly = !actions.isWritable()
    useEffect(() => { let active = true; connection.refresh().catch((reason) => { if (active) setError(String(reason.message ?? reason)) }); return () => { active = false } }, [])
    const run = async (work) => {
      setError(''); setBusy(true)
      try { await work(); return true } catch (reason) { setError(String(reason.message ?? reason)); return false } finally { setBusy(false) }
    }
    const change = (field, next) => run(() => actions.write(field, next))
    // 服务端按 offset 切片：翻页只多拉一页的元数据，不用把 5000+ 条目录搬进页面。
    const searchLibrary = async (term, page = 0, nextFilter = library.filter) => {
      const wanted = Number.isInteger(page) && page >= 0 ? page : 0
      const filter = ['all', 'installed', 'missing'].includes(nextFilter) ? nextFilter : 'all'
      const ticket = searchTicket.current + 1
      searchTicket.current = ticket
      setLibrary((current) => ({ ...current, open: true, loading: true, error: '', filter }))
      try {
        const result = await connection.catalog(term, wanted * PAGE_SIZE, PAGE_SIZE, filter)
        if (searchTicket.current !== ticket) return
        const found = Array.isArray(result?.pets) ? result.pets.filter((pet) => typeof pet?.slug === 'string') : []
        const matched = Number.isFinite(Number(result?.matched)) ? Number(result.matched) : found.length
        const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE))
        setLibrary({ open: true, loading: false, pets: found, error: '', page: Math.min(wanted, pages - 1), pages, matched, filter })
      } catch (reason) {
        if (searchTicket.current !== ticket) return
        setLibrary((current) => ({ ...current, open: true, loading: false, pets: [], error: String(reason?.message ?? reason) }))
      }
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
        const pages = Math.max(1, Math.ceil(matched / PAGE_SIZE))
        return { ...current, pets, matched, pages, page: Math.min(current.page, pages - 1) }
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
      // 只同步一次状态（「当前形象」下拉要用新的 pets 列表），不重拉目录。
      await connection.refresh()
      // 这一页只剩这一只、又被筛选掉时才退一页，避免停在空页上。
      if (!stillMatches && library.pets.length <= 1 && library.page > 0) await searchLibrary(query, library.page - 1, library.filter)
    }
    const toggle = (field) => <Row title={t(field)} description={t(`${field}Desc`)}><Toggle field={field} value={value[field]} disabled={readonly || busy} change={change} /></Row>
    const runtime = state.runtime ?? {}
    const runtimeText = !state.loaded ? 'runtimeUnknown' : runtime.status === 'error' ? 'runtimeError' : runtime.status === 'starting' ? 'runtimeStarting' : runtime.status === 'running' ? 'runtimeRunning' : runtime.available === false ? 'runtimeUnavailable' : 'runtimeStopped'
    const selected = state.pets.some((pet) => pet.id === value.activePet)
    const skippedPets = Array.isArray(state.petdex?.skipped) ? state.petdex.skipped.length : 0
    // 官方预览条是 idle 的前 6 帧横排（1152x208）：容器里只露第一格，就是这只宠物的样子。
    const tile = (pet) => {
      const name = pet.displayName || pet.slug
      const installed = pet.installed === true || state.pets.some((entry) => entry.id === `petdex:${pet.slug}`)
      return <article className={installed ? 'pet-tile pet-tileInstalled' : 'pet-tile'} key={pet.slug} title={installed ? `${name} · ${t('installed')}` : name}>
        <span className="pet-tileArt" role="img" aria-label={name} style={{ backgroundImage: `url("${petPreviewUrl(pet.slug)}")` }} />
        <div className="pet-tileCopy"><div className="pet-title">{name}</div><div className="pet-desc">{pet.slug}</div></div>
        <div className="pet-tileActions">
          {progressOf(pet.slug) !== null
            ? <span className="pet-button pet-tileButton pet-tileProgress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressOf(pet.slug)} aria-label={t('installing', { name })}>
              <span className="pet-tileProgressFill" style={{ width: `${progressOf(pet.slug)}%` }} aria-hidden="true" />
              <span className="pet-tileProgressText">{progressOf(pet.slug)}%</span>
            </span>
            : installed
              ? <button type="button" className="pet-button pet-quietButton pet-tileButton" disabled={busy} onClick={() => void run(() => togglePet(pet, true))}>{t('uninstall')}</button>
              : <button type="button" className="pet-button pet-tileButton" disabled={busy} onClick={() => void run(() => togglePet(pet, false))}>{t('install')}</button>}
        </div>
      </article>
    }
    // 重新搜索/翻页时保留上一屏的卡片（只压暗），避免整块宫格消失又重建造成「整页刷新」的观感。
    const libraryBody = library.error
      ? <p className="pet-error" role="alert">{t('catalogFailed')}</p>
      : library.pets.length === 0
        ? (library.loading ? <p className="pet-desc pet-libraryNote">{t('searching')}</p> : <p className="pet-desc pet-libraryNote">{t('noResults')}</p>)
        : <div className={library.loading ? 'pet-grid pet-gridBusy' : 'pet-grid'} aria-busy={library.loading || undefined}>{library.pets.map(tile)}</div>
    return <div className="pet-page">
      <h2 className="pet-pageTitle">{t('title')}</h2><p className="pet-pageIntro">{t('intro')}</p>
      {readonly && <p className="pet-notice" role="status">{t('readOnly')}</p>}
      {error && <p className="pet-error" role="alert">{t('failed', { reason: error })}</p>}
      <section className="pet-section" aria-label={t('appearance')}><div className="pet-sectionHeader"><h3>{t('appearance')}</h3><button type="button" className="pet-button pet-quietButton" disabled={busy} onClick={() => void run(openLibrary)}>{t('browseLibrary')}</button></div><div className="pet-card"><Row title={t('identity')} description={t('identityDesc')}><select aria-label={t('identity')} value={value.activePet} disabled={readonly || busy || !state.pets.length} onChange={(event) => change('activePet', event.target.value)}>{!selected && <option value={value.activePet}>{state.pets.length ? t('missingPet') : t('emptyPets')}</option>}{state.pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></Row></div></section>
      <section className="pet-section" aria-label={t('desktop')}><h3>{t('desktop')}</h3><div className="pet-card">{toggle('petEnabled')}<Row title={t('petSize')} description={t('petSizeDesc')}><Slider field="petSize" value={value.petSize} disabled={readonly || busy} change={change} /></Row><Row title={t('bubbleWidth')} description={t('bubbleWidthDesc')}><Slider field="bubbleWidth" value={value.bubbleWidth} disabled={readonly || busy} change={change} /></Row></div></section>
      <section className="pet-section" aria-label={t('screenTop')}><h3>{t('screenTop')}</h3><div className="pet-card">{toggle('islandEnabled')}{toggle('islandIdle')}{toggle('islandAllDisplays')}<div className="pet-size"><div className="pet-sectionHeader"><div><div className="pet-title">{t('islandSize')}</div><p className="pet-desc">{t('islandSizeDesc')}</p></div><button type="button" className="pet-button pet-quietButton" disabled={readonly || busy || (value.islandWidth === 100 && value.islandHeight === 100)} onClick={() => run(async () => { await actions.write('islandWidth', DEFAULT_SETTINGS.islandWidth); await actions.write('islandHeight', DEFAULT_SETTINGS.islandHeight) })}>{t('restore')}</button></div><div className="pet-previews"><Preview builtIn width={value.islandWidth} height={value.islandHeight} /><Preview width={value.islandWidth} height={value.islandHeight} /></div><Row title={t('width')}><Slider field="islandWidth" label={t('width')} value={value.islandWidth} disabled={readonly || busy} change={change} /></Row><Row title={t('height')}><Slider field="islandHeight" label={t('height')} value={value.islandHeight} disabled={readonly || busy} change={change} /></Row></div></div></section>
      <section className="pet-section" aria-label={t('runtime')}><h3>{t('runtime')}</h3><div className="pet-card"><Row title={t(runtimeText)} description={runtime.error}><div className="pet-runtimeActions">{state.loaded && runtime.status === 'error' ? <button className="pet-button" disabled={busy} onClick={() => run(() => connection.action('retry'))}>{t('retry')}</button> : state.loaded && runtime.available === false && runtime.status !== 'starting' ? <button className="pet-button" disabled={busy} onClick={() => run(() => connection.action('prepare'))}>{t('prepare')}</button> : state.loaded && runtime.available === true && runtime.status === 'stopped' && (value.petEnabled || value.islandEnabled) ? <button className="pet-button" disabled={busy} onClick={() => run(() => connection.action('start'))}>{t('start')}</button> : null}</div></Row>{state.loaded && !state.connected && <p className="pet-desc" role="status">{t('reconnecting')}</p>}</div></section>
      <Modal open={library.open} onClose={closeLibrary} storageKey="dsh-toolkit:pet-library-size" title={t('library')} closeLabel={t('close')} resizeLabel={t('resizeDialog')} description={t('libraryIntro')} toolbar={<form className="pet-search" onSubmit={(event) => { event.preventDefault(); void searchLibrary(query, 0, library.filter) }}><input type="search" aria-label={t('searchPets')} placeholder={t('searchPets')} value={query} onChange={(event) => setQuery(event.target.value)} /><button type="submit" className="pet-button">{t('search')}</button><div className="pet-filter" role="group" aria-label={t('filterByInstall')}>{[['all', 'filterAll'], ['installed', 'filterInstalled'], ['missing', 'filterMissing']].map(([key, label]) => <button key={key} type="button" className={library.filter === key ? 'pet-filterChip pet-filterChipActive' : 'pet-filterChip'} aria-pressed={library.filter === key} onClick={() => void searchLibrary(query, 0, key)}>{t(label)}</button>)}</div></form>} footer={!library.error && library.matched > 0
        ? <Pagination page={library.page} pages={library.pages} disabled={busy} summary={t('pageSummary', { page: library.page + 1, pages: library.pages, matched: library.matched })} onChange={(next) => void searchLibrary(query, next, library.filter)} labels={{ prev: t('prevPage'), next: t('nextPage'), label: t('pagination') }} />
        : undefined}>
        {libraryBody}
        {skippedPets > 0 && <p className="pet-desc pet-libraryNote">{t('skippedPets', { count: skippedPets })}</p>}
      </Modal>
    </div>
  }
}
