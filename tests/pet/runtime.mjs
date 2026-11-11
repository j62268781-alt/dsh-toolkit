import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
const require = createRequire(import.meta.url)
const { readEnvironment, publicState, islandGeometry, islandAnchor, islandPlacement, islandOffset, assetPath, validatedAction, consumeEvents } = require('../../src/modules/pet/host/runtime/core.cjs')
const { notchForDisplay } = require('../../src/modules/pet/host/runtime/native.cjs')
const env = { DSH_TOOLKIT_PET_URL:'http://127.0.0.1:1234', DSH_TOOLKIT_PET_TOKEN:'secret', DSH_TOOLKIT_HOST_PID:'123' }

test('helper only accepts authenticated loopback origin and valid host pid', () => {
  assert.equal(readEnvironment(env).origin, env.DSH_TOOLKIT_PET_URL)
  for (const origin of ['https://127.0.0.1:1234', 'http://localhost:1234', 'http://example.com', 'http://user:pass@127.0.0.1:1234', 'http://127.0.0.1:1234/path']) assert.throws(() => readEnvironment({ ...env, DSH_TOOLKIT_PET_URL:origin }))
  assert.throws(() => readEnvironment({ ...env, DSH_TOOLKIT_HOST_PID:'NaN' }))
  assert.throws(() => readEnvironment({ ...env, DSH_TOOLKIT_PET_TOKEN:'' }))
})
test('renderer snapshot does not expose filesystem or Host secrets and ranks sessions', () => {
  const result = publicState({ settings:{ token:'secret', electronPath:'/secret', language:'en' }, pets:[{ id:'duck', name:'Duck', assetDir:'/private', manifest:{ spriteVersionNumber:2 } }], sessions:[{ id:'done', status:'completed' }, { id:'wait', status:'waiting' }, { id:'run', status:'running', updatedAt:4321 }], runtime:{ token:'secret' } }, 'pet', { bounds:{ width:1000,height:800 } })
  assert.deepEqual(result.sessions.map(s => s.id), ['wait','run','done'])
  // 展开态只用 updatedAt 算「刚刚 / N 分钟前」，缺失时给 0 让渲染端走不显示分支。
  assert.equal(result.sessions.find(s => s.id === 'run').updatedAt, 4321)
  assert.equal(result.sessions.find(s => s.id === 'done').updatedAt, 0)
  assert.equal(result.pets[0].spritesheet, 'pet-asset://pet/duck/spritesheet.png')
  assert.equal(JSON.stringify(result).includes('/private'), false)
  assert.equal(JSON.stringify(result).includes('secret'), false)
})
test('assets are bounded to one known pet spritesheet', () => {
  const state = { pets:[{ id:'duck', assetDir:'/assets/duck' }] }
  assert.equal(assetPath(state, 'pet-asset://pet/duck/spritesheet.png'), '/assets/duck/spritesheet.png')
  for (const url of ['pet-asset://pet/duck/../secret', 'pet-asset://pet/duck/%2fetc', 'pet-asset://pet/unknown/spritesheet.png', 'https://pet/duck/spritesheet.png']) assert.equal(assetPath(state,url), null)
})
test('a Petdex pet keeps its own id and webp sheet without exposing its directory', () => {
  const state = { pets:[{ id:'petdex:boba', name:'Boba', assetDir:'/pets/boba', manifest:{ spriteVersionNumber:2, spritesheetPath:'spritesheet.webp' }, sheetFile:'spritesheet.webp', source:'petdex' }] }
  const projected = publicState({ settings:{ activePet:'petdex:boba' }, pets: state.pets, sessions: [] }, 'island', { bounds:{ width:1440, height:900 } })
  assert.equal(projected.pets[0].spritesheet, 'pet-asset://pet/petdex%3Aboba/spritesheet.webp')
  // 没有登记 animations 的宠物不带片段，渲染端只能走精灵表。
  assert.deepEqual(projected.pets[0].animations, {})
  assert.equal(projected.pets[0].spriteVersionNumber, 2)
  assert.equal(JSON.stringify(projected).includes('/pets/boba'), false)
  assert.equal(assetPath(state, projected.pets[0].spritesheet), '/pets/boba/spritesheet.webp')
  // 只有登记过的那一个文件可读：换成 pet.json 或别的宠物都不行。
  for (const url of ['pet-asset://pet/petdex%3Aboba/pet.json', 'pet-asset://pet/petdex%3Aboba/spritesheet.png', 'pet-asset://pet/deepseek-whale/spritesheet.webp']) assert.equal(assetPath(state, url), null)
})
test('a pet may register 60 fps motion clips next to its sheet', () => {
  const state = { pets:[{ id:'whale', name:'Whale', assetDir:'/assets/whale', sheetFile:'spritesheet.png', manifest:{ spriteVersionNumber:2, animations:{ idle:'motion/idle.webp', running:'motion/running.webp', jumping:'motion/jumping.webp' } } }] }
  const projected = publicState({ settings:{ activePet:'whale' }, pets: state.pets, sessions: [] }, 'island', { bounds:{ width:1440, height:900 } })
  assert.deepEqual(projected.pets[0].animations, {
    idle: 'pet-asset://pet/whale/motion/idle.webp',
    running: 'pet-asset://pet/whale/motion/running.webp',
    jumping: 'pet-asset://pet/whale/motion/jumping.webp',
  })
  assert.equal(JSON.stringify(projected).includes('/assets/whale'), false)
  assert.equal(assetPath(state, 'pet-asset://pet/whale/motion/idle.webp'), '/assets/whale/motion/idle.webp')
  // 只认登记过的动作名，且路径必须和动作名一致：换文件、换目录、越界都不行。
  for (const url of [
    'pet-asset://pet/whale/motion/waving.webp',
    'pet-asset://pet/whale/motion/idle.png',
    'pet-asset://pet/whale/motion/../spritesheet.png',
    'pet-asset://pet/whale/clip/idle.webp',
    'pet-asset://pet/whale/motion/idle.webp/extra',
  ]) assert.equal(assetPath(state, url), null)
  // manifest 里写别的路径不生效：文件名必须等于动作名。
  const odd = { pets:[{ id:'whale', assetDir:'/assets/whale', manifest:{ animations:{ idle:'motion/other.webp' } } }] }
  assert.equal(assetPath(odd, 'pet-asset://pet/whale/motion/idle.webp'), null)
  assert.deepEqual(publicState({ settings:{}, pets: odd.pets, sessions: [] }, 'island', { bounds:{ width:1440, height:900 } }).pets[0].animations, {})
})
test('actions exclude grants and reject malformed prompts and coordinates', () => {
  assert.throws(() => validatedAction({ action:'approve' }))
  assert.throws(() => validatedAction({ action:'cancel' }))
  assert.throws(() => validatedAction({ action:'prompt', sessionId:'x', text:' ' }))
  assert.throws(() => validatedAction({ action:'position', x:NaN, y:0 }))
  assert.deepEqual(validatedAction({ action:'prompt', sessionId:'x', text:' hello ', token:'secret' }), { action:'prompt',sessionId:'x',text:'hello' })
})
test('island geometry reserves native camera space and a stable expanded width', () => {
  assert.deepEqual(islandGeometry(), { compact:280,expanded:552,height:38 })
  assert.deepEqual(islandGeometry({}, { width:185,height:32 }), { compact:360,expanded:590,height:38 })
  assert.equal(islandGeometry({ islandWidth:150 }).expanded, 552)
  // 屏幕太窄时按屏宽封顶，展开面板不能超出显示器。
  assert.equal(islandGeometry({}, { width:185,height:32 }, { width:600,height:900 }).expanded, 480)
  assert.equal(islandGeometry({ islandWidth:75 }).compact, 210)
  assert.ok(islandGeometry({ islandHeight:75 }, { width:185,height:32 }).height >= 36)
})
test('island placement follows the display anchor and keeps a dragged offset on screen', () => {
  const notched = { id:1, bounds:{ x:1920,y:0,width:1512,height:982 }, workArea:{ x:1920,y:33,width:1512,height:949 }, notch:{ x:663.5,width:185,height:32 } }
  const plain = { id:2, bounds:{ x:0,y:0,width:1920,height:1080 }, workArea:{ x:0,y:30,width:1920,height:943 }, notch:null }
  const size = { width:414,height:500 }
  assert.deepEqual(islandAnchor(notched,size.width), { x:2469,y:0 })
  assert.deepEqual(islandAnchor(plain,size.width), { x:753,y:36 })
  assert.deepEqual(islandPlacement(notched,size), { x:2469,y:0 })
  assert.deepEqual(islandPlacement(plain,size), { x:753,y:36 })
  assert.deepEqual(islandPlacement(plain,size,{ dx:-200,dy:120 }), { x:553,y:156 })
  assert.deepEqual(islandPlacement(plain,size,{ dx:-99999,dy:99999 }), { x:0,y:580 })
  assert.deepEqual(islandOffset(plain,size,553,156), { dx:-200,dy:120 })
})
test('only native safe-area and auxiliary regions establish a notch by display ID', () => {
  const display = { id:1,bounds:{ width:1512,height:982 },workArea:{ y:32 } }
  const native = { id:1,frame:{x:1920,y:98,width:1512,height:982},safeTop:32,left:{x:1920,width:663.5,height:32},right:{x:2768.5,width:663.5,height:32} }
  assert.deepEqual(notchForDisplay(display,[native]),{x:663.5,width:185,height:32})
  assert.equal(notchForDisplay(display,[]),null)
  assert.equal(notchForDisplay(display,[{...native,id:2}]),null)
  assert.equal(notchForDisplay(display,[{...native,safeTop:0}]),null)
  assert.equal(notchForDisplay(display,[{...native,frame:{...native.frame,x:NaN}}]),null)
  assert.equal(notchForDisplay(display,[{...native,right:{...native.right,x:9999}}]),null)
})
test('SSE decoder handles fragmented UTF8, comments and CRLF', async () => {
  const bytes = new TextEncoder().encode(': heartbeat\r\ndata: {"title":"小鸭"}\r\n\ndata: {"revision":2}\n\n')
  const seen=[]
  const body = new ReadableStream({ start(controller) { for (let i=0;i<bytes.length;i+=3) controller.enqueue(bytes.slice(i,i+3)); controller.close() } })
  await consumeEvents(body, item => seen.push(item), new AbortController().signal)
  assert.deepEqual(seen,[{ title:'小鸭' },{ revision:2 }])
})
test('real renderer focuses one session with an inline todo on a single clickable card', async () => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url),'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url),'utf8')
  const dom = new JSDOM(html,{ runScripts:'outside-only',url:'file:///renderer.html',pretendToBeVisual:true })
  const actions=[]
  let update
  const state={ settings:{ language:'en', activePet:'duck' }, pets:[],kind:'island',sessions:[{ id:'a',title:'<img src=x onerror=alert(1)>',status:'waiting',pendingKind:'approval',detail:'Run: rm -rf build',updatedAt:Date.now()-120000 },{ id:'b',title:'Review',status:'running' }] }
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){},drawImage(){} })
  dom.window.matchMedia = () => ({ matches:true,addEventListener(){} })
  dom.window.pet={ initial:async()=>state, action:async value=>{ actions.push(value); return { ok:true } }, interactive(){},focus(){},drag(){},onState(fn){update=fn},onCollapse(){} }
  dom.window.eval(script)
  await new Promise(resolve=>setImmediate(resolve))
  const doc = dom.window.document
  // 有一条待审批时不允许进列表形态：改为单会话详情，把注意力锁在那一个会话上。
  assert.equal(doc.body.dataset.form,'detail')
  assert.equal(doc.body.dataset.pending,'approval')
  assert.equal(doc.querySelector('.session .title').textContent,state.sessions[0].title)
  assert.equal(doc.querySelector('.session .title img'),null)
  assert.equal(doc.querySelector('.session .detail').textContent,'Run: rm -rf build')
  assert.equal(doc.querySelector('.island-pending').dataset.kind,'permission')
  assert.equal(doc.querySelector('.pending-body').textContent,'Run: rm -rf build')
  assert.equal(doc.querySelector('.stamp').textContent,'2 min ago')
  // 两形态都不再有头像、footer 与内联输入：整张卡就是唯一的「打开会话」入口。
  assert.equal(doc.querySelector('.avatar'),null)
  assert.equal(doc.querySelector('.island-footer'),null)
  assert.equal(doc.querySelectorAll('.island-button').length,0)
  assert.equal(doc.querySelectorAll('form').length,0)
  const card = doc.querySelector('.session-detail > button.session-open.island-detail-card')
  assert.ok(card,'the whole detail card is one button')
  assert.equal(doc.querySelectorAll('.session-open').length,1)
  assert.equal(doc.getElementById('workbench'),null)
  assert.equal(doc.querySelector('.actions'),null)
  doc.getElementById('cap').click()
  assert.equal(doc.body.classList.contains('expanded'),true)
  card.click()
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(doc.body.classList.contains('expanded'),false,'opening a session collapses the island again')
  // 宿主没有公开的批准 / 回答接口：整卡只能把人带回会话，绝不伪造 allow / deny。
  assert.deepEqual(JSON.parse(JSON.stringify(actions)),[{ action:'open',sessionId:'a' }])
  update({ ...state,sessions:[] })
  assert.equal(doc.querySelectorAll('.session').length,0)
  assert.equal(doc.querySelectorAll('.session-open').length,0)
  assert.equal(doc.body.dataset.form,'empty')
  dom.window.close()
})

