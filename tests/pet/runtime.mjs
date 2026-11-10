import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
const require = createRequire(import.meta.url)
const { readEnvironment, publicState, islandGeometry, assetPath, validatedAction, consumeEvents } = require('../../src/modules/pet/host/runtime/core.cjs')
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
  assert.deepEqual(islandGeometry(), { compact:220,expanded:390,height:38 })
  assert.deepEqual(islandGeometry({}, { width:185,height:32 }), { compact:297,expanded:390,height:38 })
  assert.equal(islandGeometry({ islandWidth:150 }).expanded, 390)
  assert.equal(islandGeometry({ islandWidth:75 }).compact, 165)
  assert.ok(islandGeometry({ islandHeight:75 }, { width:185,height:32 }).height >= 36)
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
test('island hover and collapse stay local when session updates reach both displays', async (t) => {
  const html = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.html', import.meta.url), 'utf8')
  const script = await readFile(new URL('../../src/modules/pet/host/runtime/renderer.js', import.meta.url), 'utf8')
  const state = { settings: { language: 'en' }, pets: [], kind: 'island', sessions: [] }
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
    for (const item of displays) item.update({ ...state, sessions: [{ id: 'a', title: 'Updated session', status: 'running' }] })
    assert.deepEqual(displays.map(item => item.expanded()), displays.map((_, index) => index === i))
    display.surface.dispatchEvent(new display.dom.window.Event('pointerleave'))
    display.timers.get(100)()
    assert.deepEqual(displays.map(item => item.expanded()), [false, false])
  }
  for (const display of displays) display.dom.window.document.getElementById('cap').click()
  displays[0].collapse()
  assert.deepEqual(displays.map(item => item.expanded()), [false, true])
})
