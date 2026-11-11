/* Original helper renderer; sprite artwork is licensed CC0-1.0 (see pets/NOTICE.md). */
'use strict'
const bridge = window.pet
const $ = id => document.getElementById(id)
const surface = $('surface'), cap = $('cap'), activity = $('activity'), canvas = $('sprite'), film = $('film')
const ctx = canvas.getContext('2d')
const animations = {
  idle: [0,[280,110,110,140,140,320]], runningRight:[1,[120,120,120,120,120,120,120,220]], runningLeft:[2,[120,120,120,120,120,120,120,220]], waving:[3,[140,140,140,280]], jumping:[4,[140,140,140,140,280]], failed:[5,[140,140,140,140,140,140,140,240]], waiting:[6,[150,150,150,150,150,260]], approval:[6,[150]], question:[6,[150]], running:[7,[120,120,120,120,120,220]], review:[8,[150,150,150,150,150,280]],
}
const words = {
  zh: { idle:'暂时没有会话活动', running:'正在执行', waiting:'等待你的处理', failed:'本轮执行失败', completed:'本轮已完成', open:'打开会话', todo:'待办', approval:'审批请求', question:'待回答的问题', hint:'打开会话即可批准或回答', reply:'补充要求或回复…', send:'发送', permission:'请打开会话处理批准或问题', error:'操作未完成，请在会话中重试。', greeting:'hi~', live:'实时活动' },
  en: { idle:'No active sessions', running:'Running', waiting:'Waiting for you', failed:'Turn failed', completed:'Turn complete', open:'Open session', todo:'Todo', approval:'Approval request', question:'Question', hint:'Open the session to approve or answer', reply:'Reply or add instructions…', send:'Send', permission:'Open the session to review approvals or questions', error:'Action failed. Please try again in the session.', greeting:'hi~', live:'Live activity' },
}
// Qoder 的收起态只有「宠物 + 状态徽标」，状态靠短语 + 语义色表达，数量进 tooltip。
const badges = {
  zh: { running:'正在工作', waiting:'需要你处理', completed:'有新结果', failed:'失败' },
  en: { running:'Working', waiting:'Needs you', completed:'New result', failed:'Failed' },
}
let state, expanded = false, hovered = false, image, imageKey = '', frame = 0, motion = '', look = null, timer, hoverTimer, leaveTimer, waveUntil = performance.now() + 2600, drag = null, padChecks = 0, lastPointer = null, signature = '', clip = '', preloaded = ''
// 久坐：桌宠长时间没被打扰就放慢 idle 并偶尔瞟一眼（复用 v2 精灵表第 9–10 行的视线帧）。
const QUIET_AFTER = 8000, GAZE_HOLD = 900, GAZE_GAP_MIN = 3200, GAZE_GAP_SPAN = 2600
let gaze = null, gazeUntil = 0, nextGaze = 0, lastInput = performance.now()
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
// 展开态没有单独的 footer：整行 / 整卡本身就是「打开会话」入口，打开成功后立刻收起，
// 把窗口空间还给桌面（用户 2026-11-10 反馈：不要「稍后 / 打开会话」按钮）。
async function openAndCollapse(session, button) {
  if (!await action({ action: 'open', sessionId: session.id }, button)) return
  hovered = false
  clearTimeout(hoverTimer)
  setExpanded(false)
  release()
}