test('running sessions expand as a three-row list with no avatar, footer, input or scrolling', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///renderer.html', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const actions = []
  const sessions = Array.from({ length: 5 }, (_, index) => ({ id: `s${index}`, title: `Session ${index}`, status: 'running', running: true, detail: `step ${index}`, updatedAt: Date.now() }))
  const state = { settings: { language: 'zh', activePet: 'duck' }, pets: [], kind: 'island', sessions }
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {} })
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {} })
  dom.window.pet = { initial: async () => state, action: async value => { actions.push(value); return { ok: true } }, interactive() {}, focus() {}, drag() {}, onState() {}, onCollapse() {} }
  dom.window.eval(script)
  await new Promise(resolve => setImmediate(resolve))
  const doc = dom.window.document
  assert.equal(doc.body.dataset.form, 'list')
  assert.equal(doc.querySelectorAll('.island-row').length, 3, 'the list never grows past three rows')
  assert.equal(doc.querySelectorAll('.session-open').length, 3)
  assert.equal(doc.querySelector('.island-footer'), null)
  assert.equal(doc.querySelector('.avatar'), null, 'session rows have no initial-letter avatar')
  assert.equal(doc.querySelectorAll('form').length, 0, 'the list form has no inline input')
  assert.equal(doc.getElementById('session-count').textContent, '5 个会话')
  const first = doc.querySelector('.island-row .session-open')
  assert.deepEqual([...first.children].map(node => node.className), ['row-lines'], 'the row is a single column: only the two text lines')
  assert.equal(first.querySelector('.title').textContent, 'Session 0')
  assert.equal(first.querySelector('.note').textContent, '正在执行 · step 0')
  doc.getElementById('cap').click()
  assert.equal(doc.body.classList.contains('expanded'), true)
  first.click()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(actions)), [{ action: 'open', sessionId: 's0' }])
  assert.equal(doc.body.classList.contains('expanded'), false, 'opening a row collapses the island again')
})

