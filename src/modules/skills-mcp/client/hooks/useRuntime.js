import { NAME as NS } from '../../host/identity.js'
import { AUTH_CHANNEL, AUTH_DONE } from '../../host/mcp/oauth/channel.js'
import { startPolling } from '../../../../client/poll.js'
import { fetchJson } from '../../../../client/http.js'

/** Own the runtime projection, polling, and immediate command/OAuth refreshes. */
export function useRuntime(React, tab, expanded) {
  const { useState, useEffect } = React
  const [runtime, setRuntime] = useState({
    serverTools: [], serverStatus: [], serverToolsError: { reason: 'loading', detail: '' },
    servers: [], skills: [], skillDirs: {}, workspaces: [], currentWorkspace: '',
    filter: {}, probe: {}, oauth: { servers: {} }, discovery: {},
  })
  const [refreshPing, setRefreshPing] = useState(0)
  const bumpRefresh = () => setRefreshPing((n) => n + 1)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined
    let channel
    try {
      channel = new BroadcastChannel(AUTH_CHANNEL)
    } catch {
      return undefined
    }
    const onMessage = (event) => {
      if (event?.data === AUTH_DONE) bumpRefresh()
    }
    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
      channel.close()
    }
  }, [])
  useEffect(() => {
    let lastLoadedAt = 0
    const poll = startPolling(async (signal) => {
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      if (hidden && Date.now() - lastLoadedAt < 15000) return
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      try {
        const response = await fetchJson(`/${NS}/runtime`, { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = await response.json()
        if (signal.aborted || controller.signal.aborted) return
        if (!Array.isArray(payload?.serverTools) || !Array.isArray(payload?.serverStatus)
          || typeof payload?.serverToolsError?.reason !== 'string') throw new Error('响应格式无效')
        lastLoadedAt = Date.now()
        setRuntime(payload)
      } catch (error) {
        if (signal.aborted) return
        setRuntime((current) => ({
          ...current,
          serverTools: [], serverStatus: [],
          serverToolsError: { reason: 'runtime-unavailable', detail: String(error?.message ?? error) },
        }))
      } finally {
        signal.removeEventListener('abort', abort)
        clearTimeout(timeout)
      }
    }, { intervalMs: 5000, onError: () => {} })
    const onVisible = () => { void poll.refresh() }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    return () => {
      poll.stop()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    }
  }, [tab, expanded, refreshPing])
  return { runtime, setRuntime, bumpRefresh }
}
