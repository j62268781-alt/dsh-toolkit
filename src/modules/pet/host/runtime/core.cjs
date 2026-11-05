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
    sessions: orderedSessions(state.sessions).map(s => ({ id: s.id, title: String(s.title || ''), detail: String(s.detail || ''), status: s.status, running: Boolean(s.running), pendingKind: s.pendingKind })),
    revision: state.revision, kind,
    // Electron has no reliable public notch/safe-area API; do not infer a notch from the menu bar.
    display: { width: display.bounds.width, height: display.bounds.height, notch: false },
  }
}

function islandGeometry(settings = {}, notch = false) {
  const pct = Math.max(75, Math.min(150, Number(settings.islandWidth) || 100))
  const widthFor = expanded => {
    const r = expanded ? (notch ? 412 : 280) : (notch ? 268 : 212)
    const c = notch ? 192 : 0
    const b = expanded ? (notch ? 360 : 212) : (notch ? 256 : 74)
    const i = !expanded && !notch && pct < 100 ? b + (r - b) * (pct - 20) / 80 : Math.max(b, c + (r - c) * pct / 100)
    return Math.round((expanded ? Math.min(r, i) : i) / 2) * 2
  }
  return { compact: widthFor(false), expanded: widthFor(true), height: Math.round(32 * Math.max(75, Math.min(150, Number(settings.islandHeight) || 100)) / 100) }
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

module.exports = { readEnvironment, publicState, orderedSessions, islandGeometry, assetPath, validatedAction, consumeEvents }
