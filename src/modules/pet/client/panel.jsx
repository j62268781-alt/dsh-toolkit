import { DEFAULT_SETTINGS, LIMITS } from './model.js'

export function createPetPanel(React, { t, settings, connection, actions, primitives }) {
  const { useEffect, useRef, useState, useSyncExternalStore } = React
  const Switch = primitives?.Switch
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
  function Row({ title, description, children }) {
    return <div className="pet-row"><div className="pet-rowCopy"><div className="pet-title">{title}</div>{description && <div className="pet-desc">{description}</div>}</div><div className="pet-control">{children}</div></div>
  }
  function Preview({ builtIn, width, height }) {
    return <div className="pet-preview"><div className={`pet-screen${builtIn ? ' pet-screenNotch' : ''}`} aria-label={t('preview')}><span className="pet-island" style={{ width: `${(builtIn ? 52 : 40) * width / 100}%`, height: `${14 * height / 100}px` }}><span className="pet-previewEyes">••</span></span></div><div className="pet-previewLabel">{t(builtIn ? 'builtIn' : 'external')}</div></div>
  }
  return function PetPanel() {
    const value = useSyncExternalStore(settings.subscribe, settings.getSnapshot, settings.getSnapshot)
    const state = useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const readonly = !actions.isWritable()
    useEffect(() => { let active = true; connection.refresh().catch((reason) => { if (active) setError(String(reason.message ?? reason)) }); return () => { active = false } }, [])
    const run = async (work) => {
      setError(''); setBusy(true)
      try { await work(); return true } catch (reason) { setError(String(reason.message ?? reason)); return false } finally { setBusy(false) }
    }
    const change = (field, next) => run(() => actions.write(field, next))
    const toggle = (field) => <Row title={t(field)} description={t(`${field}Desc`)}><Toggle field={field} value={value[field]} disabled={readonly || busy} change={change} /></Row>
    const runtime = state.runtime ?? {}
    const runtimeText = !state.loaded ? 'runtimeUnknown' : runtime.status === 'error' ? 'runtimeError' : runtime.status === 'starting' ? 'runtimeStarting' : runtime.status === 'running' ? 'runtimeRunning' : runtime.available === false ? 'runtimeUnavailable' : 'runtimeStopped'
    const selected = state.pets.some((pet) => pet.id === value.activePet)
    return <div className="pet-page">
      <h2 className="pet-pageTitle">{t('title')}</h2><p className="pet-pageIntro">{t('intro')}</p>
      {readonly && <p className="pet-notice" role="status">{t('readOnly')}</p>}
      {error && <p className="pet-error" role="alert">{t('failed', { reason: error })}</p>}
      <section className="pet-section" aria-label={t('appearance')}><div className="pet-sectionHeader"><h3>{t('appearance')}</h3><button type="button" className="pet-button pet-quietButton" disabled={busy} onClick={() => run(connection.refresh)}>{t('refresh')}</button></div><div className="pet-card"><Row title={t('identity')} description={t('identityDesc')}><select aria-label={t('identity')} value={value.activePet} disabled={readonly || busy || !state.pets.length} onChange={(event) => change('activePet', event.target.value)}>{!selected && <option value={value.activePet}>{state.pets.length ? t('missingPet') : t('emptyPets')}</option>}{state.pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></Row></div></section>
      <section className="pet-section" aria-label={t('desktop')}><h3>{t('desktop')}</h3><div className="pet-card">{toggle('petEnabled')}<Row title={t('petSize')} description={t('petSizeDesc')}><Slider field="petSize" value={value.petSize} disabled={readonly || busy} change={change} /></Row><Row title={t('bubbleWidth')} description={t('bubbleWidthDesc')}><Slider field="bubbleWidth" value={value.bubbleWidth} disabled={readonly || busy} change={change} /></Row></div></section>
      <section className="pet-section" aria-label={t('screenTop')}><h3>{t('screenTop')}</h3><div className="pet-card">{toggle('islandEnabled')}{toggle('islandIdle')}{toggle('islandAllDisplays')}<div className="pet-size"><div className="pet-sectionHeader"><div><div className="pet-title">{t('islandSize')}</div><p className="pet-desc">{t('islandSizeDesc')}</p></div><button type="button" className="pet-button pet-quietButton" disabled={readonly || busy || (value.islandWidth === 100 && value.islandHeight === 100)} onClick={() => run(async () => { await actions.write('islandWidth', DEFAULT_SETTINGS.islandWidth); await actions.write('islandHeight', DEFAULT_SETTINGS.islandHeight) })}>{t('restore')}</button></div><div className="pet-previews"><Preview builtIn width={value.islandWidth} height={value.islandHeight} /><Preview width={value.islandWidth} height={value.islandHeight} /></div><Row title={t('width')}><Slider field="islandWidth" label={t('width')} value={value.islandWidth} disabled={readonly || busy} change={change} /></Row><Row title={t('height')}><Slider field="islandHeight" label={t('height')} value={value.islandHeight} disabled={readonly || busy} change={change} /></Row></div></div></section>
      <section className="pet-section" aria-label={t('runtime')}><h3>{t('runtime')}</h3><div className="pet-card"><Row title={t(runtimeText)} description={runtime.error}><div className="pet-runtimeActions">{state.loaded && runtime.status === 'error' ? <button className="pet-button" disabled={busy} onClick={() => run(() => connection.action('retry'))}>{t('retry')}</button> : state.loaded && runtime.available === false && runtime.status !== 'starting' ? <button className="pet-button" disabled={busy} onClick={() => run(() => connection.action('prepare'))}>{t('prepare')}</button> : state.loaded && runtime.available === true && runtime.status === 'stopped' && (value.petEnabled || value.islandEnabled) ? <button className="pet-button" disabled={busy} onClick={() => run(() => connection.action('start'))}>{t('start')}</button> : null}</div></Row>{state.loaded && !state.connected && <p className="pet-desc" role="status">{t('reconnecting')}</p>}</div></section>
    </div>
  }
}
