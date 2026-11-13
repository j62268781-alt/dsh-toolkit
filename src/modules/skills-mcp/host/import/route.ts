/**
 * MCP import scan over HTTP: `POST /<name>/import`.
 *
 * The panel asks "which MCP servers does this tool configure here?" and gets the preview
 * directly in the response. It is a read of other tools' config files — nothing is written —
 * but the file contents can be large, so it is a POST with a JSON body rather than a query
 * string.
 *
 * This used to be `config.importRequest` + `config.importResult`: a request written into the
 * profile patch, a 600 ms Host poll, and the answer written back into the patch. Both are
 * gone; the patch only holds the panel's durable preferences now.
 */
import { NAME } from '../identity.js'
import { readBody, sendJson } from '../../../../host/http.js'
import { registerAuthenticatedRoute } from '../../../../host/routes.js'
import { createSerialQueue } from '../../../../host/serial.js'

export const IMPORT_PATH = `/${NAME}/import`

/** Largest request body accepted, in bytes. */
const MAX_BODY = 16 * 1024

/**
 * Register the import-scan route.
 *
 * `scan` receives an already validated request and returns the preview payload; it never
 * writes anything. Failures are reported as `{ ok: false, error }` in the response, not as a
 * dropped request the panel would wait for forever.
 */
export function registerImportRoute(ctx: any, { schema, scan }: any) {
  const queue = createSerialQueue()

  registerAuthenticatedRoute(ctx, {
    kind: 'exact',
    path: IMPORT_PATH,
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
          send(200, scan(request))
        } catch (error: any) {
          ctx.logger.warn('dsh-skills-mcp-manager: import scan failed: %s', String(error?.message ?? error))
          send(200, { ok: false, files: [], servers: [], error: String(error?.message ?? error) })
        }
      })
    },
  })
}
