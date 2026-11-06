/* Original helper renderer; sprite artwork is licensed CC0-1.0 (see pets/NOTICE.md). */
'use strict'
const bridge = window.pet
const $ = id => document.getElementById(id)
const surface = $('surface'), cap = $('cap'), activity = $('activity'), canvas = $('sprite')
const ctx = canvas.getContext('2d')
const animations = {
  idle: [0,[280,110,110,140,140,320]], runningRight:[1,[120,120,120,120,120,120,120,220]], runningLeft:[2,[120,120,120,120,120,120,120,220]], waving:[3,[140,140,140,280]], jumping:[4,[140,140,140,140,280]], failed:[5,[140,140,140,140,140,140,140,240]], waiting:[6,[150,150,150,150,150,260]], running:[7,[120,120,120,120,120,220]], review:[8,[150,150,150,150,150,280]],
}
const words = {
  zh: { idle:'暂时没有会话活动', running:'会话执行中', waiting:'需要你处理', failed:'本轮执行失败', completed:'本轮已完成', open:'打开会话', workbench:'打开工作台', cancel:'停止', collapse:'收起', reply:'补充要求或回复…', send:'发送', permission:'请打开会话处理批准或问题', error:'操作未完成，请在会话中重试。' },
  en: { idle:'No active sessions', running:'Session running', waiting:'Needs your attention', failed:'Turn failed', completed:'Turn complete', open:'Open session', workbench:'Open workbench', cancel:'Stop', collapse:'Collapse', reply:'Reply or add instructions…', send:'Send', permission:'Open the session to review approvals or questions', error:'Action failed. Please try again in the session.' },
}
let state, expanded = false, hovered = false, image, imageKey = '', frame = 0, motion = '', look = null, timer, hoverTimer, leaveTimer, waveUntil = performance.now() + 2600, drag = null, signature = ''
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
function t(key) { return words[state?.settings.language === 'en' ? 'en' : 'zh'][key] || key }
function selectedPet() { return state.pets.find(p => p.id === state.settings.activePet) || state.pets[0] }
function dimensions() {
  if (state.display?.island) return { compact: state.display.island.compact, wide: state.display.island.expanded, height: state.display.island.height }
  const scale = Math.max(75, Math.min(150, state.settings.islandWidth || 100)) / 100
  return { compact: Math.round(220 * scale), wide: Math.max(390, Math.round(220 * scale)), height: Math.round(38 * Math.max(75, Math.min(150, state.settings.islandHeight || 100)) / 100) }
}
function layout() {
  if (!state) return
  const size = 128 * (state.settings.petSize || 100) / 100
  document.body.style.setProperty('--pet-size', `${size}px`)
  document.body.style.setProperty('--pet-height', `${size * 13 / 12}px`)
  if (state.kind === 'pet') { surface.style.width = `${state.settings.bubbleWidth || 280}px`; return }
  const g = dimensions()
  const notch = state.display?.notch
  document.body.classList.toggle('notched', Boolean(notch))
  document.body.style.setProperty('--notch-width', `${notch?.width || 0}px`)
  document.body.style.setProperty('--notch-height', `${notch?.height || 0}px`)
  surface.style.width = `${expanded ? g.wide : hovered ? Math.min(g.wide, g.compact + 24) : g.compact}px`
  const capHeight = g.height + (!expanded && hovered ? 4 : 0)
  cap.style.height = `${capHeight}px`
  activity.style.width = `${g.wide}px`
  surface.style.height = `${expanded ? Math.min(480, g.height + activity.scrollHeight) : capHeight}px`
  activity.style.maxHeight = `${480 - g.height}px`
}
function setExpanded(value) {
  const previous = expanded
  expanded = Boolean(value)
  document.body.classList.toggle('expanded', expanded)
  document.body.classList.toggle('closing', previous && !expanded)
  clearTimeout(hoverTimer)
  layout()
}
function element(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node }
async function action(value, button) {
  if (button) button.disabled = true
  const result = await bridge.action(value).catch(() => ({ ok: false }))
  if (button) button.disabled = false
  $('error').textContent = result.ok ? '' : t('error')
  layout()
  return result.ok
}
function renderSessions() {
  const next = JSON.stringify([state.settings.language, state.sessions.slice(0, 2)])
  if (signature === next) return
  // Preserve a focused draft while streamed detail text changes.
  const drafts = new Map([...$('sessions').querySelectorAll('form')].map(form => [form.dataset.session, form.querySelector('input').value]))
  const focused = document.activeElement?.closest('form')?.dataset.session
  signature = next
  const list = []
  for (const session of state.sessions.slice(0, 2)) {
    const card = element('article', '', 'session')
    card.append(element('h2', session.title || t(session.status)))
    card.append(element('p', session.detail || t(session.status), 'detail'))
    const actions = element('div', '', 'actions')
    const open = element('button', t('open')); open.type = 'button'; open.onclick = () => action({ action: 'open', sessionId: session.id }, open); actions.append(open)
    if (session.running || session.status === 'running') { const cancel = element('button', t('cancel'), 'stop'); cancel.type = 'button'; cancel.onclick = () => action({ action:'cancel', sessionId:session.id }, cancel); actions.append(cancel) }
    card.append(actions)
    if (session.pendingKind || session.status === 'waiting') card.append(element('p', t('permission'), 'detail'))
    else {
      const form = element('form'); form.dataset.session = session.id
      const input = element('input'); input.placeholder = t('reply'); input.setAttribute('aria-label', t('reply')); input.maxLength = 8000; input.value = drafts.get(session.id) || ''
      input.onfocus = () => { bridge.focus(); clearTimeout(leaveTimer) }
      input.onpointerdown = () => bridge.focus()
      const send = element('button', '↑'); send.type = 'submit'; send.setAttribute('aria-label', t('send')); send.title = t('send')
      form.append(input, send)
      form.onsubmit = async event => { event.preventDefault(); if (!input.value.trim()) return; if (await action({ action:'prompt', sessionId:session.id, text:input.value }, send)) input.value = '' }
      card.append(form)
    }
    list.push(card)
  }
  $('sessions').replaceChildren(...list)
  if (focused) [...$('sessions').querySelectorAll('form')].find(form => form.dataset.session === focused)?.querySelector('input').focus()
  $('workbench').textContent = t('workbench'); $('workbench').disabled = !state.sessions[0]; $('collapse').textContent = t('collapse')
  $('activity-label').textContent = state.settings.language === 'en' ? 'LIVE ACTIVITY' : '实时活动'
  $('session-count').textContent = state.sessions.length ? `${state.sessions.length} ${state.settings.language === 'en' ? 'sessions' : '个会话'}` : ''
}
function update(next) {
  state = next
  document.documentElement.lang = next.settings.language === 'en' ? 'en' : 'zh-CN'
  document.body.classList.toggle('pet', state.kind === 'pet')
  document.body.classList.toggle('island', state.kind === 'island')
  const current = state.sessions[0]
  document.body.dataset.status = current?.status || 'idle'
  $('summary').textContent = current ? `${t(current.status)}${state.sessions.length > 1 ? ` · ${state.sessions.length}` : ''}` : t('idle')
  cap.setAttribute('aria-label', current ? `${current.title} · ${t(current.status)}` : t('idle'))
  const pet = selectedPet()
  if (pet && imageKey !== pet.spritesheet) {
    imageKey = pet.spritesheet; image = new Image(); image.onload = draw; image.onerror = () => { $('error').textContent = t('error') }; image.src = imageKey
  }
  renderSessions(); layout(); animate()
}
function currentMotion() {
  if (drag?.moved) return drag.direction < 0 ? 'runningLeft' : 'runningRight'
  if (hovered && state.kind === 'pet') return 'jumping'
  if (performance.now() < waveUntil) return 'waving'
  if (look !== null && selectedPet()?.spriteVersionNumber === 2) return 'look'
  return state.sessions[0]?.status || 'idle'
}
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!image?.complete || !image.naturalWidth) return
  const rows = selectedPet()?.spriteVersionNumber === 2 ? 11 : 9
  const cw = image.naturalWidth / 8, ch = image.naturalHeight / rows
  const cell = motion === 'look' ? [9 + Math.floor(look / 8), look % 8] : [animations[motion]?.[0] || 0, frame]
  ctx.drawImage(image, cell[1] * cw, cell[0] * ch, cw, ch, 0, 0, canvas.width, canvas.height)
}
function animate() {
  clearTimeout(timer)
  if (!state || document.hidden) return
  const next = currentMotion()
  if (motion !== next) { motion = next; frame = 0 }
  draw()
  if (reduced.matches || next === 'look') return
  const delays = (animations[next] || animations.idle)[1]
  timer = setTimeout(() => { frame = (frame + 1) % delays.length; animate() }, delays[frame])
}
cap.onclick = () => { if (!drag?.moved) setExpanded(!expanded) }
surface.onpointerenter = () => { hovered = true; clearTimeout(leaveTimer); bridge.interactive(true); layout(); animate(); if (state?.kind === 'island') hoverTimer = setTimeout(() => setExpanded(true), 300) }
surface.onpointerleave = () => { hovered = false; clearTimeout(hoverTimer); layout(); animate(); if (!drag) bridge.interactive(false); leaveTimer = setTimeout(() => { if (!surface.matches(':hover') && !surface.contains(document.activeElement)) setExpanded(false) }, 100) }
document.addEventListener('pointermove', event => {
  const target = document.elementFromPoint(event.clientX, event.clientY)
  bridge.interactive(Boolean(drag || surface.contains(target)))
  if (drag) {
    const dx = event.screenX - drag.x, dy = event.screenY - drag.y
    if (Math.hypot(dx, dy) >= 4) drag.moved = true
    drag.direction = dx
    if (drag.moved) bridge.drag('move')
  } else if (state?.kind === 'pet' && !hovered) {
    const rect = canvas.getBoundingClientRect(), dx = event.clientX - (rect.x + rect.width / 2), dy = event.clientY - (rect.y + rect.height / 2)
    look = Math.abs(dx) <= 200 && Math.abs(dy) <= 200 && Math.hypot(dx, dy) > Math.max(40, Math.min(rect.width, rect.height) * .38) ? (Math.round(Math.atan2(dx, -dy) / (Math.PI / 8)) + 16) % 16 : null
  }
  animate()
})
cap.onpointerdown = event => { if (state?.kind !== 'pet' || event.button !== 0) return; cap.setPointerCapture(event.pointerId); drag = { x:event.screenX, y:event.screenY, direction:0, moved:false }; bridge.drag('start') }
cap.onpointerup = () => { if (!drag) return; bridge.drag('end'); setTimeout(() => { drag = null; animate() }, 0) }
cap.onpointercancel = () => { if (drag) bridge.drag('end'); drag = null; animate() }
$('collapse').onclick = () => setExpanded(false)
$('workbench').onclick = () => { const sessionId = state?.sessions[0]?.id; if (sessionId) action({ action:'open', sessionId }, $('workbench')) }
document.addEventListener('keydown', event => { if (event.key === 'Escape') { document.activeElement?.blur(); setExpanded(false) } })
document.addEventListener('visibilitychange', animate)
reduced.addEventListener('change', animate)
bridge.onState(update)
bridge.onCollapse(() => setExpanded(false))
bridge.initial().then(update)
window.addEventListener('unload', () => { clearTimeout(timer); clearTimeout(hoverTimer); clearTimeout(leaveTimer) })
