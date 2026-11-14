/**
 * One MCP reconnect command over HTTP: `POST /<name>/reconnect`.
 *
 * ## Why a route instead of a settings field
 *
 * Reconnect used to be `config.reconnectRequest`, drained by the Host on a 500 ms timer.
 * That made a one-shot command into persisted state: it landed in `cordis.patch.yml`, and a
 * restart before the Host cleared it replayed the command. A command belongs in a request,
 * not in the config file — so this route runs it and answers when it is done.
 *
 * The security boundary is the same as `mcp/rows.js`: `connection.requestRejection` first,
 * POST + `application/json` only, body validated by the injected schema, one command at a
 * time. It is a **write** endpoint (it toggles a profile row twice), so it gets the same
 * treatment as the row route.
 */
import { API_PREFIX } from '../identity.js'
import { readBody, sendJson } from '../../../../host/http.js'
import { registerAuthenticatedRoute } from '../../../../host/routes.js'
import { createSerialQueue } from '../../../../host/serial.js'

export const RECONNECT_PATH = `${API_PREFIX}/reconnect`

/** Largest command body accepted, in bytes. */
const MAX_BODY = 8 * 1024

/**
 * Register the reconnect route.
 *
 * `run` is awaited: the response is the outcome (`{ ok, reason }`), so the panel can drop
 * its spinner on the answer instead of waiting for a projection round-trip. A global row can
 * legitimately take a few seconds (disable → wait for the Loader → enable); that time is the
 * command's duration, not a queue delay.
 */
export function registerReconnectRoute(ctx: any, { schema, run }: any) {
  const queue = createSerialQueue()

  registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: RECONNECT_PATH,
    handler: async (req, res) => {
      res.setHeader('cache-control', 'no-store')
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      const type = String(req.headers?.['content-type'] ?? '')
      if (!type.includes('application/json')) {
        res.statusCode = 415
        res.end(JSON.stringify({ ok: false, reason: 'content-type must be application/json' }))
        return
      }

      const send = (status: any, payload: any) => sendJson(res, status, payload)

      let request
      try {
        request = schema(JSON.parse(await readBody(req, MAX_BODY)))
      } catch (error: any) {
        send(400, { ok: false, reason: String(error?.message ?? error) })
        return
      }

      await queue.run(async () => {
        try {
          send(200, await run(request))
        } catch (error: any) {
          ctx.logger.warn('dsh-toolkit-skills-mcp: reconnect command failed: %s', String(error?.message ?? error))
          send(200, { ok: false, reason: String(error?.message ?? error) })
        }
      })
    },
  })
}