test('collapsed pill speaks Qoder: status badge on the right, greeting when idle, no idle expansion', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///renderer.html', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const timers = new Map()
  dom.window.setTimeout = (fn, ms) => { timers.set(ms, fn); return ms }
  dom.window.clearTimeout = id => timers.delete(id)
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {} })
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {} })
  const base = {
    settings: { language: 'zh', activePet: 'duck' }, pets: [], kind: 'island',
    display: { notch: { width: 185, height: 32 }, island: { compact: 360, expanded: 390, height: 38 } },
    sessions: [{ id: 'a', title: 'A', status: 'running', running: true }],
  }
  let update
  dom.window.pet = { initial: async () => base, action: async () => ({ ok: true }), interactive() {}, focus() {}, drag() {}, onState(fn) { update = fn }, onCollapse() {} }
  dom.window.eval(script)
  await new Promise(resolve => setImmediate(resolve))
  const doc = dom.window.document, body = doc.body, badge = doc.getElementById('badge-text'), surface = doc.getElementById('surface')
  assert.equal(body.dataset.status, 'running')
  assert.equal(badge.textContent, '正在工作')
  const width = Number(surface.style.width.replace('px', ''))
  assert.ok(width >= 300 && width <= 360, `notch compact stays in range: ${width}`)
  update({ ...base, sessions: [{ id: 'b', title: 'B', status: 'waiting', pendingKind: 'approval' }] })
  assert.equal(body.dataset.status, 'waiting')
  assert.equal(badge.textContent, '需要你处理')
  update({ ...base, sessions: [] })
  assert.equal(body.dataset.status, 'idle')
  assert.equal(badge.textContent, 'hi~')
  surface.dispatchEvent(new dom.window.Event('pointerenter'))
  assert.equal(timers.has(300), false)
  doc.getElementById('cap').click()
  assert.equal(body.classList.contains('expanded'), false)
})

