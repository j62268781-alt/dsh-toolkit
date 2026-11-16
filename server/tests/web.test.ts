import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createRemoteServer } from '../src/server.js'

/**
 * The management UI is a Vite build that lands in `dist/public` and is served
 * from memory. These cases pin the contract the bundled front end relies on:
 * SPA fallback for client routes, content types, immutable caching for
 * fingerprinted assets, and the fact that API/health routes never fall back to
 * HTML.
 */

const account = 'owner@example.com'
const password = 'local-test-password'

let app: ReturnType<typeof createRemoteServer>
let dir: string
let webRoot: string
let base: string

async function start(webRootOverride: string | undefined = webRoot) {
  app = createRemoteServer({
    account,
    password,
    dataFile: join(dir, 'state.json'),
    publicUrl: 'http://localhost:8080',
    ...(webRootOverride === undefined ? {} : { webRoot: webRootOverride }),
  })
  app.server.listen(0, '127.0.0.1')
  await once(app.server, 'listening')
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-web-'))
  webRoot = join(dir, 'public')
  mkdirSync(join(webRoot, 'assets'), { recursive: true })
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><body><div id="root"></div></body></html>')
  writeFileSync(join(webRoot, 'assets', 'index-abc123.js'), 'export const ready = true\n')
  writeFileSync(join(webRoot, 'assets', 'index-abc123.css'), '.app-shell{display:flex}\n')
  writeFileSync(join(webRoot, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
})

afterEach(async () => {
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('management web UI', () => {
  it('serves the built index.html for the landing page and client routes', async () => {
    await start()
    for (const path of ['/', '/app/login', '/app/remote', '/app/remote/whatever']) {
      const response = await fetch(`${base}${path}`)
      expect(response.status, path).toBe(200)
      expect(response.headers.get('content-type'), path).toContain('text/html')
      expect(response.headers.get('cache-control'), path).toBe('no-cache')
      expect(await response.text(), path).toContain('<div id="root"></div>')
    }
  })

  it('serves fingerprinted assets with their own content type and immutable caching', async () => {
    await start()
    const script = await fetch(`${base}/assets/index-abc123.js`)
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('text/javascript')
    expect(script.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await script.text()).toContain('ready = true')

    const style = await fetch(`${base}/assets/index-abc123.css`)
    expect(style.headers.get('content-type')).toContain('text/css')

    const icon = await fetch(`${base}/icon.png`)
    expect(icon.status).toBe(200)
    expect(icon.headers.get('content-type')).toBe('image/png')
    expect(icon.headers.get('cache-control')).toBe('no-cache')

    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404)
  })

  it('keeps API and health routes off the SPA fallback', async () => {
    await start()
    const health = await fetch(`${base}/healthz`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok' })

    const unauthenticated = await fetch(`${base}/api/v1/auth/me`)
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('content-type')).toContain('application/json')

    const unknown = await fetch(`${base}/api/v1/definitely-not-a-route`)
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('content-type')).toContain('application/json')
    expect((await unknown.json() as { error?: { code?: string } }).error?.code).toBe('METHOD_NOT_FOUND')
  })

  it('answers plain JSON 404s when no web build is present', async () => {
    await start(join(dir, 'missing-public'))
    const response = await fetch(`${base}/`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect((await response.json() as { error?: { code?: string } }).error?.code).toBe('METHOD_NOT_FOUND')
  })
})
