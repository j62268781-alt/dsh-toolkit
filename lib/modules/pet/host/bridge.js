import { createServer } from 'node:http'
import { timingSafeEqual, randomBytes } from 'node:crypto'
import { readBody, sendJson } from '../../../host/http.js'

export function attachEvents(req, res, listeners, snapshot) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' })
  const send = () => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(snapshot())}\n\n`) }
  listeners.add(send)
  send()
  const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n') }, 15000)
  heartbeat.unref?.()
  const close = () => { clearInterval(heartbeat); listeners.delete(send) }
  res.on('close', close)
  return () => { close(); res.end() }
}

export async function parseAction(req) {
  const value = JSON.parse(await readBody(req, 20 * 1024))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid pet action')
  const action = value.action
  if (!['prepare', 'retry', 'start', 'open', 'seen', 'diag', 'cancel', 'prompt', 'position', 'catalog', 'install', 'remove'].includes(action)) throw new Error('Unknown pet action')
  if (['install', 'remove'].includes(action) && (typeof value.slug !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.slug))) throw new Error('Invalid pet package id')
  if (action === 'catalog' && value.query !== undefined && (typeof value.query !== 'string' || value.query.length > 64)) throw new Error('Invalid pet search query')
  if (['open', 'seen', 'cancel', 'prompt'].includes(action) && (typeof value.sessionId !== 'string' || value.sessionId.length < 1 || value.sessionId.length > 256)) throw new Error('A session is required')
  if (action === 'prompt' && (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000)) throw new Error('Reply must contain 1–8000 characters')
  if (action === 'position' && (!Number.isFinite(value.x) || !Number.isFinite(value.y))) throw new Error('Invalid pet position')
  return value
}

/** Private loopback server: capability never enters the page or public API. */
export async function createHelperBridge(snapshot, action) {
  const token = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${token}`)
  const listeners = new Set()
  const responses = new Set()
  let requests = 0
  const server = createServer(async (req, res) => {
    const actual = Buffer.from(String(req.headers.authorization || ''))
    if (req.headers.origin || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return sendJson(res, 403, { error: 'Forbidden' })
    const route = new URL(req.url || '/', 'http://127.0.0.1').pathname
    try {
      if (req.method === 'GET' && route === '/state') {
        const state = snapshot()
        return sendJson(res, 200, { ...state, streams: responses.size, requests: requests })
      }
      if (req.method === 'GET' && route === '/events') {
        if (responses.size >= 4) return sendJson(res, 429, { error: 'Too many event streams' })
        responses.add(res); res.on('close', () => responses.delete(res))
        attachEvents(req, res, listeners, snapshot)
        return
      }
      if (req.method === 'POST' && route === '/action') {
        requests += 1
        return sendJson(res, 200, await action(await parseAction(req)))
      }
      sendJson(res, 404, { error: 'Not found' })
    } catch (error) { sendJson(res, 400, { error: error.message }) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return {
    url: `http://127.0.0.1:${server.address().port}`, token,
    publish() { for (const send of listeners) send() },
    async dispose() {
      for (const res of responses) res.end()
      server.closeIdleConnections?.()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