test('the island panel keeps its own stacking context and never fades in', async () => {
  const css = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.css', import.meta.url), 'utf8')
  // #silhouette 是 position:absolute 的黑色剪影，会盖住未定位的 #activity —— 面板必须自己建层叠上下文，否则展开面板全黑。
  assert.match(css, /#activity\{[^}]*position:relative/)
  assert.match(css, /#activity\{[^}]*z-index:1/)
  // 展开时内容不能有淡入：透明窗口里先模糊再变清楚会闪一下黑。
  assert.match(css, /body\.island #activity\{opacity:1;filter:none;transition:none\}/)
  assert.match(css, /body\.island:not\(\.expanded\) #activity\{visibility:hidden\}/)
  // 刘海屏：可见黑面板比 #surface 左右各窄 19px（肩宽），内容必须跟着让出这段，
  // 否则展开态文字/高亮距可见边缘只剩 22-19=3px，看起来贴边。
  assert.match(css, /#activity\{[^}]*padding:9px 20px 18px/)
  assert.match(css, /body\.notched #activity\{padding-top:13px;padding-inline:39px\}/)
  // 胶囊里的宠物/徽标同理：可见面板左内缩 6（收起）/19（展开），再加 12 的品牌内边距。
  assert.match(css, /body\.notched #cap\{padding:0 18px/)
  assert.match(css, /body\.notched\.expanded #cap\{padding-inline:31px\}/)
  // 两形态都去掉了首字母头像与 footer（用户 2026-11-10 反馈），行/卡整块可点。
  assert.doesNotMatch(css, /\.avatar/)
  assert.doesNotMatch(css, /\.island-footer/)
  assert.match(css, /\.row-open\{display:block/)
})

test('clicking the island never pins it: leaving the view collapses it', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///renderer.html', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const timers = new Map()
  dom.window.setTimeout = (fn, ms) => { timers.set(ms, fn); return ms }
  dom.window.clearTimeout = id => timers.delete(id)
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {} })
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {} })
  const state = { settings: { language: 'en', activePet: 'duck' }, pets: [], kind: 'island', sessions: [{ id: 'a', title: 'Build', status: 'running', detail: 'Working' }] }
  dom.window.pet = { initial: async () => state, action: async () => ({ ok: true }), interactive() {}, focus() {}, drag() {}, onState() {}, onCollapse() {} }
  dom.window.eval(script)
  await new Promise(resolve => setImmediate(resolve))
  const { document, Event } = dom.window
  const surface = document.getElementById('surface'), cap = document.getElementById('cap')
  const expanded = () => document.body.classList.contains('expanded')
  // 灵动岛展开态没有输入框（两形态都不收字），所以「输入中保持展开」的守卫只属于桌宠气泡。
  assert.equal(document.querySelectorAll('.session input').length, 0)
  cap.click(); cap.focus()
  assert.equal(document.activeElement, cap)
  assert.equal(expanded(), true)
  surface.dispatchEvent(new Event('pointerleave'))
  timers.get(100)()
  assert.equal(expanded(), false)
})

test('the desktop pet bubble still takes an inline reply and keeps itself open while typing', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///renderer.html', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const timers = new Map()
  dom.window.setTimeout = (fn, ms) => { timers.set(ms, fn); return ms }
  dom.window.clearTimeout = id => timers.delete(id)
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {} })
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {} })
  const actions = []
  const state = { settings: { language: 'en', activePet: 'duck' }, pets: [], kind: 'pet', sessions: [{ id: 'a', title: 'Build', status: 'running', running: true, detail: 'Working' }] }
  dom.window.pet = { initial: async () => state, action: async value => { actions.push(value); return { ok: true } }, interactive() {}, focus() {}, drag() {}, onState() {}, onCollapse() {} }
  dom.window.eval(script)
  await new Promise(resolve => setImmediate(resolve))
  const { document } = dom.window
  const form = document.querySelector('form')
  assert.ok(form, 'the pet bubble keeps the inline reply box')
  document.getElementById('cap').click()
  assert.equal(document.body.classList.contains('expanded'), true)
  const input = form.querySelector('input')
  input.focus()
  document.getElementById('surface').dispatchEvent(new dom.window.Event('pointerleave'))
  timers.get(100)()
  assert.equal(document.body.classList.contains('expanded'), true, 'typing keeps the bubble open')
  input.value = 'Continue carefully'
  form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(actions[0])), { action: 'prompt', sessionId: 'a', text: 'Continue carefully' })
})