// 展开态两形态互斥（对齐 Qoder 的内容模型）：
// 列表形态 = 排在首位的会话正在执行，且整份列表没有任何待处理（审批 / 提问 / 等待）；
// 其余情况都落到单会话详情形态，把注意力集中到那一个会话上。
function formOf() {
  const sessions = state?.sessions || []
  if (!sessions.length) return 'empty'
  return sessions[0].status === 'running' && !sessions.some(session => session.pendingKind) ? 'list' : 'detail'
}
function countLabel(total) {
  return state?.settings.language === 'en' ? `${total} ${total === 1 ? 'session' : 'sessions'}` : `${total} 个会话`
}
// Qoder 的相对时间：刚发生、分钟级、小时级、天级，更早退回日期。
function stamp(value) {
  const time = Number(value)
  if (!Number.isFinite(time) || time <= 0) return ''
  const en = state?.settings.language === 'en'
  const minutes = Math.floor(Math.max(0, Date.now() - time) / 60000)
  if (minutes < 1) return en ? 'now' : '刚刚'
  if (minutes < 60) return en ? `${minutes} min ago` : `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return en ? `${hours} h ago` : `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return en ? `${days} d ago` : `${days} 天前`
  return new Date(time).toLocaleDateString(en ? 'en' : 'zh-CN', { month: 'numeric', day: 'numeric' })
}
// 宿主给 detail 的几个固定英文短语（core.cjs 里的兜底文案）在本地化后和状态短语重复，
// 只在 detail 有真正内容时才拼接，避免出现「正在执行 · Working」这种中英混排。
const genericDetails = new Set(['Working', 'Turn finished', 'Input queued', 'Goal in progress', 'Goal paused', 'Goal round limit reached'])
function summarise(session) {
  const detail = String(session.detail || '').trim()
  return detail && !genericDetails.has(detail) ? detail : ''
}
// 形态 A：≤3 行运行中列表。整行是一枚打开会话的按钮（hover 高亮），两行都单行省略。
function runningRow(session) {
  const row = element('div', '', 'session island-row')
  row.dataset.session = session.id
  const open = element('button', '', 'session-open row-open')
  open.type = 'button'
  open.title = session.title || t(session.status)
  open.setAttribute('aria-label', `${session.title || t(session.status)} · ${t('open')}`)
  const lines = element('span', '', 'row-lines')
  lines.append(element('strong', session.title || t(session.status), 'title'))
  const phrase = t(session.status), detail = summarise(session)
  lines.append(element('small', detail && detail !== phrase ? `${phrase} · ${detail}` : phrase, 'note'))
  open.append(lines)
  open.onclick = () => openAndCollapse(session, open)
  row.append(open)
  return row
}
function runningForm(sessions) {
  const list = element('div', '', 'island-list')
  for (const session of sessions.slice(0, 3)) list.append(runningRow(session))
  return list
}
// 形态 B：单会话详情 —— 整张卡就是一枚按钮：标题行（标题 + 状态短语 + 相对时间）、
// 三行说明，待办内联在说明下面。没有头像、没有 footer，点击整卡直接打开会话。
function pendingBlock(session) {
  const question = session.pendingKind === 'question'
  // 待办块渲染在 button 内部，所以只用 phrasing 元素（CSS 里按块级排版）。
  const block = element('span', '', 'island-pending')
  block.dataset.kind = question ? 'question' : 'permission'
  const head = element('span', '', 'pending-head')
  head.append(element('span', t('todo'), 'pending-tag'))
  head.append(element('span', question ? t('question') : t('approval'), 'pending-kind'))
  block.append(head)
  const body = String(session.detail || '').trim()
  if (body) block.append(element('span', body, 'pending-body'))
  // 宿主没有公开的批准 / 回答接口（见 docs/pet/README.md）：整卡只负责把人带回原会话，
  // 绝不伪造 allow/deny —— 审批必须由会话里的 answerer 决定。
  block.append(element('span', t('hint'), 'pending-hint'))
  return block
}
function detailForm(session) {
  const card = element('article', '', 'session session-detail')
  card.dataset.session = session.id
  const open = element('button', '', 'session-open island-detail-card')
  open.type = 'button'
  open.title = session.title || t(session.status)
  open.setAttribute('aria-label', `${session.title || t(session.status)} · ${t('open')}`)
  const head = element('span', '', 'detail-head')
  head.append(element('strong', session.title || t(session.status), 'title'))
  head.append(element('span', session.pendingKind ? t('waiting') : t(session.status), 'status-phrase'))
  const when = stamp(session.updatedAt)
  if (when) head.append(element('time', when, 'stamp'))
  open.append(head)
  open.append(element('span', summarise(session) || (session.pendingKind ? t('waiting') : t(session.status)), 'detail'))
  if (session.pendingKind) open.append(pendingBlock(session))
  open.onclick = () => openAndCollapse(session, open)
  card.append(open)
  return card
}
function emptyForm() { return element('p', t('idle'), 'island-empty') }
// 桌宠气泡仍是原来的卡片列表（可以在卡片下直接回复）；灵动岛展开态走上面的两形态。
function petCards(sessions, drafts) {
  const list = []
  for (const session of sessions.slice(0, 2)) {
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
  return list
}
function renderActivity() {
  const sessions = state.sessions
  const mode = formOf()
  const next = JSON.stringify([state.kind, state.settings.language, mode, mode === 'list' ? sessions.slice(0, 3) : mode === 'detail' ? sessions[0] : null])
  if (signature === next) return
  // Preserve a focused draft while streamed detail text changes（只有桌宠气泡有输入框）。
  const drafts = new Map([...$('sessions').querySelectorAll('form')].map(form => [form.dataset.session, form.querySelector('input').value]))
  const focused = document.activeElement?.closest('form')?.dataset.session
  signature = next
  if (state.kind === 'pet') $('sessions').replaceChildren(...petCards(sessions, drafts))
  else if (mode === 'list') $('sessions').replaceChildren(runningForm(sessions))
  else if (mode === 'detail') $('sessions').replaceChildren(detailForm(sessions[0]))
  else $('sessions').replaceChildren(emptyForm())
  if (focused) [...$('sessions').querySelectorAll('form')].find(form => form.dataset.session === focused)?.querySelector('input')?.focus()
  $('activity-label').textContent = t('live')
  $('session-count').textContent = sessions.length ? countLabel(sessions.length) : ''
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
  document.body.dataset.form = formOf()
  const pending = state.sessions.find(session => session.pendingKind)?.pendingKind
  // 待办配色按类型区分（审批橙 / 提问青），没有待办时不要留下空属性骗过 CSS。
  if (pending) document.body.dataset.pending = pending
  else delete document.body.dataset.pending
  $('badge-text').textContent = status === 'idle' ? t('greeting') : badgeWord(status)
  const hint = status === 'idle' ? t('idle') : `${t(status)}${count > 1 ? ` · ${count}` : ''}`
  cap.title = hint
  cap.setAttribute('aria-label', status === 'idle' ? t('idle') : `${badgeWord(status)}${count > 1 ? ` · ${count}` : ''}`)
  const pet = selectedPet()
  // 有动画片段的宠物把上下浮动交给 CSS 合成动画，精灵表回退路径则沿用帧里烘焙的位移。
  document.body.toggleAttribute('data-clips', Boolean(pet && Object.keys(pet.animations || {}).length))
  preloadClips()
  if (pet && imageKey !== pet.spritesheet) {
    imageKey = pet.spritesheet; image = new Image(); image.onload = draw; image.onerror = () => { $('error').textContent = t('error') }; image.src = imageKey
  }
  renderActivity(); layout(); animate()
}
function currentMotion() {
  const session = state.sessions[0]
  if (session?.pendingKind === 'permission') return 'approval'
  if (session?.pendingKind === 'question') return 'question'
  if (drag?.moved) return drag.direction < 0 ? 'runningLeft' : 'runningRight'
  const status = session?.status || 'idle'
  // Keep a real session state visible instead of masking it with hover or the launch greeting.
  if (status === 'running') return 'running'
  if (status === 'waiting' || status === 'failed' || status === 'completed') return status === 'completed' ? 'review' : status
  if (hovered && state.kind === 'pet') return 'jumping'
  if (performance.now() < waveUntil) return 'waving'
  if ((look ?? gaze) !== null && selectedPet()?.spriteVersionNumber === 2) return 'look'
  return status
}
// 60 fps 动画 WebP：宠物包在 manifest 里登记了动作片段就直接播片段（Qoder 内置宠同款做法），
// 没登记的（第三方 Petdex 宠物）以及 reduced-motion 才回退到精灵表逐帧绘制。
function clipFor(name) {
  if (reduced.matches) return ''
  const map = selectedPet()?.animations
  return map && typeof map === 'object' ? map[name] || '' : ''
}
function preloadClips() {
  const pet = selectedPet(), key = pet?.id || ''
  if (preloaded === key) return
  preloaded = key
  for (const source of Object.values(pet?.animations || {})) { const warm = new Image(); warm.src = source }
}
function showFilm(source) {
  if (clip !== source) { clip = source; film.src = source }
  film.hidden = false
  canvas.hidden = true
}
function showSheet() {
  if (!clip) { canvas.hidden = false; return }
  clip = ''; film.hidden = true; film.removeAttribute('src'); canvas.hidden = false
}
function draw() {
  const playing = clipFor(motion)
  if (playing) { showFilm(playing); return }
  showSheet()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!image?.complete || !image.naturalWidth) return
  const rows = selectedPet()?.spriteVersionNumber === 2 ? 11 : 9
  const cw = image.naturalWidth / 8, ch = image.naturalHeight / rows
  const dir = look ?? gaze ?? 0
  const cell = motion === 'look' ? [9 + Math.floor(dir / 8), dir % 8] : [animations[motion]?.[0] || 0, frame]
  ctx.drawImage(image, cell[1] * cw, cell[0] * ch, cw, ch, 0, 0, canvas.width, canvas.height)
}
function animate() {
  clearTimeout(timer)
  if (!state || document.hidden) return
  const now = performance.now()
  // reduced-motion 下宠物保持静止，不做久坐张望。
  const quiet = !reduced.matches && state.kind === 'pet' && !expanded && !hovered && !drag && now - lastInput > QUIET_AFTER
  if (quiet && gaze === null && look === null && now >= nextGaze) {
    gaze = Math.floor(Math.random() * 16)
    gazeUntil = now + GAZE_HOLD
    nextGaze = gazeUntil + GAZE_GAP_MIN + Math.random() * GAZE_GAP_SPAN
  }
  if (gaze !== null && now >= gazeUntil) gaze = null
  const next = currentMotion()
  if (motion !== next) { motion = next; frame = 0 }
  // 和 Qoder 一样把当前动作写进 DOM，方便配 CSS 与排查。
  document.body.dataset.motion = next
  draw()
  if (reduced.matches) return
  // 片段自己会按 60 fps 播放，这里只需低频复核动作（悬停、拖拽、问候窗结束都会主动触发）。
  if (clip) { timer = setTimeout(animate, 400); return }
  if (next === 'look') {
    // 视线帧是静止的：只有久坐张望才需要自己排一个定时器收尾。
    if (gaze !== null) timer = setTimeout(animate, Math.max(50, gazeUntil - performance.now() + 1))
    return
  }
  const delays = (animations[next] || animations.idle)[1]
  const wait = quiet && next === 'idle' ? Math.round(delays[frame] * 1.8) : delays[frame]
  timer = setTimeout(() => { frame = (frame + 1) % delays.length; animate() }, wait)
}
cap.onclick = () => { if (drag?.moved || !state) return; if (state.kind === 'island' && !state.sessions.length) return; setExpanded(!expanded) }
surface.onpointerenter = event => {
  lastInput = performance.now()
  // 透明窗口的矩形远大于可见内容：只有指针真的落在胶囊/内容上才算「悬停」，
  // 否则窗口不该接管鼠标（否则顶上那块透明区域会挡住别的 App 的按钮）。
  const inside = withinPad(event.clientX ?? -1, event.clientY ?? -1)
  hovered = inside
  padChecks = 0
  clearTimeout(leaveTimer)
  bridge.interactive(inside)
  layout()
  animate()
  if (inside && state?.kind === 'island' && state.sessions.length) hoverTimer = setTimeout(() => setExpanded(true), 300)
}
function typing() { const active = document.activeElement; return Boolean(active && active !== cap && surface.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) }
// 命中区必须贴住真正画出来的东西：胶囊，展开时再加内容块，外扩 6px。
// 透明窗口是整块矩形，命中区一旦算大，鼠标落在这块透明区域时窗口就会吃掉点击，
// 底下别的 App 的按钮会集体失灵 —— 所以只认可见区域，宁可小不可大。
function contentRect() {
  const rects = [cap.getBoundingClientRect()]
  if (expanded) rects.push(activity.getBoundingClientRect())
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const rect of rects) {
    if (!rect.width || !rect.height) continue
    left = Math.min(left, rect.left); top = Math.min(top, rect.top)
    right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom)
  }
  if (!Number.isFinite(left)) return null
  return { left: left - 6, top: top - 6, right: right + 6, bottom: bottom + 6 }
}
function withinPad(x, y) {
  const area = contentRect()
  return Boolean(area) && x >= area.left && x <= area.right && y >= area.top && y <= area.bottom
}
function release() { if (!withinPad(lastPointer?.x ?? -1, lastPointer?.y ?? -1)) bridge.interactive(false) }
function collapse() {
  if (hovered || typing()) return
  if (lastPointer && withinPad(lastPointer.x, lastPointer.y) && ++padChecks <= 5) { leaveTimer = setTimeout(collapse, 120); return }
  if (!drag) bridge.interactive(false)
  setExpanded(false)
  // 收起后内容块消失，命中区立刻变小；指针如果还在原来的位置上，必须放掉鼠标。
  release()
}
surface.onpointerleave = event => { hovered = false; clearTimeout(hoverTimer); lastPointer = { x: event.clientX, y: event.clientY }; layout(); animate(); leaveTimer = setTimeout(collapse, 100) }
document.addEventListener('pointermove', event => {
  lastInput = performance.now()
  lastPointer = { x: event.clientX, y: event.clientY }
  bridge.interactive(Boolean(drag || typing() || withinPad(event.clientX, event.clientY)))
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
