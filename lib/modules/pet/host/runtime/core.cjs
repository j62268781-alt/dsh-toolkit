'use strict'
const path = require('node:path')

function readEnvironment(env) {
  const url = new URL(env.DSH_TOOLKIT_PET_URL || '')
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Pet helper requires a loopback HTTP origin')
  if (!env.DSH_TOOLKIT_PET_TOKEN) throw new Error('Missing pet helper token')
  const hostPid = Number(env.DSH_TOOLKIT_HOST_PID)
  if (!Number.isSafeInteger(hostPid) || hostPid < 1) throw new Error('Invalid Host PID')
  return { origin: url.origin, token: env.DSH_TOOLKIT_PET_TOKEN, hostPid }
}

function orderedSessions(sessions = []) {
  const rank = { waiting: 0, running: 1, failed: 2, completed: 3 }
  return sessions.filter(s => s && typeof s.id === 'string').slice().sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || (b.updatedAt || 0) - (a.updatedAt || 0))
}

function publicState(state, kind, display) {
  const settings = state.settings || {}
  return {
    settings: { activePet: settings.activePet, petSize: settings.petSize, bubbleWidth: settings.bubbleWidth, islandWidth: settings.islandWidth, islandHeight: settings.islandHeight, language: settings.language === 'en' ? 'en' : 'zh' },
    pets: (state.pets || []).filter(p => /^[a-z0-9_-]+$/i.test(p.id)).map(p => ({ id: p.id, name: p.name, spriteVersionNumber: p.manifest?.spriteVersionNumber === 2 ? 2 : 1, spritesheet: `pet-asset://pet/${encodeURIComponent(p.id)}/spritesheet.png` })),
    // updatedAt 只用于展开态的「刚刚 / N 分钟前」，不是绝对时间戳：渲染端只读差值。
    sessions: orderedSessions(state.sessions).map(s => ({ id: s.id, title: String(s.title || ''), detail: String(s.detail || ''), status: s.status, running: Boolean(s.running), updatedAt: Number(s.updatedAt) || 0, pendingKind: s.pendingKind })),
    revision: state.revision, kind,
    display: { id: display.id, width: display.bounds.width, height: display.bounds.height, notch: display.notch || null, island: islandGeometry(settings, display.notch, display.bounds) },
  }
}

function islandGeometry(settings = {}, notch = null, bounds = null) {
  const scale = Math.max(75, Math.min(150, Number(settings.islandWidth) || 100)) / 100
  const notched = notch && typeof notch === 'object' && notch.width > 0
  // 收起态按 Qoder 的量宽区间留出上限：侧栏内容决定实际宽度，这里只给封顶值。
  const compact = notched ? Math.max(360, Math.round(notch.width + 112 * scale)) : Math.min(360, Math.round(280 * scale))
  // 展开态按 Qoder 的面板宽度（刘海屏 590 / 普通屏 552）：收起态那点宽度装不下内容，
  // 内容会贴着可见面板边缘，徽标在刘海屏上还会压到摄像头区域。屏幕太窄时按屏宽封顶。
  const wanted = notched ? 590 : 552
  const limit = Number.isFinite(bounds?.width) && bounds.width > 0 ? Math.max(320, bounds.width - 120) : wanted
  const expanded = Math.round(Math.max(compact, Math.min(wanted, limit)))
  const height = Math.max(notched ? notch.height + 4 : 0, Math.round(38 * Math.max(75, Math.min(150, Number(settings.islandHeight) || 100)) / 100))
  return { compact, expanded, height }
}

function islandAnchor(display, width) {
  const bounds = display.bounds
  const notch = display.notch && display.notch.width > 0 ? display.notch : null
  const center = notch ? bounds.x + notch.x + notch.width / 2 : bounds.x + bounds.width / 2
  return { x: Math.round(center - width / 2), y: notch ? bounds.y : display.workArea.y + 6 }
}

function islandPlacement(display, size, offset) {
  const anchor = islandAnchor(display, size.width)
  const dx = Number.isFinite(offset?.dx) ? Math.round(offset.dx) : 0
  const dy = Number.isFinite(offset?.dy) ? Math.round(offset.dy) : 0
  const bounds = display.bounds
  return {
    x: Math.round(Math.max(bounds.x, Math.min(bounds.x + bounds.width - size.width, anchor.x + dx))),
    y: Math.round(Math.max(bounds.y, Math.min(bounds.y + bounds.height - size.height, anchor.y + dy))),
  }
}

function islandOffset(display, size, x, y) {
  const anchor = islandAnchor(display, size.width)
  return { dx: Math.round(x - anchor.x), dy: Math.round(y - anchor.y) }
}

function assetPath(state, rawUrl) {
  const url = new URL(rawUrl)
  if (url.protocol !== 'pet-asset:' || url.hostname !== 'pet') return null
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (segments.length !== 2 || segments[1] !== 'spritesheet.png') return null
  const pet = (state.pets || []).find(p => p.id === segments[0])
  if (!pet || !path.isAbsolute(pet.assetDir || '')) return null
  return path.join(pet.assetDir, 'spritesheet.png')
}

function validatedAction(value) {
  if (!value || !['open', 'cancel', 'prompt', 'position'].includes(value.action)) throw new Error('Invalid pet action')
  const result = { action: value.action }
  if (typeof value.sessionId === 'string' && value.sessionId.length <= 256) result.sessionId = value.sessionId
  if (value.action === 'prompt') {
    if (!result.sessionId || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000) throw new Error('Invalid prompt')
    result.text = value.text.trim()
  }
  if (value.action === 'cancel' && !result.sessionId) throw new Error('Missing session')
  if (value.action === 'position') {
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error('Invalid position')
    result.x = Math.round(value.x); result.y = Math.round(value.y)
  }
  return result
}

async function consumeEvents(body, onState, signal) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > 2 * 1024 * 1024) throw new Error('Pet state event too large')
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, '')
        buffer = buffer.slice(end + 1)
        if (line.startsWith('data:')) onState(JSON.parse(line.slice(5).trim()))
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

module.exports = { readEnvironment, publicState, orderedSessions, islandGeometry, islandAnchor, islandPlacement, islandOffset, assetPath, validatedAction, consumeEvents }