test('dragging the island pill moves the window instead of expanding it', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///renderer.html', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {} })
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {} })
  const drags = []
  const state = { settings: { language: 'en', activePet: 'duck' }, pets: [], kind: 'island', sessions: [{ id: 'a', title: 'Build', status: 'running', detail: 'Working' }] }
  dom.window.pet = { initial: async () => state, action: async () => ({ ok: true }), interactive() {}, focus() {}, drag: value => drags.push(value), onState() {}, onExpanded() {}, onCollapse() {} }
  dom.window.eval(script)
  await new Promise(resolve => setImmediate(resolve))
  const { document } = dom.window
  const cap = document.getElementById('cap'), surface = document.getElementById('surface')
  cap.setPointerCapture = () => {}
  document.elementFromPoint = () => cap
  const fire = (target, type, props) => { const event = new dom.window.Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { pointerId: 1, button: 0, screenX: 0, screenY: 0 }, props); target.dispatchEvent(event) }
  fire(cap, 'pointerdown', { screenX: 100, screenY: 20 })
  assert.deepEqual(drags, ['start'])
  fire(cap, 'pointermove', { screenX: 160, screenY: 20 })
  assert.deepEqual(drags, ['start', 'move'])
  fire(cap, 'pointerup')
  assert.deepEqual(drags, ['start', 'move', 'end'])
  fire(cap, 'click')
  assert.equal(dom.window.document.body.classList.contains('expanded'), false)
})
test('island hover and collapse stay local when session updates reach both displays', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const state = { settings: { language: 'en' }, pets: [], kind: 'island', sessions: [{ id: 'a', title: 'Updated session', status: 'running' }] }
  const displays = Array.from({ length: 2 }, () => {
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///renderer.html', pretendToBeVisual: true })
    t.after(() => dom.window.close())
    const timers = new Map()
    dom.window.setTimeout = (fn, ms) => { timers.set(ms, fn); return ms }
    dom.window.clearTimeout = id => timers.delete(id)
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {} })
    dom.window.matchMedia = () => ({ matches: true, addEventListener() {} })
    dom.window.Element.prototype.getBoundingClientRect = function () {
      if (this.id === 'cap') return { x: 0, y: 0, left: 0, top: 0, right: 360, bottom: 38, width: 360, height: 38 }
      return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
    }
    let update, collapse
    dom.window.pet = { initial: async () => state, action: async () => ({ ok: true }), interactive() {}, focus() {}, drag() {}, onState(fn) { update = fn }, onCollapse(fn) { collapse = fn } }
    dom.window.eval(script)
    return { dom, timers, update: next => update(next), collapse: () => collapse(), expanded: () => dom.window.document.body.classList.contains('expanded'), surface: dom.window.document.getElementById('surface') }
  })
  await new Promise(resolve => setImmediate(resolve))
  for (const [i, display] of displays.entries()) {
    const pointer = (type, x, y) => { const event = new display.dom.window.Event(type); Object.assign(event, { clientX: x, clientY: y }); display.surface.dispatchEvent(event) }
    pointer('pointerenter', 180, 20)
    display.timers.get(300)()
    assert.deepEqual(displays.map(item => item.expanded()), displays.map((_, index) => index === i))
    for (const item of displays) item.update({ ...state, sessions: [{ id: 'a', title: 'Updated session 2', status: 'running' }] })
    assert.deepEqual(displays.map(item => item.expanded()), displays.map((_, index) => index === i))
    pointer('pointerleave', 180, 420)
    display.timers.get(100)()
    assert.deepEqual(displays.map(item => item.expanded()), [false, false])
  }
  for (const display of displays) display.dom.window.document.getElementById('cap').click()
  displays[0].collapse()
  assert.deepEqual(displays.map(item => item.expanded()), [false, true])
})

