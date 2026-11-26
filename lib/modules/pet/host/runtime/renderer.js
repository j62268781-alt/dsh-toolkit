/* Original helper renderer; see pets/NOTICE.md for sprite artwork attribution and licensing. */
'use strict'
const bridge = window.pet
const $ = id => document.getElementById(id)
const surface = $('surface'), cap = $('cap'), activity = $('activity'), canvas = $('sprite'), film = $('film')
const ctx = canvas.getContext('2d')
const animations = {
  idle: [0,[280,110,110,140,140,320]], runningRight:[1,[120,120,120,120,120,120,120,220]], runningLeft:[2,[120,120,120,120,120,120,120,220]], waving:[3,[140,140,140,280]], jumping:[4,[140,140,140,140,280]], failed:[5,[140,140,140,140,140,140,140,240]], waiting:[6,[150,150,150,150,150,260]], approval:[6,[150]], question:[6,[150]], running:[7,[120,120,120,120,120,220]], review:[8,[150,150,150,150,150,280]],
}
const words = {
  zh: { idle:'暂时没有会话活动', running:'正在执行', waiting:'等待你的处理', failed:'本轮执行失败', completed:'本轮已完成', open:'打开会话', todo:'待办', approval:'审批请求', question:'待回答的问题', hint:'打开会话即可批准或回答', reply:'补充要求或回复…', send:'发送', permission:'请打开会话处理批准或问题', error:'操作未完成，请在会话中重试。', greeting:'hi~', live:'实时活动', interrupted:'本轮已停止', continuable:'可以继续', turns:'第 {turn} 轮', steps:'第 {step} 步', usingTool:'正在用 {tool}', subagents:'{count} 个子代理', output:'输出', waitApproval:'等你批准', waitQuestion:'等你回答', goalPaused:'目标已暂停', goalBlocked:'目标被卡住', goalLimit:'轮次已用尽', queueWait:'有输入待发' },
  en: { idle:'No active sessions', running:'Running', waiting:'Waiting for you', failed:'Turn failed', completed:'Turn complete', open:'Open session', todo:'Todo', approval:'Approval request', question:'Question', hint:'Open the session to approve or answer', reply:'Reply or add instructions…', send:'Send', permission:'Open the session to review approvals or questions', error:'Action failed. Please try again in the session.', greeting:'hi~', live:'Live activity', interrupted:'Turn stopped', continuable:'Can continue', turns:'Turn {turn}', steps:'Step {step}', usingTool:'Using {tool}', subagents:'{count} subagents', output:'Output', waitApproval:'Approve?', waitQuestion:'Answer?', goalPaused:'Goal paused', goalBlocked:'Goal blocked', goalLimit:'Round limit', queueWait:'Input queued' },
}
// Qoder 的收起态只有「宠物 + 状态徽标」，状态靠短语 + 语义色表达，数量进 tooltip。
const badges = {
  zh: { running:'正在工作', waiting:'需要你处理', completed:'有新结果', failed:'失败', interrupted:'已停止', continuable:'可继续' },
  en: { running:'Working', waiting:'Needs you', completed:'New result', failed:'Failed', interrupted:'Stopped', continuable:'Can continue' },
}
let state, expanded = false, hovered = false, image, imageKey = '', frame = 0, motion = '', look = null, timer, hoverTimer, leaveTimer, waveUntil = performance.now() + 2600, drag = null, padChecks = 0, lastPointer = null, signature = '', clip = '', preloaded = ''
// 精灵表是逐帧硬切的，慢动作行（呼吸、等待、收尾）跳到 60fps 也只会来回闪，所以在两帧之间做交叉淡化。
// 跑、跳、哭这些行相邻帧差太大（平均 RGB 差 37–87），补间会拖出两条腿的重影，保持原来的硬切。
const TWEEN_ROWS = new Set(['idle', 'waiting', 'review'])
// 桌宠按 60 fps 补，灵动岛只有 27×29 像素、又在刘海边上，30 fps 就够且更省电。
const TWEEN_STEP = 16, TWEEN_STEP_ISLAND = 33
let frameStart = 0, blend = 0
// 久坐：桌宠长时间没被打扰就放慢 idle 并偶尔瞟一眼（复用 v2 精灵表第 9–10 行的视线帧）。
const QUIET_AFTER = 8000, GAZE_HOLD = 900, GAZE_GAP_MIN = 3200, GAZE_GAP_SPAN = 2600
let gaze = null, gazeUntil = 0, nextGaze = 0, lastInput = performance.now()
// undefined means the native sampler is unavailable; null means the pointer is out of range.
let nativePointer
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
// 宿主把「等你批准 / 等你回答 / 目标暂停 / 目标阻塞 / 轮次用尽 / 有输入待发」全压成 waiting，
// 岛上只能靠 waitReason 把它们拆开 —— 否则六种处境都写着同一句「需要你处理」。
const waitPhrases = { approval:'waitApproval', question:'waitQuestion', 'goal-paused':'goalPaused', 'goal-blocked':'goalBlocked', 'goal-limit':'goalLimit', queued:'queueWait' }
/** 展开态里的状态短语：等待要说清原因，其余按状态名。 */
function phraseOf(session) {
  const status = session?.status || 'idle'
  if (status === 'waiting' && waitPhrases[session.waitReason]) return t(waitPhrases[session.waitReason])
  return t(status)
}
/** 收起态徽标文案：等待按原因换词，执行中把队列条数缀在末尾，多会话再补 +N。 */
function badgeText(session, extra = 0) {
  if (!session) return t('greeting')
  const status = session.status || 'idle'
  if (status === 'idle') return t('greeting')
  const tail = Number(session.queued) > 0 ? ` ·${session.queued}` : ''
  const more = extra > 0 ? ` +${extra}` : ''
  if (status === 'waiting') return (waitPhrases[session.waitReason] ? t(waitPhrases[session.waitReason]) : badgeWord('waiting')) + tail + more
  return badgeWord(status) + tail + more
}
// token 的短写法：展开态一行放得下，不必给完整数字。
function tokens(count) {
  const value = Number(count)
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`
  return String(Math.round(value))
}
/** 展开态的进度行：宿主投影给什么就说什么，没有就整行不出现。 */
function progressText(session) {
  const progress = session?.progress || {}
  const parts = []
  if (progress.turn) parts.push(t('turns').replace('{turn}', progress.turn))
  if (progress.step) parts.push(t('steps').replace('{step}', progress.step))
  if (progress.tool) parts.push(t('usingTool').replace('{tool}', progress.tool))
  if (progress.subagents) parts.push(t('subagents').replace('{count}', progress.subagents))
  if (progress.outputTokens) parts.push(`${t('output')} ${tokens(progress.outputTokens)}`)
  return parts.join(' · ')
}
// 仿 Qoder dt()：按徽标文案量宽 → 夹进区间 → 取偶数 → 再被几何宽封顶（菜单里调宽度仍生效）。
function compactWidth(session, extra = 0) {
  const g = dimensions()
  const notch = state?.display?.notch
  if (!state || state.kind !== 'island') return g.compact
  const badge = Math.ceil(measureText(badgeText(session, extra), 11.5)) + 12 + 4 + 14
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
  return { compact, wide: Math.max(390, compact), height: state.display?.notch?.height || Math.round(38 * Math.max(75, Math.min(150, state.settings.islandHeight || 100)) / 100) }
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
  const compact = compactWidth(state.sessions[0], Math.max(0, (state.sessions?.length || 0) - 1))
  surface.style.width = `${expanded ? g.wide : hovered ? Math.min(g.wide, compact + 32) : compact}px`
  const capHeight = g.height + (!notch && !expanded && hovered ? 4 : 0)
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
  if (previous && !expanded && state?.kind === 'pet' && !drag) release()
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
  const phrase = phraseOf(session), detail = summarise(session), progress = progressText(session)
  const note = [phrase, detail && detail !== phrase ? detail : '', progress].filter(Boolean).join(' · ')
  lines.append(element('small', note, 'note'))
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
  head.append(element('span', phraseOf(session), 'status-phrase'))
  const when = stamp(session.updatedAt)
  if (when) head.append(element('time', when, 'stamp'))
  open.append(head)
  const progress = progressText(session)
  if (progress) open.append(element('span', progress, 'progress'))
  // 说明行只在它带来新信息时才出现：`Turn finished` 这类通用短语已经被状态短语说过一遍，
  // 再兜底回填一句一模一样的「本轮已完成」就成了重复的一行。
  const detail = summarise(session)
  if (detail && detail !== phraseOf(session)) open.append(element('span', detail, 'detail'))
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
  // 等待原因单独成属性，CSS 据此换图标与配色（提问青、目标琥珀、排队紫）。
  if (status === 'waiting' && current?.waitReason) document.body.dataset.wait = current.waitReason
  else delete document.body.dataset.wait
  const extra = Math.max(0, count - 1)
  $('badge-text').textContent = badgeText(current, extra)
  const hint = status === 'idle' ? t('idle') : `${badgeText(current, extra)}${count > 1 ? ` · ${countLabel(count)}` : ''}`
  cap.title = hint
  cap.setAttribute('aria-label', status === 'idle' ? t('idle') : hint)
  const pet = selectedPet()
  // 带空闲片段的整套形象才用 CSS 浮动。只带工作片段的工作台不浮动，其余姿态沿用精灵表。
  document.body.toggleAttribute('data-clips', Boolean(pet?.animations?.idle))
  preloadClips()
  if (pet && imageKey !== pet.spritesheet) {
    hitMasks.clear()
    imageKey = pet.spritesheet; image = new Image(); image.crossOrigin = 'anonymous'; image.onload = draw; image.onerror = () => { $('error').textContent = t('error') }; image.src = imageKey
  }
  renderActivity(); layout()
  if (nativePointer !== undefined) updateGaze(nativePointer)
  animate()
}
function currentMotion() {
  const session = state.sessions[0]
  if (session?.pendingKind === 'permission') return 'approval'
  if (session?.pendingKind === 'question') return 'question'
  if (drag?.moved) return drag.direction < 0 ? 'runningLeft' : 'runningRight'
  const status = session?.status || 'idle'
  // Keep a real session state visible instead of masking it with the launch greeting.
  if (status === 'running') return 'running'
  if (status === 'waiting' || status === 'failed' || status === 'completed') return status === 'completed' ? 'review' : status
  // 精灵表没有「停下」这一行，被打断/可继续都回到 idle 的呼吸，别硬套 failed 的哭脸。
  if (status === 'interrupted' || status === 'continuable') return 'idle'
  if (performance.now() < waveUntil) return 'waving'
  if (state.kind === 'pet' && !expanded && !drag && !reduced.matches && (look !== null || (!hovered && gaze !== null)) && selectedPet()?.spriteVersionNumber === 2) return 'look'
  return status
}
// 已登记的动作优先播放动画 WebP；减少动态效果、未登记或加载失败则用精灵表。
const failedClips = new Set()
function clipFor(name) {
  if (reduced.matches) return ''
  const source = selectedPet()?.animations?.[name]
  return source && !failedClips.has(source) ? source : ''
}
film.crossOrigin = 'anonymous'
film.onerror = () => {
  if (!clip) return
  failedClips.add(clip)
  animate()
}
function preloadClips() {
  const pet = selectedPet(), key = pet?.id || ''
  if (preloaded === key) return
  preloaded = key
  for (const source of Object.values(pet?.animations || {})) { const warm = new Image(); warm.crossOrigin = 'anonymous'; warm.src = source }
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
// 内置精灵表用等待和收尾行的空槽保存静态工作台姿势。
const WORKSTATION_STILLS = { approval: [6, 6], question: [6, 7], review: [8, 6], failed: [8, 7] }
function workstationStill(name) {
  const pet = selectedPet()
  return pet?.id === 'aoi-shark-maid' && pet.spriteVersionNumber === 2 ? WORKSTATION_STILLS[name] : undefined
}
function spriteCell() {
  const dir = look ?? gaze ?? 0
  return workstationStill(motion) ?? (motion === 'look' ? [9 + Math.floor(dir / 8), dir % 8] : [animations[motion]?.[0] || 0, frame])
}
function draw() {
  const playing = clipFor(motion)
  if (playing) { showFilm(playing); return }
  showSheet()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!image?.complete || !image.naturalWidth) return
  const rows = selectedPet()?.spriteVersionNumber === 2 ? 11 : 9
  const cw = image.naturalWidth / 8, ch = image.naturalHeight / rows
  const cell = spriteCell()
  ctx.drawImage(image, cell[1] * cw, cell[0] * ch, cw, ch, 0, 0, canvas.width, canvas.height)
  // 慢动作行的补间：把下一帧按进度叠在当前帧上，5 fps 的呼吸就变成连续的了。
  if (!(blend > 0) || reduced.matches || !TWEEN_ROWS.has(motion)) return
  const delays = (animations[motion] || animations.idle)[1]
  const eased = blend * blend * (3 - 2 * blend)
  ctx.globalAlpha = eased
  ctx.drawImage(image, ((frame + 1) % delays.length) * cw, cell[0] * ch, cw, ch, 0, 0, canvas.width, canvas.height)
  ctx.globalAlpha = 1
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
  if (motion !== next) { motion = next; frame = 0; frameStart = 0; blend = 0 }
  // 和 Qoder 一样把当前动作写进 DOM，方便配 CSS 与排查。
  document.body.dataset.motion = next
  const delays = (animations[next] || animations.idle)[1]
  const wait = quiet && next === 'idle' ? Math.round(delays[frame] * 1.8) : delays[frame]
  const still = workstationStill(next)
  const tweening = !still && TWEEN_ROWS.has(next) && !reduced.matches && !clip && next !== 'look'
  if (tweening) {
    // 固定节拍重绘：帧长仍按 delays，帧之间靠 blend 插值，所以观感是连续呼吸而不是 5 fps 跳格。
    if (!frameStart) { frameStart = now; blend = 0 }
    else if (now - frameStart >= wait) { frame = (frame + 1) % delays.length; frameStart = now; blend = 0 }
    else blend = Math.min(1, (now - frameStart) / wait)
  }
  draw()
  if (reduced.matches || (still && !clip)) return
  // 片段自行播放，这里只需低频复核动作（悬停、拖拽、问候窗结束都会主动触发）。
  if (clip) { timer = setTimeout(animate, 400); return }
  if (next === 'look') {
    // 视线帧是静止的：只有久坐张望才需要自己排一个定时器收尾。
    if (gaze !== null) timer = setTimeout(animate, Math.max(50, gazeUntil - performance.now() + 1))
    return
  }
  if (tweening) { timer = setTimeout(animate, state.kind === 'island' ? TWEEN_STEP_ISLAND : TWEEN_STEP); return }
  timer = setTimeout(() => { frame = (frame + 1) % delays.length; animate() }, wait)
}
cap.onclick = event => {
  if (drag?.moved || !state) return
  if (state.kind === 'island' && !state.sessions.length) return
  if (state.kind === 'pet' && event.detail && !drag && !hitsSprite(event.clientX, event.clientY)) return
  setExpanded(!expanded)
  if (state.kind === 'pet') release()
}
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
// Cache the alpha mask per sheet cell or clip poster; don't read back on every pointer move.
const hitMasks = new Map()
const MASK_SIZE = 64
let maskContext
function hitMask(key, source, x, y, width, height) {
  if (!hitMasks.has(key)) {
    maskContext ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    maskContext.clearRect(0, 0, MASK_SIZE, MASK_SIZE)
    maskContext.drawImage(source, x, y, width, height, 0, 0, MASK_SIZE, MASK_SIZE)
    try { hitMasks.set(key, maskContext.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data) }
    catch { hitMasks.set(key, null) }
  }
  return hitMasks.get(key)
}
function hitsSprite(x, y) {
  const target = canvas.hidden ? film : canvas
  const rect = target.getBoundingClientRect()
  if (!rect.width || !rect.height || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false
  const offset = 4 * (Math.floor((y - rect.top) / rect.height * MASK_SIZE) * MASK_SIZE + Math.floor((x - rect.left) / rect.width * MASK_SIZE)) + 3
  if (target === film) {
    if (!film.complete || !film.naturalWidth) return false
    // Canvas samples the default frame of an animated image. The workstation's furniture and body stay in place.
    return (hitMask(clip, film, 0, 0, film.naturalWidth, film.naturalHeight)?.[offset] ?? 0) >= 32
  }
  if (!image?.complete || !image.naturalWidth) return false
  const [row, column] = spriteCell()
  const cw = image.naturalWidth / 8, ch = image.naturalHeight / (selectedPet()?.spriteVersionNumber === 2 ? 11 : 9)
  const alpha = col => hitMask(row * 8 + col, image, col * cw, row * ch, cw, ch)?.[offset] ?? 255
  if (alpha(column) >= 32) return true
  return blend > 0 && !reduced.matches && TWEEN_ROWS.has(motion) && alpha((column + 1) % animations[motion][1].length) * blend * blend * (3 - 2 * blend) >= 32
}
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
  if (state?.kind === 'pet') {
    if (hitsSprite(x, y)) return true
    if (!expanded) return false
    const rect = activity.getBoundingClientRect()
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
  }
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
function updateGaze(point) {
  let direction = null
  if (point && state?.kind === 'pet' && selectedPet()?.spriteVersionNumber === 2) {
    const rect = (canvas.hidden ? film : canvas).getBoundingClientRect()
    const dx = point.x - (rect.x + rect.width / 2), dy = point.y - (rect.y + rect.height / 2)
    // Use the box only for gaze; drag and click-through still use visible pixels.
    const outside = point.x < rect.left || point.x >= rect.right || point.y < rect.top || point.y >= rect.bottom
    if (rect.width && rect.height && outside && Math.abs(dx) <= 200 && Math.abs(dy) <= 200 && Math.hypot(dx, dy) > Math.max(40, Math.min(rect.width, rect.height) * .38)) {
      const sector = (Math.atan2(dx, -dy) / (Math.PI / 8) + 16) % 16
      const delta = look === null ? Infinity : Math.abs((sector - look + 24) % 16 - 8)
      // Allow a little movement past a sector boundary before swapping poses.
      direction = delta < .65 ? look : Math.round(sector) % 16
    }
  }
  if (direction !== null || look !== null) {
    lastInput = performance.now()
    gaze = null
  }
  if (look === direction) return false
  look = direction
  return true
}
const stopGazePointer = bridge.onGazePointer?.(point => {
  nativePointer = point
  if (updateGaze(point)) animate()
})
document.documentElement.addEventListener('pointerleave', () => { if (nativePointer === undefined && updateGaze(null)) animate() })
document.addEventListener('pointermove', event => {
  lastInput = performance.now()
  lastPointer = { x: event.clientX, y: event.clientY }
  bridge.interactive(Boolean(drag || typing() || withinPad(event.clientX, event.clientY)))
  if (drag) {
    const dx = event.screenX - drag.x, dy = event.screenY - drag.y
    if (Math.hypot(dx, dy) >= 4) drag.moved = true
    drag.direction = dx
    if (drag.moved) bridge.drag('move')
  } else if (nativePointer === undefined) updateGaze(lastPointer)
  animate()
})
// 桌宠只从角色上开始拖动；灵动岛仍用胶囊。移动超过 4px 后不再当成点击。
cap.onpointerdown = event => {
  if (!state || event.button !== 0 || drag) return
  if (state.kind === 'pet' && !hitsSprite(event.clientX, event.clientY)) return
  cap.setPointerCapture(event.pointerId)
  drag = { x:event.screenX, y:event.screenY, direction:0, moved:false }
  bridge.drag('start')
}
function clearDrag() {
  drag = null
  animate()
  if (state?.kind === 'pet') release()
}
cap.onpointerup = () => { if (!drag) return; bridge.drag('end'); setTimeout(clearDrag, 0) }
cap.onpointercancel = () => { if (drag) bridge.drag('end'); clearDrag() }
document.addEventListener('keydown', event => { if (event.key === 'Escape') { document.activeElement?.blur(); setExpanded(false) } })
window.addEventListener('blur', () => { if (!typing()) setExpanded(false) })
document.addEventListener('visibilitychange', animate)
reduced.addEventListener('change', animate)
bridge.onState(update)
bridge.onCollapse(() => setExpanded(false))
bridge.initial().then(update)
window.addEventListener('unload', () => { stopGazePointer?.(); clearTimeout(timer); clearTimeout(hoverTimer); clearTimeout(leaveTimer) })
