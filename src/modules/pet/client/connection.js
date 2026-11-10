const PREFIX = '/api/plugins/dsh-toolkit/pet'

async function request(path, options = {}) {
  const response = await fetch(`${PREFIX}${path}`, { credentials: 'same-origin', ...options })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const value = await response.json()
  if (value?.ok === false) throw new Error(value.error ?? 'Request rejected')
  return value
}

/** Own one authenticated stream for all settings views and helper navigation. */
export function createPetConnection({ onNavigation, onNavigationError = () => {} } = {}) {
  let snapshot = { pets: [], runtime: { status: 'stopped' }, connected: false, loaded: false }
  const listeners = new Set()
  let disposed = false
  let controller
  let reader
  let timer
  let delay = 1000
  let seeded = false
  let navigationSeq = 0
  const publish = (patch) => {
    if (disposed) return
    snapshot = { ...snapshot, ...patch }
    for (const listener of [...listeners]) listener()
  }
  const accept = (value, navigate = false) => {
    if (!value || typeof value !== 'object' || disposed) return
    const patch = { loaded: true }
    if (Array.isArray(value.pets)) patch.pets = value.pets.filter((pet) => typeof pet?.id === 'string' && typeof pet?.name === 'string')
    if (value.runtime && typeof value.runtime === 'object') patch.runtime = value.runtime
    if (value.settings && typeof value.settings === 'object') patch.settings = value.settings
    publish(patch)
    if (!navigate) return
    const seq = Number(value.navigation?.seq) || 0
    if (!seeded) { seeded = true; navigationSeq = seq; return }
    if (seq <= navigationSeq) return
    navigationSeq = seq
    const id = value.navigation?.sessionId
    if (typeof id === 'string' && id) Promise.resolve().then(() => { if (!disposed) return onNavigation?.(id, () => disposed) }).catch(onNavigationError)
  }
  const refresh = async () => {
    const value = await request('/state')
    accept(value)
    return value
  }
  const action = async (name) => {
    await request('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name }) })
    return refresh()
  }
  // 用户已经看到某个会话（主视图切过去）：告诉 host 标记已读，岛上的提醒随即消失。
  // 失败只丢一条诊断，不阻塞任何界面 —— 下一次活动事件仍会重新算状态。
  const seen = async (sessionId) => {
    await request('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'seen', sessionId }) })
    return refresh()
  }
  // 诊断用：客户端半部的会话能力实况（哪些来源可用），host 只把它挂在私有 /state 上。
  const diag = async (payload) => {
    await request('/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'diag', payload }) })
    return refresh()
  }
  const connect = async () => {
    if (disposed) return
    controller = new AbortController()
    try {
      const response = await fetch(`${PREFIX}/events`, { credentials: 'same-origin', headers: { Accept: 'text/event-stream' }, signal: controller.signal })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      publish({ connected: true })
      delay = 1000
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!disposed) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n')
        let end
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
          if (data) { try { accept(JSON.parse(data), true) } catch {} }
        }
        if (buffer.length > 1024 * 1024) throw new Error('Desktop event frame too large')
      }
    } catch {
      // Reconnect the transport only. Session facts are never polled by this client.
    } finally {
      try { reader?.releaseLock() } catch {}
      reader = undefined
      if (!disposed) {
        publish({ connected: false })
        timer = setTimeout(connect, delay)
        delay = Math.min(30000, delay * 2)
      }
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    refresh, action, seen, diag,
    start() { void connect() },
    dispose() {
      disposed = true
      clearTimeout(timer)
      controller?.abort()
      void reader?.cancel().catch(() => {})
      listeners.clear()
    },
  }
}