test('the transparent window only takes the mouse where it paints, so other apps keep their clicks', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///renderer.html', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const interactive = []
  const state = { settings: { language: 'en', activePet: 'duck' }, pets: [], kind: 'island', sessions: [{ id: 'a', title: 'A', status: 'running', running: true }] }
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {} })
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {} })
  // 424x500 的透明窗口里只有胶囊（360x38）与展开后的内容块真正可见，其余全是透明区域。
  dom.window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'cap') return { x: 0, y: 0, left: 0, top: 0, right: 360, bottom: 38, width: 360, height: 38 }
    if (this.id === 'activity') return { x: 0, y: 38, left: 0, top: 38, right: 390, bottom: 260, width: 390, height: 222 }
    return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  }
  dom.window.pet = { initial: async () => state, action: async () => ({ ok: true }), interactive: value => interactive.push(value), focus() {}, drag() {}, onState() {}, onExpanded() {}, onCollapse() {} }
  dom.window.eval(script)
  await new Promise(resolve => setImmediate(resolve))
  const move = (x, y) => { const event = new dom.window.Event('pointermove', { bubbles: true }); Object.assign(event, { clientX: x, clientY: y }); dom.window.document.dispatchEvent(event) }
  move(180, 20)
  assert.equal(interactive.at(-1), true, 'over the pill the window must take the mouse')
  move(180, 400)
  assert.equal(interactive.at(-1), false, 'the transparent area under the content must pass clicks through')
  move(420, 20)
  assert.equal(interactive.at(-1), false, 'the transparent area beside the pill must pass clicks through')
})

