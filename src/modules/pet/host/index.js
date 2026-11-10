import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { sendJson } from '../../../host/http.js'
import { registerAuthenticatedRoute } from '../../../host/routes.js'
import { readSettings } from './config.js'
import { createHelperBridge, attachEvents, parseAction } from './bridge.js'
import { HelperManager } from './helper.js'
import { createActivityFeed } from './activity.js'

export const name = 'toolkit-pet'
export const inject = ['webServer', 'connection', 'sessionController', 'sessionProjections', 'sessions', 'settings']
export const API_PATH = '/api/plugins/dsh-toolkit/pet'
const PET_IDS = ['qoduck-lab', 'kleidis-lab', 'neon-cat', 'retro-duck']

// 「已经看过的会话」落盘：否则重启后半小时内已读的结果又会被当成「有新结果」弹出来。
function seenFile() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'toolkit', 'pet', 'seen.json')
}

async function loadSeen() {
  try {
    const data = JSON.parse(await readFile(seenFile(), 'utf8'))
    const entries = Object.entries(data).filter(([id, at]) => typeof id === 'string' && Number.isFinite(at)).slice(-200)
    return new Map(entries)
  } catch {
    return new Map()
  }
}

async function loadPets() {
  return Promise.all(PET_IDS.map(async (id) => {
    const assetDir = fileURLToPath(new URL(`./runtime/pets/${id}/`, import.meta.url))
    const manifest = JSON.parse(await readFile(new URL(`./runtime/pets/${id}/pet.json`, import.meta.url), 'utf8'))
    return { id, name: manifest.displayName || id, assetDir, manifest }
  }))
}

