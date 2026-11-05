import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
const require = createRequire(import.meta.url)
const { readEnvironment, publicState, islandGeometry, assetPath, validatedAction, consumeEvents } = require('../../src/modules/pet/host/runtime/core.cjs')
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
test('island geometry follows documented compact and expanded limits', () => {
  assert.deepEqual(islandGeometry(), { compact:212,expanded:280,height:32 })
  assert.deepEqual(islandGeometry({ islandWidth:100 },true), { compact:268,expanded:412,height:32 })
  assert.equal(islandGeometry({ islandWidth:150 }).expanded, 280)
  assert.equal(islandGeometry({ islandWidth:75 }).compact, 168)
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
  assert.equal(dom.window.document.querySelector('h2').textContent,state.sessions[0].title)
  assert.equal(dom.window.document.querySelector('h2 img'),null)
  assert.equal(dom.window.document.querySelectorAll('form').length,1)
  dom.window.document.querySelector('.actions button').click()
  assert.deepEqual(JSON.parse(JSON.stringify(actions[0])),{ action:'open',sessionId:'a' })
  const form=dom.window.document.querySelector('form')
  form.querySelector('input').value='Continue carefully'
  form.dispatchEvent(new dom.window.Event('submit',{ cancelable:true }))
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(actions[1].text,'Continue carefully')
  dom.window.document.getElementById('workbench').click()
  assert.deepEqual(JSON.parse(JSON.stringify(actions[2])),{ action:'open',sessionId:'a' })
  update({ ...state,sessions:[] })
  assert.equal(dom.window.document.querySelectorAll('.session').length,0)
  assert.equal(dom.window.document.getElementById('workbench').disabled,true)
  dom.window.document.getElementById('workbench').click()
  assert.equal(actions.length,3)
  dom.window.close()
})