test('entering the transparent part of the window must not hold the mouse', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///renderer.html', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  const interactive = []
  const timers = new Map()
  dom.window.setTimeout = (fn, ms) => { timers.set(ms, fn); return ms }
  dom.window.clearTimeout = id => timers.delete(id)
  const state = { settings: { language: 'en', activePet: 'duck' }, pets: [], kind: 'island', sessions: [{ id: 'a', title: 'A', status: 'running', running: true }] }
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {} })
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {} })
  dom.window.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'cap') return { x: 0, y: 0, left: 0, top: 0, right: 360, bottom: 38, width: 360, height: 38 }
    return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  }
  dom.window.pet = { initial: async () => state, action: async () => ({ ok: true }), interactive: value => interactive.push(value), focus() {}, drag() {}, onState() {}, onExpanded() {}, onCollapse() {} }
  dom.window.eval(script)
  await new Promise(resolve => setImmediate(resolve))
  const enter = (x, y) => { const event = new dom.window.Event('pointerenter'); Object.assign(event, { clientX: x, clientY: y }); dom.window.document.getElementById('surface').dispatchEvent(event) }
  enter(180, 20)
  assert.equal(interactive.at(-1), true)
  assert.equal(timers.has(300), true, 'hovering the pill queues the expand after 300ms')
  timers.clear()
  enter(180, 420)
  assert.equal(interactive.at(-1), false, 'transparent area must stay click-through')
  assert.equal(timers.has(300), false, 'hovering empty space must not queue the expand animation')
})

