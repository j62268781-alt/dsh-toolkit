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
  const result = publicState({ settings:{ token:'secret', electronPath:'/secret', language:'en' }, pets:[{ id:'duck', name:'Duck', assetDir:'/private', manifest:{ spriteVersionNumber:2 } }], sessions:[{ id:'done', status:'completed' }, { id:'wait', status:'waiting' }, { id:'run', status:'running' }], runtime:{ token:'secret' } }, 'pet', { bounds:{ width:1000,height:800 } })
  assert.deepEqual(result.sessions.map(s => s.id), ['wait','run','done'])
  assert.equal(result.pets[0].spritesheet, 'pet-asset://pet/duck/spritesheet.png')
  assert.equal(JSON.stringify(result).includes('/private'), false)
  assert.equal(JSON.stringify(result).includes('secret'), false)
})
test('assets are bounded to one known pet spritesheet', () => {
  const state = { pets:[{ id:'duck', assetDir:'/assets/duck' }] }
  assert.equal(assetPath(state, 'pet-asset://pet/duck/spritesheet.png'), '/assets/duck/spritesheet.png')
  for (const url of ['pet-asset://pet/duck/../secret', 'pet-asset://pet/duck/%2fetc', 'pet-asset://pet/unknown/spritesheet.png', 'https://pet/duck/spritesheet.png']) assert.equal(assetPath(state,url), null)
})
test('actions exclude grants and reject malformed prompts and coordinates', () => {
  assert.throws(() => validatedAction({ action:'approve' }))
  assert.throws(() => validatedAction({ action:'cancel' }))
  assert.throws(() => validatedAction({ action:'prompt', sessionId:'x', text:' ' }))
  assert.throws(() => validatedAction({ action:'position', x:NaN, y:0 }))
  assert.deepEqual(validatedAction({ action:'prompt', sessionId:'x', text:' hello ', token:'secret' }), { action:'prompt',sessionId:'x',text:'hello' })
})
test('island geometry reserves native camera space and a stable expanded width', () => {
  assert.deepEqual(islandGeometry(), { compact:280,expanded:390,height:38 })
  assert.deepEqual(islandGeometry({}, { width:185,height:32 }), { compact:360,expanded:390,height:38 })
  assert.equal(islandGeometry({ islandWidth:150 }).expanded, 390)
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
test('real renderer safely displays sessions, forwards actions, and directs pending reviews to session', async () => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url),'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url),'utf8')
  const dom = new JSDOM(html,{ runScripts:'outside-only',url:'file:///renderer.html',pretendToBeVisual:true })
  const actions=[]
  let update
  const state={ settings:{ language:'en', activePet:'duck' }, pets:[],kind:'island',sessions:[{ id:'a',title:'<img src=x onerror=alert(1)>',status:'running',running:true,detail:'Working' },{ id:'b',title:'Review',status:'waiting',pendingKind:'approval' }] }
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ clearRect(){},drawImage(){} })
  dom.window.matchMedia = () => ({ matches:true,addEventListener(){} })
  dom.window.pet={ initial:async()=>state, action:async value=>{ actions.push(value); return { ok:true } }, interactive(){},focus(){},expand(){},drag(){},onState(fn){update=fn},onExpanded(){},onCollapse(){} }
  dom.window.eval(script)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(dom.window.document.querySelector('.session .title').textContent,state.sessions[0].title)
  assert.equal(dom.window.document.querySelector('.session .title img'),null)
  assert.equal(dom.window.document.querySelectorAll('form').length,1)
  assert.equal(dom.window.document.getElementById('workbench'),null)
  assert.equal(dom.window.document.querySelector('.actions'),null)
  dom.window.document.querySelector('.session-open').click()
  assert.deepEqual(JSON.parse(JSON.stringify(actions[0])),{ action:'open',sessionId:'a' })
  const form=dom.window.document.querySelector('form')
  form.querySelector('input').value='Continue carefully'
  form.dispatchEvent(new dom.window.Event('submit',{ cancelable:true }))
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(actions[1].text,'Continue carefully')
  update({ ...state,sessions:[] })
  assert.equal(dom.window.document.querySelectorAll('.session').length,0)
  assert.equal(dom.window.document.querySelectorAll('.session-open').length,0)
  assert.equal(actions.length,2)
  dom.window.close()
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

test('clicking the island never pins it: leaving the view collapses unless a reply is being typed', async (t) => {
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
  cap.click(); cap.focus()
  assert.equal(document.activeElement, cap)
  assert.equal(expanded(), true)
  surface.dispatchEvent(new Event('pointerleave'))
  timers.get(100)()
  assert.equal(expanded(), false)
  cap.click(); document.querySelector('input').focus()
  surface.dispatchEvent(new Event('pointerleave'))
  timers.get(100)()
  assert.equal(expanded(), true)
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
    let update, collapse
    dom.window.pet = { initial: async () => state, action: async () => ({ ok: true }), interactive() {}, focus() {}, drag() {}, onState(fn) { update = fn }, onCollapse(fn) { collapse = fn } }
    dom.window.eval(script)
    return { dom, timers, update: next => update(next), collapse: () => collapse(), expanded: () => dom.window.document.body.classList.contains('expanded'), surface: dom.window.document.getElementById('surface') }
  })
  await new Promise(resolve => setImmediate(resolve))
  for (const [i, display] of displays.entries()) {
    display.surface.dispatchEvent(new display.dom.window.Event('pointerenter'))
    display.timers.get(300)()
    assert.deepEqual(displays.map(item => item.expanded()), displays.map((_, index) => index === i))
    for (const item of displays) item.update({ ...state, sessions: [{ id: 'a', title: 'Updated session 2', status: 'running' }] })
    assert.deepEqual(displays.map(item => item.expanded()), displays.map((_, index) => index === i))
    display.surface.dispatchEvent(new display.dom.window.Event('pointerleave'))
    display.timers.get(100)()
    assert.deepEqual(displays.map(item => item.expanded()), [false, false])
  }
  for (const display of displays) display.dom.window.document.getElementById('cap').click()
  displays[0].collapse()
  assert.deepEqual(displays.map(item => item.expanded()), [false, true])
})
