'use strict'
const { app, BrowserWindow, ipcMain, protocol, screen, net, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { readFileSync } = require('node:fs')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { readEnvironment, publicState, islandGeometry, islandPlacement, islandOffset, assetPath, validatedAction, consumeEvents } = require('./core.cjs')
const { notchForDisplay, queryNativeScreens } = require('./native.cjs')

protocol.registerSchemesAsPrivileged([{ scheme: 'pet-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
let config
try { config = readEnvironment(process.env) } catch { process.stderr.write('Invalid pet helper environment\n'); app.exit(1) }
const abort = new AbortController()
const windows = new Map()
let state = { settings: {}, pets: [], sessions: [] }
let quitting = false
// 窗口位置属于本地布局状态，不属于插件配置：拖过之后重开也应该还在原处。
const layoutFile = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'toolkit', 'pet', 'layout.json')
function readLayout() {
  try {
    const data = JSON.parse(readFileSync(layoutFile, 'utf8'))
    const pet = Number.isFinite(data?.pet?.x) && Number.isFinite(data?.pet?.y) ? { x: Math.round(data.pet.x), y: Math.round(data.pet.y) } : null
    const islands = {}
    if (data?.islands && typeof data.islands === 'object') for (const [key, value] of Object.entries(data.islands)) if (Number.isFinite(value?.dx) && Number.isFinite(value?.dy)) islands[key] = { dx: Math.round(value.dx), dy: Math.round(value.dy) }
    return { pet, islands }
  } catch { return { pet: null, islands: {} } }
}
const layout = readLayout()
function saveLayout() {
  fs.mkdir(path.dirname(layoutFile), { recursive: true }).then(() => fs.writeFile(layoutFile, JSON.stringify(layout))).catch(() => {})
}
let petPosition = layout.pet
let hostWatch
let nativeScreens = []
let displayTimer
function withNative(display) { return { ...display, notch: notchForDisplay(display, nativeScreens) } }
const pageUrl = pathToFileURL(path.join(__dirname, 'renderer.html')).href

async function request(route, options = {}) {
  const response = await fetch(config.origin + route, { ...options, redirect: 'error', signal: options.signal || AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${config.token}`, ...options.headers } })
  if (!response.ok) throw new Error('Pet Host request failed')
  return response
}
function exit(code = 0) {
  if (quitting) return
  quitting = true
  abort.abort(); clearInterval(hostWatch); clearTimeout(displayTimer)
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
  const geometry = islandGeometry(settings, display.notch)
  const width = kind === 'pet' ? Math.min(display.workArea.width, Math.round(Number(settings.bubbleWidth) || 280) + 24) : Math.min(display.bounds.width, Math.max(360, geometry.expanded + 24, geometry.compact + 64))
  const height = Math.min(kind === 'pet' ? 440 : 500, display.workArea.height)
  const area = display.workArea
  if (kind === 'pet') return { width, height, x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, petPosition?.x ?? area.x + area.width - width - 24))), y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, petPosition?.y ?? area.y + area.height - height - 16))) }
  // 有刘海的屏幕由相机凸起占住顶部，岛贴着屏幕顶端画（screen-saver 层级，可以压在菜单栏上）。
  // 没有刘海的屏幕顶部是菜单栏，岛必须挂在菜单栏下方，否则会被菜单栏裁掉一截。
  // 用户拖动过的屏幕按记住的偏移量摆放，偏移量始终夹在该屏幕范围内。
  return { width, height, ...islandPlacement(display, { width, height }, layout.islands[String(display.id)]) }
}
async function createWindow(key, kind, display) {
  const win = new BrowserWindow({ ...dimensions(kind, display), enableLargerThanScreen: kind === 'island', type: process.platform === 'darwin' && kind === 'island' ? 'panel' : undefined, show: false, frame: false, transparent: true, hasShadow: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, title: 'DSH Pet', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: true } })
  const entry = { win, kind, display, dragging: null }
  windows.set(key, entry)
  win.setAlwaysOnTop(true, kind === 'island' && display.notch ? 'screen-saver' : 'floating')
  if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.webContents.on('will-attach-webview', event => event.preventDefault())
  win.webContents.on('render-process-gone', () => exit(1))
  win.on('blur', () => {
    setTimeout(() => {
      if (win.isDestroyed()) return
      if (BrowserWindow.getFocusedWindow() === win) return
      win.webContents.send('pet:collapse')
    }, 50)
  })
  win.on('closed', () => windows.delete(key))
  await win.loadFile(path.join(__dirname, 'renderer.html'))
  if (!win.isDestroyed()) { win.showInactive(); if (kind === 'island') win.setBounds(dimensions(kind, display)) }
  return entry
}
let reconcile = Promise.resolve()
function update(next) {
  if (!next || !next.settings || !Array.isArray(next.pets) || !Array.isArray(next.sessions)) throw new Error('Invalid pet state')
  state = next
  reconcile = reconcile.then(async () => {
    const displays = screen.getAllDisplays().map(withNative)
    const primary = withNative(screen.getPrimaryDisplay())
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
        entry.win.setAlwaysOnTop(true, entry.kind === 'island' && entry.display.notch ? 'screen-saver' : 'floating')
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
ipcMain.on('pet:drag', (event, value) => {
  const entry = entryFor(event)
  const point = screen.getCursorScreenPoint()
  if (value === 'start') { const [x, y] = entry.win.getPosition(); entry.dragging = { dx: point.x - x, dy: point.y - y }; return }
  if (!entry.dragging) return
  // 桌宠可以拖到任意屏幕；灵动岛只属于它自己的屏幕，拖动被夹在该屏幕内，避免拖丢或跨屏重影。
  const area = entry.kind === 'island' ? entry.display.bounds : screen.getDisplayNearestPoint(point).workArea
  const [w, h] = entry.win.getSize()
  const x = Math.round(Math.max(area.x, Math.min(area.x + area.width - w, point.x - entry.dragging.dx)))
  const y = Math.round(Math.max(area.y, Math.min(area.y + area.height - h, point.y - entry.dragging.dy)))
  entry.win.setPosition(x, y)
  if (entry.kind === 'island') layout.islands[String(entry.display.id)] = islandOffset(entry.display, { width: w, height: h }, x, y)
  else petPosition = { x, y }
  if (value === 'end') {
    entry.dragging = null
    saveLayout()
    if (entry.kind === 'pet') request('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'position', x, y }) }).catch(() => {})
  }
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
  nativeScreens = await queryNativeScreens()
  const response = await request('/state')
  await update(await response.json())
  await reconcile
  if (quitting) return
  process.stdout.write('{"type":"ready"}\n')
  hostWatch = setInterval(() => { try { process.kill(config.hostPid, 0) } catch { exit() } }, 2000)
  const displayChanged = () => { clearTimeout(displayTimer); displayTimer = setTimeout(async () => { nativeScreens = await queryNativeScreens(); if (!quitting) update(state) }, 120) }
  screen.on('display-added', displayChanged)
  screen.on('display-removed', displayChanged)
  screen.on('display-metrics-changed', displayChanged)
  if (process.env.DSH_TOOLKIT_PET_SMOKE_DIR) {
    await fs.mkdir(process.env.DSH_TOOLKIT_PET_SMOKE_DIR, { recursive: true })
    await new Promise(resolve => setTimeout(resolve, 1100))
    const report = { displays: screen.getAllDisplays().length, islands: [], independentHover: [] }
    const islands = [...windows.entries()].filter(([, entry]) => entry.kind === 'island')
    async function captureSurface(entry, filename) {
      const rect = await entry.win.webContents.executeJavaScript("(() => { const r = document.getElementById('surface').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) } })()")
      const image = await entry.win.webContents.capturePage(rect)
      await fs.writeFile(path.join(process.env.DSH_TOOLKIT_PET_SMOKE_DIR, filename), image.toPNG())
    }
    for (const [, entry] of islands) {
      await entry.win.webContents.executeJavaScript('document.activeElement?.blur()')
      entry.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 450 })
      entry.win.webContents.sendInputEvent({ type: 'mouseLeave', x: 1, y: 450 })
      entry.win.webContents.send('pet:collapse')
    }
    await new Promise(resolve => setTimeout(resolve, 650))
    for (const [key, entry] of islands) {
      const compact = await entry.win.webContents.capturePage()
      await fs.writeFile(path.join(process.env.DSH_TOOLKIT_PET_SMOKE_DIR, `${key}-compact.png`), compact.toPNG())
      await captureSurface(entry, `${key}-compact-surface.png`)
    }
    for (const [key, entry] of islands) {
      for (const [, other] of islands) {
        other.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 450 })
        other.win.webContents.sendInputEvent({ type: 'mouseLeave', x: 1, y: 450 })
        other.win.webContents.send('pet:collapse')
      }
      await new Promise(resolve => setTimeout(resolve, 200))
      // 精灵表画布与 60 fps 片段图轮流显示，取共同容器 #brand 的中心，避免命中隐藏元素（尺寸为 0）。
      const point = await entry.win.webContents.executeJavaScript("(() => { const r = document.getElementById('brand').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()")
      entry.win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
      await new Promise(resolve => setTimeout(resolve, 450))
      const expanded = await Promise.all(islands.map(async ([id, other]) => ({ key: id, expanded: await other.win.webContents.executeJavaScript("document.body.classList.contains('expanded')") })))
      if (expanded.some(item => item.expanded !== (item.key === key))) throw new Error('Hover expanded the wrong display')
      entry.win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 450 })
      entry.win.webContents.sendInputEvent({ type: 'mouseLeave', x: 1, y: 450 })
      await new Promise(resolve => setTimeout(resolve, 200))
      const collapsed = await Promise.all(islands.map(([, other]) => other.win.webContents.executeJavaScript("!document.body.classList.contains('expanded')")))
      if (collapsed.some(value => !value)) throw new Error('Hover leave did not collapse its display')
      report.independentHover.push({ key, onlySourceExpanded: true, allCollapsedOnLeave: true })
    }
    for (const [key, entry] of windows) {
      if (entry.kind === 'island') {
        entry.win.setIgnoreMouseEvents(false)
        entry.win.show(); entry.win.focus()
        await new Promise(resolve => setTimeout(resolve, 150))
        const visible = await entry.win.webContents.executeJavaScript(`(async () => {
          const cap = document.getElementById('cap')
          if (!document.body.classList.contains('expanded')) cap.click()
          ;(document.querySelector('.session .session-open') || cap).focus()
          await new Promise(resolve => setTimeout(resolve, 750))
          await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().endTime !== Infinity).map(animation => animation.finished.catch(() => {})))
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const body = document.getElementById('activity'), surface = document.getElementById('surface')
          const style = getComputedStyle(body), rect = body.getBoundingClientRect(), bounds = surface.getBoundingClientRect()
          const buttons = [...document.querySelectorAll('.session .session-open')]
          const spriteBounds = document.getElementById('sprite').getBoundingClientRect(), badgeBounds = document.getElementById('badge').getBoundingClientRect()
          const badgeText = document.getElementById('badge-text').textContent
          const film = document.getElementById('film')
          const brand = document.getElementById('brand')
          const brandStyle = getComputedStyle(brand)
          const filmState = {
            hidden: film.hidden,
            src: film.getAttribute('src') || '',
            decoded: film.naturalWidth,
            clip: document.body.toggleAttribute ? document.body.hasAttribute('data-clips') : null,
            motion: document.body.dataset.motion || '',
            animation: brandStyle.animationName,
            bob: brandStyle.getPropertyValue('--bob').trim(),
          }
          const camera = document.getElementById('camera-space').getBoundingClientRect()
          return {
            expanded: document.body.classList.contains('expanded'), opacity: Number(style.opacity), filter: style.filter,
            cameraExcluded: !document.body.classList.contains('notched') || spriteBounds.right <= camera.left && badgeBounds.left >= camera.right && rect.top >= camera.bottom,
            surface: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
            visible: style.visibility === 'visible' && rect.height > 0 && bounds.height > cap.getBoundingClientRect().height + 40,
            sessionCount: document.querySelectorAll('.session').length,
            form: document.body.dataset.form || '',
            rows: document.querySelectorAll('.island-row').length,
            pending: document.body.dataset.pending || '',
            buttonsVisible: buttons.length > 0 && buttons.every(button => { const box = button.getBoundingClientRect(); return box.width > 0 && box.height > 0 && box.bottom <= bounds.bottom && box.top >= bounds.top }),
            noScroll: Boolean(body) && body.scrollHeight <= body.clientHeight + 1 && body.scrollWidth <= body.clientWidth + 1,
            height: bounds.height,
            badgeText,
            film: filmState,
          }
        })()`)
        const clips = (state.pets || []).find(pet => pet.id === state.settings?.activePet)?.manifest?.animations
        if (clips && Object.keys(clips).length) {
          if (visible.film.hidden || !visible.film.decoded) throw new Error(`Island ${key} did not play its 60 fps clips: ${JSON.stringify(visible.film)}`)
          if (visible.film.motion !== 'running' || !visible.film.src.endsWith('/running.webp')) throw new Error(`Island ${key} did not show the active swimming motion: ${JSON.stringify(visible.film)}`)
          // 呼吸位移由 CSS 合成动画负责，跑在屏幕刷新率上；片段里只留姿态。
          if (visible.film.animation !== 'tk-bob' || !visible.film.bob) throw new Error(`Island ${key} does not run the CSS bob: ${JSON.stringify(visible.film)}`)
        }
        if (!visible.expanded || !visible.visible || !visible.cameraExcluded || visible.opacity < .99 || visible.filter !== 'blur(0px)' && visible.filter !== 'none' || !visible.sessionCount || !['list', 'detail'].includes(visible.form) || visible.rows > 3 || !visible.buttonsVisible || !visible.noScroll || !visible.badgeText) throw new Error(`Island ${key} did not visibly expand: ${JSON.stringify(visible)}`)
        report.islands.push({ key, displayId: entry.display.id, screenBounds: entry.display.bounds, workArea: entry.display.workArea, windowBounds: entry.win.getBounds(), notch: entry.display.notch, ...visible })
        await captureSurface(entry, `${key}-surface.png`)
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
