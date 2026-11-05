'use strict'
const { app, BrowserWindow, ipcMain, protocol, screen, net, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { readEnvironment, publicState, islandGeometry, assetPath, validatedAction, consumeEvents } = require('./core.cjs')

protocol.registerSchemesAsPrivileged([{ scheme: 'pet-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let config
try { config = readEnvironment(process.env) } catch { process.stderr.write('Invalid pet helper environment\n'); app.exit(1) }
const abort = new AbortController()
const windows = new Map()
let state = { settings: {}, pets: [], sessions: [] }
let quitting = false
let petPosition = null
let hostWatch
const pageUrl = pathToFileURL(path.join(__dirname, 'renderer.html')).href

async function request(route, options = {}) {
  const response = await fetch(config.origin + route, { ...options, redirect: 'error', signal: options.signal || AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${config.token}`, ...options.headers } })
  if (!response.ok) throw new Error('Pet Host request failed')
  return response
}
function exit(code = 0) {
  if (quitting) return
  quitting = true
  abort.abort(); clearInterval(hostWatch)
  for (const { win } of windows.values()) if (!win.isDestroyed()) win.destroy()
  windows.clear()
  app.exit(code)
}
function entryFor(event) {
  const entry = [...windows.values()].find(item => item.win.webContents === event.sender)
  if (!entry || event.senderFrame !== event.sender.mainFrame || !event.senderFrame.url.startsWith(pageUrl)) throw new Error('Unknown pet renderer')
  return entry
}
function snapshot(entry) { return publicState(state, entry.kind, entry.display) }
function dimensions(kind, display) {
  const settings = state.settings
  const geometry = islandGeometry(settings)
  const width = kind === 'pet' ? Math.min(display.workArea.width, Math.round(Number(settings.bubbleWidth) || 280) + 24) : Math.min(display.bounds.width, Math.max(360, geometry.expanded + 24, geometry.compact + 64))
  const height = Math.min(kind === 'pet' ? 440 : 500, display.workArea.height)
  const area = display.workArea
  if (kind === 'pet') return { width, height, x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, petPosition?.x ?? area.x + area.width - width - 24))), y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, petPosition?.y ?? area.y + area.height - height - 16))) }
  return { width, height, x: Math.round(display.bounds.x + (display.bounds.width - width) / 2), y: display.bounds.y + 6 }
}
async function createWindow(key, kind, display) {
  const win = new BrowserWindow({ ...dimensions(kind, display), show: false, frame: false, transparent: true, hasShadow: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, title: 'DSH Pet', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: true } })
  const entry = { win, kind, display, dragging: null }
  windows.set(key, entry)
  win.setAlwaysOnTop(true, 'floating')
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-attach-webview', event => event.preventDefault())
  win.webContents.on('render-process-gone', () => exit(1))
  win.on('blur', () => {
    setTimeout(() => {
      if (win.isDestroyed()) return
      const focused = BrowserWindow.getFocusedWindow()
      if (kind === 'island' && [...windows.values()].some(item => item.kind === 'island' && item.win === focused)) return
      win.webContents.send('pet:collapse')
    }, 50)
  })
  win.on('closed', () => windows.delete(key))
  await win.loadFile(path.join(__dirname, 'renderer.html'))
  if (!win.isDestroyed()) win.showInactive()
  return entry
}
let reconcile = Promise.resolve()
function update(next) {
  if (!next || !next.settings || !Array.isArray(next.pets) || !Array.isArray(next.sessions)) throw new Error('Invalid pet state')
  state = next
  reconcile = reconcile.then(async () => {
    const displays = screen.getAllDisplays()
    const primary = screen.getPrimaryDisplay()
    const desired = new Map()
    if (state.settings.petEnabled) desired.set('pet', { kind: 'pet', display: primary })
    if (state.settings.islandEnabled && (state.settings.islandIdle !== false || state.sessions.length)) {
      for (const display of state.settings.islandAllDisplays === false ? [primary] : displays) desired.set(`island-${display.id}`, { kind: 'island', display })
    }
    for (const [key, entry] of windows) if (!desired.has(key)) { entry.win.destroy(); windows.delete(key) }
    for (const [key, spec] of desired) {
      let entry = windows.get(key)
      if (!entry) entry = await createWindow(key, spec.kind, spec.display)
      else {
        entry.display = spec.display
        entry.win.setBounds(dimensions(entry.kind, entry.display))
        entry.win.webContents.send('pet:state', snapshot(entry))
      }
    }
    if (!state.settings.petEnabled && !state.settings.islandEnabled) exit()
  }).catch(() => { process.stderr.write('Pet window setup failed\n'); exit(1) })
  return reconcile
}

ipcMain.handle('pet:initial', event => snapshot(entryFor(event)))
ipcMain.handle('pet:action', async (event, input) => {
  entryFor(event)
  try {
    const action = validatedAction(input)
    if (action.sessionId && !state.sessions.some(s => s.id === action.sessionId)) throw new Error('Unknown session')
    const response = await request('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) })
    await response.arrayBuffer()
    return { ok: true }
  } catch { return { ok: false } }
})
ipcMain.on('pet:interactive', (event, value) => { const { win } = entryFor(event); win.setIgnoreMouseEvents(!value, { forward: true }) })
ipcMain.on('pet:focus', event => { const { win } = entryFor(event); win.setIgnoreMouseEvents(false); win.focus() })
ipcMain.on('pet:expand', (event, expanded) => {
  const source = entryFor(event)
  if (source.kind !== 'island') return
  for (const entry of windows.values()) if (entry.kind === 'island' && entry !== source) entry.win.webContents.send('pet:expanded', Boolean(expanded))
})
ipcMain.on('pet:drag', (event, value) => {
  const entry = entryFor(event)
  if (entry.kind !== 'pet') return
  const point = screen.getCursorScreenPoint()
  if (value === 'start') { const [x, y] = entry.win.getPosition(); entry.dragging = { dx: point.x - x, dy: point.y - y }; return }
  if (!entry.dragging) return
  const display = screen.getDisplayNearestPoint(point)
  const area = display.workArea
  const [w, h] = entry.win.getSize()
  const x = Math.round(Math.max(area.x, Math.min(area.x + area.width - w, point.x - entry.dragging.dx)))
  const y = Math.round(Math.max(area.y, Math.min(area.y + area.height - h, point.y - entry.dragging.dy)))
  entry.win.setPosition(x, y); petPosition = { x, y }
  if (value === 'end') { entry.dragging = null; request('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'position', x, y }) }).catch(() => {}) }
})

app.on('window-all-closed', () => {})
app.on('before-quit', () => { abort.abort(); clearInterval(hostWatch) })
process.on('SIGTERM', () => exit())
process.on('SIGINT', () => exit())
app.whenReady().then(async () => {
  if (!config) return
  app.dock?.hide()
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  protocol.handle('pet-asset', async requestInfo => {
    try {
      const file = assetPath(state, requestInfo.url)
      if (!file) return new Response('', { status: 404 })
      return await net.fetch(pathToFileURL(file).href)
    } catch { return new Response('', { status: 404 }) }
  })
  const response = await request('/state')
  await update(await response.json())
  await reconcile
  if (quitting) return
  process.stdout.write('{"type":"ready"}\n')
  hostWatch = setInterval(() => { try { process.kill(config.hostPid, 0) } catch { exit() } }, 2000)
  screen.on('display-added', () => update(state))
  screen.on('display-removed', () => update(state))
  screen.on('display-metrics-changed', () => update(state))
  if (process.env.DSH_TOOLKIT_PET_SMOKE_DIR) {
    await fs.mkdir(process.env.DSH_TOOLKIT_PET_SMOKE_DIR, { recursive: true })
    await new Promise(resolve => setTimeout(resolve, 1100))
    const report = { displays: screen.getAllDisplays().length, islands: [] }
    for (const [key, entry] of windows) {
      if (entry.kind === 'island') {
        entry.win.setIgnoreMouseEvents(false)
        entry.win.show(); entry.win.focus()
        await new Promise(resolve => setTimeout(resolve, 150))
        const visible = await entry.win.webContents.executeJavaScript(`(async () => {
          const cap = document.getElementById('cap')
          if (!document.body.classList.contains('expanded')) cap.click()
          ;(document.querySelector('input') || cap).focus()
          await new Promise(resolve => setTimeout(resolve, 750))
          await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().endTime !== Infinity).map(animation => animation.finished.catch(() => {})))
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const body = document.getElementById('activity'), surface = document.getElementById('surface')
          const style = getComputedStyle(body), rect = body.getBoundingClientRect(), bounds = surface.getBoundingClientRect()
          const buttons = [...document.querySelectorAll('.session .actions button')]
          return {
            expanded: document.body.classList.contains('expanded'), opacity: Number(style.opacity), filter: style.filter,
            visible: style.visibility === 'visible' && rect.height > 0 && bounds.height > cap.getBoundingClientRect().height + 40,
            sessionCount: document.querySelectorAll('.session').length,
            buttonsVisible: buttons.length > 0 && buttons.every(button => { const box = button.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.bottom <= bounds.bottom && box.top >= bounds.top }),
            height: bounds.height,
          }
        })()`)
        if (!visible.expanded || !visible.visible || visible.opacity < .99 || visible.filter !== 'blur(0px)' && visible.filter !== 'none' || !visible.sessionCount || !visible.buttonsVisible) throw new Error('Island did not visibly expand')
        report.islands.push({ key, ...visible })
      }
      const image = await entry.win.webContents.capturePage()
      await fs.writeFile(path.join(process.env.DSH_TOOLKIT_PET_SMOKE_DIR, `${key}.png`), image.toPNG())
    }
    await fs.writeFile(path.join(process.env.DSH_TOOLKIT_PET_SMOKE_DIR, 'smoke-report.json'), JSON.stringify(report, null, 2))
    exit(); return
  }
  const events = await request('/events', { signal: abort.signal, headers: { Accept: 'text/event-stream' } })
  if (!events.body) throw new Error('Missing pet event stream')
  await consumeEvents(events.body, next => { update(next) }, abort.signal)
  exit()
}).catch(error => {
  if (!quitting) {
    const message = String(error?.message || 'Unknown error').replaceAll(config?.token || '\u0000', '[redacted]').replace(/https?:\/\/\S+/g, '[url]').replace(/[\r\n]/g, ' ').slice(0, 500)
    process.stderr.write(`Pet helper failed: ${message}\n`)
    exit(1)
  }
})
