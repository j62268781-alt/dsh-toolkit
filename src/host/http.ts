import type { IncomingMessage, ServerResponse } from 'node:http'

/** Read a UTF-8 request body without accepting more than the route's byte limit. */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

/**
 * Read a UTF-8 request body with a hard limit on decoded characters.
 *
 * `readBody` counts bytes, which is the wrong unit for a JSON body whose limit was
 * chosen in characters: one emoji costs four bytes, so a byte guard rejects bodies
 * the caller was told it could send. The limit has to stay on `raw.length`.
 *
 * An oversized body is never answered: the request is destroyed and `onBody` is not
 * called, because a receipt written after `destroy()` would race the connection the
 * caller is waiting on (and the caller already got a dead socket).
 */
export function readCharBody(req: IncomingMessage, maxChars: number, onBody: (raw: string) => void): void {
  let raw = ''
  let oversized = false
  req.setEncoding('utf8')
  req.on('data', (chunk: string) => {
    raw += chunk
    if (raw.length > maxChars) {
      oversized = true
      req.destroy()
    }
  })
  req.on('end', () => {
    if (oversized) return
    onBody(raw)
  })
}

/** Send the JSON receipt used by the toolkit's command routes. */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}
