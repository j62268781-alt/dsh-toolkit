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
  zh: { idle:'暂时没有会话活动', running:'会话执行中', waiting:'需要你处理', failed:'本轮执行失败', completed:'本轮已完成', open:'打开会话', reply:'补充要求或回复…', send:'发送', permission:'请打开会话处理批准或问题', error:'操作未完成，请在会话中重试。', greeting:'hi~' },
  en: { idle:'No active sessions', running:'Session running', waiting:'Needs your attention', failed:'Turn failed', completed:'Turn complete', open:'Open session', reply:'Reply or add instructions…', send:'Send', permission:'Open the session to review approvals or questions', error:'Action failed. Please try again in the session.', greeting:'hi~' },
}
// Qoder 的收起态只有「宠物 + 状态徽标」，状态靠短语 + 语义色表达，数量进 tooltip。
const badges = {
  zh: { running:'正在工作', waiting:'需要你处理', completed:'有新结果', failed:'失败' },
  en: { running:'Working', waiting:'Needs you', completed:'New result', failed:'Failed' },
}
let state, expanded = false, hovered = false, image, imageKey = '', frame = 0, motion = '', look = null, timer, hoverTimer, leaveTimer, waveUntil = performance.now() + 2600, drag = null, padChecks = 0, lastPointer = null, signature = ''
const meter = document.createElement('canvas').getContext?.('2d') || null
// JSDOM 里没有 canvas 量宽，退回按字宽估算（CJK 1em、ASCII 约 0.56em）。
function measureText(text, size) {
  if (meter && typeof meter.measureText === 'function') { meter.font = `600 ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; return meter.measureText(text).width }
  let width = 0
  for (const char of text) width += char.codePointAt(0) > 0x2e7f ? size : size * 0.56
  return width
}
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
function t(key) { return words[state?.settings.language === 'en' ? 'en' : 'zh'][key] || key }
function badgeWord(status) { return badges[state?.settings.language === 'en' ? 'en' : 'zh'][status] || t(status) }
// 仿 Qoder dt()：按徽标文案量宽 → 夹进区间 → 取偶数 → 再被几何宽封顶（菜单里调宽度仍生效）。
function compactWidth(status) {
  const g = dimensions()
  const notch = state?.display?.notch
  if (!state || state.kind !== 'island') return g.compact
  const text = status === 'idle' ? t('greeting') : badgeWord(status)
  const badge = Math.ceil(measureText(text, 11.5)) + 12 + 4 + 14
  const side = Math.max(27, badge)
  const natural = notch ? Math.round(notch.width + 2 * (12 + side)) : Math.round(16 + 2 * side)
  const low = notch ? Math.min(g.compact, 300) : 212
  const high = notch ? Math.min(g.compact, 360) : Math.min(g.compact, 280)
  return Math.max(low, Math.min(high, natural + (natural % 2)))
}
function selectedPet() { return state.pets.find(p => p.id === state.settings.activePet) || state.pets[0] }
function dimensions() {
  if (state.display?.island) return { compact: state.display.island.compact, wide: state.display.island.expanded, height: state.display.island.height }
  const scale = Math.max(75, Math.min(150, state.settings.islandWidth || 100)) / 100
  const compact = Math.min(360, Math.round(280 * scale))
  return { compact, wide: Math.max(390, compact), height: Math.round(38 * Math.max(75, Math.min(150, state.settings.islandHeight || 100)) / 100) }
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
  const compact = compactWidth(state.sessions[0]?.status || 'idle')
  surface.style.width = `${expanded ? g.wide : hovered ? Math.min(g.wide, compact + 32) : compact}px`
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
    const open = element('button', '', 'session-open'); open.type = 'button'
    open.title = t('open'); open.setAttribute('aria-label', `${session.title || t(session.status)} · ${t('open')}`)
    open.append(element('span', session.title || t(session.status), 'title'))
    open.append(element('span', session.detail || t(session.status), 'detail'))
    open.onclick = () => action({ action: 'open', sessionId: session.id }, open)
    card.append(open)
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
  $('activity-label').textContent = state.settings.language === 'en' ? 'LIVE ACTIVITY' : '实时活动'
  $('session-count').textContent = state.sessions.length ? `${state.sessions.length} ${state.settings.language === 'en' ? 'sessions' : '个会话'}` : ''
}
function update(next) {
  state = next
  document.documentElement.lang = next.settings.language === 'en' ? 'en' : 'zh-CN'
  document.body.classList.toggle('pet', state.kind === 'pet')
  document.body.classList.toggle('island', state.kind === 'island')
  const current = state.sessions[0]
  const status = current?.status || 'idle'
  const count = state.sessions.length
  document.body.dataset.status = status
  $('badge-text').textContent = status === 'idle' ? t('greeting') : badgeWord(status)
  const hint = status === 'idle' ? t('idle') : `${t(status)}${count > 1 ? ` · ${count}` : ''}`
  cap.title = hint
  cap.setAttribute('aria-label', status === 'idle' ? t('idle') : `${badgeWord(status)}${count > 1 ? ` · ${count}` : ''}`)
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
cap.onclick = () => { if (drag?.moved || !state) return; if (state.kind === 'island' && !state.sessions.length) return; setExpanded(!expanded) }
surface.onpointerenter = () => { hovered = true; padChecks = 0; clearTimeout(leaveTimer); bridge.interactive(true); layout(); animate(); if (state?.kind === 'island' && state.sessions.length) hoverTimer = setTimeout(() => setExpanded(true), 300) }
function typing() { const active = document.activeElement; return Boolean(active && active !== cap && surface.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) }
// 仿 Qoder：展开态的「命中区」比面板本身大一圈（左右各 12px、上沿 6px、向下到内容底部或 480px），
// 指针刚滑出边缘时先不收起，避免展开/收起动画中途被抖动打断。
function withinPad(x, y) {
  const rect = surface.getBoundingClientRect()
  if (!rect.width || !rect.height) return false
  return x >= rect.left - 12 && x <= rect.right + 12 && y >= rect.top - 6 && y <= rect.top + Math.min(480, Math.max(rect.height, activity.scrollHeight))
}
function collapse() {
  if (hovered || typing()) return
  if (lastPointer && withinPad(lastPointer.x, lastPointer.y) && ++padChecks <= 5) { leaveTimer = setTimeout(collapse, 120); return }
  if (!drag) bridge.interactive(false)
  setExpanded(false)
}
surface.onpointerleave = event => { hovered = false; clearTimeout(hoverTimer); lastPointer = { x: event.clientX, y: event.clientY }; layout(); animate(); leaveTimer = setTimeout(collapse, 100) }
document.addEventListener('pointermove', event => {
  lastPointer = { x: event.clientX, y: event.clientY }
  const target = document.elementFromPoint(event.clientX, event.clientY)
  bridge.interactive(Boolean(drag || surface.contains(target) || withinPad(event.clientX, event.clientY)))
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
// 桌宠和灵动岛都按住胶囊拖动；移动超过 4px 就不再当成点击（点击仍然是展开/收起）。
cap.onpointerdown = event => { if (!state || event.button !== 0) return; cap.setPointerCapture(event.pointerId); drag = { x:event.screenX, y:event.screenY, direction:0, moved:false }; bridge.drag('start') }
cap.onpointerup = () => { if (!drag) return; bridge.drag('end'); setTimeout(() => { drag = null; animate() }, 0) }
cap.onpointercancel = () => { if (drag) bridge.drag('end'); drag = null; animate() }
document.addEventListener('keydown', event => { if (event.key === 'Escape') { document.activeElement?.blur(); setExpanded(false) } })
window.addEventListener('blur', () => { if (!typing()) setExpanded(false) })
document.addEventListener('visibilitychange', animate)
reduced.addEventListener('change', animate)
bridge.onState(update)
bridge.onCollapse(() => setExpanded(false))
bridge.initial().then(update)
window.addEventListener('unload', () => { clearTimeout(timer); clearTimeout(hoverTimer); clearTimeout(leaveTimer) })