test('pet motions follow Qoder: greet, review on completion, and a quiet desktop glance', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///renderer.html', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  let clock = 1000
  Object.defineProperty(dom.window.performance, 'now', { value: () => clock, configurable: true })
  dom.window.Math.random = () => 0.5
  const pet = { id: 'whale', name: 'Whale', spritesheet: 'pet-asset://pet/whale/spritesheet.png', spriteVersionNumber: 2 }
  const base = { settings: { language: 'zh', activePet: 'whale' }, pets: [pet], kind: 'pet', sessions: [] }
  let update
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {} })
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} })
  dom.window.pet = { initial: async () => base, action: async () => ({ ok: true }), interactive() {}, focus() {}, drag() {}, onState(fn) { update = fn }, onCollapse() {} }
  dom.window.eval(script)
  await new Promise(resolve => setImmediate(resolve))
  const doc = dom.window.document
  assert.equal(doc.body.dataset.motion, 'waving', 'a freshly launched pet waves hello for 2.6s')
  clock = 5000
  update({ ...base, sessions: [{ id: 'a', title: 'A', status: 'completed' }] })
  assert.equal(doc.body.dataset.motion, 'review', 'a finished turn uses the review row instead of falling back to idle')
  update({ ...base, sessions: [{ id: 'a', title: 'A', status: 'running' }] })
  assert.equal(doc.body.dataset.motion, 'running')
  update({ ...base, sessions: [] })
  assert.equal(doc.body.dataset.motion, 'idle')
  // 久坐：桌宠 8 秒没被打扰后放慢 idle，并偶尔用 v2 表第 9–10 行瞟一眼（鲸鱼只动瞳孔）。
  clock = 15000
  update({ ...base, sessions: [] })
  assert.equal(doc.body.dataset.motion, 'look', 'an idle desktop pet glances around')
  clock = 16000
  update({ ...base, sessions: [] })
  assert.equal(doc.body.dataset.motion, 'idle', 'the glance ends and the pet settles again')
})

test('a pet with motion clips plays the 60 fps WebP instead of redrawing the sheet', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'file:///renderer.html', pretendToBeVisual: true })
  t.after(() => dom.window.close())
  Object.defineProperty(dom.window.performance, 'now', { value: () => 5000, configurable: true })
  // 宠物刚启动的 2.6 秒在挥手，先把 waving 也登记上，等窗口过去再看 running。
  const clips = {
    idle: 'pet-asset://pet/whale/motion/idle.webp',
    running: 'pet-asset://pet/whale/motion/running.webp',
    waving: 'pet-asset://pet/whale/motion/waving.webp',
  }
  const pet = { id: 'whale', name: 'Whale', spritesheet: 'pet-asset://pet/whale/spritesheet.png', spriteVersionNumber: 2, animations: clips }
  const base = { settings: { language: 'zh', activePet: 'whale' }, pets: [pet], kind: 'pet', sessions: [{ id: 'a', title: 'A', status: 'running' }] }
  let update
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect() {}, drawImage() {} })
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} })
  dom.window.pet = { initial: async () => base, action: async () => ({ ok: true }), interactive() {}, focus() {}, drag() {}, onState(fn) { update = fn }, onCollapse() {} }
  dom.window.eval(script)
  await new Promise(resolve => setImmediate(resolve))
  const doc = dom.window.document
  const film = doc.getElementById('film'), canvas = doc.getElementById('sprite')
  assert.equal(film.hidden, false, 'the clip image takes over')
  assert.equal(canvas.hidden, true, 'the sprite sheet canvas steps aside')
  assert.equal(film.getAttribute('src'), clips.waving, 'the greeting clip is the one playing')
  // 没有片段登记的动作（这里是 16 方向视线）必须回退到精灵表。
  update({ ...base, pets: [{ ...pet, animations: {} }] })
  assert.equal(film.hidden, true, 'a pet without clips falls back to the canvas')
  assert.equal(canvas.hidden, false)
})