export async function createPetService(ctx, initialConfig = {}) {
  let config = initialConfig
  let settings = readSettings(config)
  let disposed = false
  let navigation = { seq: 0, sessionId: null }
  const listeners = new Set()
  const publicResponses = new Set()
  const seen = await loadSeen()
  let seenWrite = Promise.resolve()
  const persistSeen = (sessionId, at) => {
    seen.set(sessionId, at)
    const snapshot = JSON.stringify(Object.fromEntries(seen))
    seenWrite = seenWrite
      .then(() => mkdir(join(seenFile(), '..'), { recursive: true }))
      .then(() => writeFile(seenFile(), snapshot, 'utf8'))
      .catch(() => {})
  }
  const pets = await loadPets()
  let manager, feed, bridge
  let clientDiag
  const snapshot = (privateState = false) => ({
    ok: true, settings,
    pets: privateState ? pets : pets.map(({ id, name }) => ({ id, name })),
    runtime: manager?.state || { status: 'stopped', available: false },
    sessions: feed?.snapshot() || [], navigation,
    ...(privateState && clientDiag ? { client: clientDiag } : {}),
  })
  const publish = () => {
    if (disposed) return
    for (const send of listeners) send()
    bridge?.publish()
  }
  const action = async (input) => {
    if (disposed) throw new Error('Desktop pet has stopped')
    if (['prepare', 'retry', 'start'].includes(input.action)) {
      // Preparation runs independently so a large first download never holds an HTTP request open.
      if (input.action === 'prepare') void manager.prepare(config, manager.enabled)
      else void manager.retry(config)
      return { ok: true }
    }
    if (input.action === 'position') return { ok: true }
    if (input.action === 'diag') {
      // 客户端半部自报「会话来源是否可用」；只进私有 /state，不进公开 API，也不落盘。
      clientDiag = input.payload && typeof input.payload === 'object' ? input.payload : {}
      if (clientDiag.probe === 'states') {
        // 诊断用：直接回读每个会话的宿主状态，用来确认 active/running 的真实语义。
        const { items } = await ctx.sessionController.list({})
        const controller = new AbortController()
        const states = []
        for (const item of items) {
          if (!item.running) continue
          if (states.length >= 8) break
          try {
            const state = await ctx.sessionController.state({ sessionId: item.sessionId }, controller.signal)
            states.push({ id: item.sessionId, updatedAt: item.updatedAt, summaryRunning: item.running, active: state?.active, running: state?.running, queue: state?.queue?.length, pending: state?.pendingInput })
          } catch (error) {
            states.push({ id: item.sessionId, error: String(error && error.message || error) })
          }
        }
        return { ok: true, runningSummary: items.filter((item) => item.running).length, total: items.length, states }
      }
      return { ok: true }
    }
    const sessionId = input.sessionId
    if (input.action === 'seen') {
      // 主视图已经切到这个会话（通知点击、侧栏切换、或岛自己点开）：立刻当作已读，
      // 灵动岛的徽标与列表马上刷新，不必等下一次会话活动事件。不校验是否存在 ——
      // 用户刚看过的会话可能已被归档/移除，标记已读依然无害。
      feed?.markSeen(sessionId)
      publish()
      return { ok: true }
    }
    const { items } = await ctx.sessionController.list({})
    if (!items.some((session) => session.sessionId === sessionId)) throw new Error('Session no longer exists')
    if (input.action === 'open') {
      navigation = { seq: navigation.seq + 1, sessionId }
      // 点开即视为「看过了」：灵动岛上的「有新结果 / 需要你处理」立刻消失。
      feed?.markSeen(sessionId)
      publish()
      // The web client selects the session; Desktop's supported URI brings its main window forward.
      if (process.platform === 'darwin') {
        const { spawn } = await import('node:child_process')
        const child = spawn('/usr/bin/open', ['dsh://open'], { stdio: 'ignore' })
        child.on('error', () => {})
        child.unref()
      }
      return { ok: true }
    }
    if (input.action === 'cancel') await ctx.sessionController.cancel({ sessionId })
    else if (input.action === 'prompt') await ctx.sessionController.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text: input.text.trim() }] })
    else throw new Error('Unknown pet action')
    return { ok: true }
  }
  bridge = await createHelperBridge(() => snapshot(true), action)
  manager = new HelperManager({ onChange: publish, bridge })
  try {
    feed = createActivityFeed(ctx, publish, { seen, onSeen: persistSeen })
    await feed.ready
  } catch (error) {
    feed?.dispose()
    await manager.dispose()
    await bridge.dispose()
    throw error
  }
  const configure = async (next) => {
    config = next || {}
    settings = readSettings(config)
    if (!pets.some((pet) => pet.id === settings.activePet)) settings = { ...settings, activePet: pets[0].id }
    publish()
    await manager.configure(config, settings)
  }
  const updateConfig = async (ns) => {
    if (disposed) return
    const standalone = ns === 'dsh-toolkit-pet'
    const legacy = ['dsh-toolkit', 'shell-kit', 'dsh-shell-kit'].includes(ns)
    if (!standalone && !legacy) return
    const descriptors = await ctx.settings.describe({ redactSecrets: false })
    if (disposed) return
    const descriptor = descriptors.find((item) => item.ns === ns)
    if (descriptor) await configure(standalone ? descriptor.value : descriptor.value?.pet)
  }
  const unlisten = ctx.on('settings/document-updated', updateConfig, { global: true })
  void configure(config)
  return {
    snapshot, action,
    attach(req, res) {
      publicResponses.add(res)
      res.on('close', () => publicResponses.delete(res))
      return attachEvents(req, res, listeners, snapshot)
    },
    async dispose() {
      disposed = true
      if (typeof unlisten === 'function') unlisten()
      feed.dispose()
      await manager.dispose()
      for (const res of publicResponses) res.end()
      listeners.clear()
      await bridge.dispose()
    },
  }
}

export function apply(ctx, config) {
  ctx.effect(async () => {
    const service = await createPetService(ctx, config)
    let active = true
    try {
      for (const [suffix, method] of [['state', 'GET'], ['events', 'GET'], ['action', 'POST']]) {
        registerAuthenticatedRoute(ctx, {
          kind: 'exact', path: `${API_PATH}/${suffix}`,
          async handler(req, res) {
            res.setHeader('cache-control', 'no-store')
            if (!active || req.method !== method) return sendJson(res, 404, { ok: false, reason: 'not-found' })
            try {
              if (suffix === 'state') return sendJson(res, 200, service.snapshot())
              if (suffix === 'events') return service.attach(req, res)
              return sendJson(res, 200, await service.action(await parseAction(req)))
            } catch (error) { sendJson(res, 400, { ok: false, error: error.message }) }
          },
        })
      }
    } catch (error) {
      active = false
      await service.dispose()
      throw error
    }
    return async () => { active = false; await service.dispose() }
  }, 'desktop pet service')
}

export default { name, inject, apply }
