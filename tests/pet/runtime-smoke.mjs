// Explicit native smoke: ELECTRON_PATH=/path/to/Electron node tests/pet/runtime-smoke.mjs [output-directory]
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { readFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'

const runtime = fileURLToPath(new URL('../../src/modules/pet/host/runtime/', import.meta.url))
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'dsh-pet-smoke'))
const electron = process.env.ELECTRON_PATH
if (!electron) throw new Error('Set ELECTRON_PATH to a standalone Electron executable')
const manifest = JSON.parse(await readFile(path.join(runtime,'pets/qoduck-lab/pet.json'),'utf8'))
const snapshot = { settings:{ activePet:'qoduck-lab',petEnabled:true,petSize:100,bubbleWidth:280,islandEnabled:true,islandAllDisplays:process.env.PET_SMOKE_ALL_DISPLAYS === '1',islandIdle:true,islandWidth:100,islandHeight:100,language:'zh' }, pets:[{ id:'qoduck-lab',name:'Qoduck Lab',assetDir:path.join(runtime,'pets/qoduck-lab'),manifest }],sessions:[{ id:'smoke',title:'桌宠与灵动岛运行验证',status:'running',detail:'实际 Electron 窗口，已连接本地 Host。',running:true }],revision:1 }
const token = 'runtime-smoke-local-token'
const server = http.createServer((req,res) => {
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return }
  if (req.url === '/state') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(snapshot)); return }
  if (req.url === '/events') { res.writeHead(200,{ 'Content-Type':'text/event-stream' }); res.write(`data: ${JSON.stringify(snapshot)}\n\n`); return }
  res.writeHead(404).end()
})
await mkdir(output,{ recursive:true })
server.listen(0,'127.0.0.1')
await once(server,'listening')
const env = { ...process.env, DSH_TOOLKIT_PET_URL:`http://127.0.0.1:${server.address().port}`,DSH_TOOLKIT_PET_TOKEN:token,DSH_TOOLKIT_HOST_PID:String(process.pid),DSH_TOOLKIT_PET_SMOKE_DIR:output }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron,[path.join(runtime,'main.cjs')],{ env,stdio:['ignore','pipe','pipe'] })
let stdout='',stderr=''
child.stdout.on('data',chunk=>{stdout+=chunk})
child.stderr.on('data',chunk=>{stderr+=chunk})
const timeout=setTimeout(()=>child.kill('SIGKILL'),20000)
try {
  const [code]=await once(child,'exit')
  assert.equal(code,0,stderr)
  assert.ok(stdout.split('\n').some(line=>{try{return JSON.parse(line).type==='ready'}catch{return false}}),'missing ready handshake')
  const pet=path.join(output,'pet.png')
  const island=(await import('node:fs/promises')).readdir(output).then(files=>files.find(name=>name.startsWith('island-')))
  assert.ok((await stat(pet)).size>1000,'missing pet image')
  const islandName=await island
  assert.ok(islandName,'missing island image')
  assert.ok((await stat(path.join(output,islandName))).size>1000)
  const report = JSON.parse(await readFile(path.join(output, 'smoke-report.json'), 'utf8'))
  const allDisplays = process.env.PET_SMOKE_ALL_DISPLAYS === '1'
  assert.equal(report.islands.length, allDisplays ? report.displays : 1)
  assert.equal(report.independentHover.length, report.islands.length)
  for (const hover of report.independentHover) {
    assert.equal(hover.onlySourceExpanded, true)
    assert.equal(hover.allCollapsedOnLeave, true)
  }
  for (const island of report.islands) {
    assert.equal(island.expanded, true)
    assert.equal(island.visible, true)
    assert.equal(island.buttonsVisible, true)
    assert.ok(island.sessionCount > 0)
    assert.ok(island.opacity >= .99)
    assert.equal(island.cameraExcluded, true)
    assert.ok((await stat(path.join(output, `${island.key}-compact.png`))).size > 1000)
    if (island.notch) {
      assert.equal(island.windowBounds.y, island.screenBounds.y)
      const cameraCenter = island.screenBounds.x + island.notch.x + island.notch.width / 2
      assert.ok(Math.abs(island.windowBounds.x + island.windowBounds.width / 2 - cameraCenter) <= 1)
    } else assert.equal(island.windowBounds.y, island.screenBounds.y + 6)
  }
  console.log(JSON.stringify({ ok:true,pet,island:path.join(output,islandName), displays:report.displays, islandCount:report.islands.length, multiDisplayVerified:allDisplays && report.displays > 1 }))
} finally { clearTimeout(timeout); server.closeAllConnections(); server.close() }
