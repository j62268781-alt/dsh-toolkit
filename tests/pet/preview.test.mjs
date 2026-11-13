import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPreviewStore, previewPath } from '../../src/modules/pet/host/preview.ts'

/** 只需要一段带 RIFF/WEBP 魔数的字节：缓存层不解析像素。 */
function webp(bytes = 64) {
  const buffer = Buffer.alloc(bytes)
  buffer.write('RIFF', 0, 'latin1')
  buffer.write('WEBP', 8, 'latin1')
  return buffer
}

function store(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pet-preview-'))
  return { root, previews: createPreviewStore({ root, ...overrides }) }
}

test('a Petdex preview is downloaded once and then served from disk', async () => {
  const { root, previews } = store({ fetchImpl: async (url) => { assert.equal(url, 'https://assets.petdex.dev/pets/boba/preview.webp'); return { ok: true, headers: new Headers(), arrayBuffer: async () => webp() } } })
  const first = await previews.get('boba')
  assert.equal(first.toString('latin1', 0, 4), 'RIFF')
  assert.equal(readFileSync(previewPath(root, 'boba')).length, 64)
  // 第二个 store 模拟插件重启：内存空了，但磁盘还在，不该再下载。
  const again = createPreviewStore({ root, fetchImpl: async () => { throw new Error('must not refetch') } })
  assert.equal((await again.get('boba')).length, 64)
})

test('previews fail closed on unsafe ids, non-webp bodies and oversized downloads', async () => {
  const { root, previews } = store({
    maxBytes: 128,
    fetchImpl: async (url) => {
      if (url.includes('/broken/')) return { ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from('<html>nope</html>') }
      if (url.includes('/huge/')) return { ok: true, headers: new Headers({ 'content-length': '9000' }), arrayBuffer: async () => webp(9000) }
      if (url.includes('/missing/')) return { ok: false, status: 404, headers: new Headers(), arrayBuffer: async () => Buffer.alloc(0) }
      return { ok: true, headers: new Headers(), arrayBuffer: async () => webp() }
    },
  })
  assert.equal(await previews.get('../etc/passwd'), null)
  assert.equal(await previews.get('Boba'), null)
  assert.equal(await previews.get('broken'), null)
  assert.equal(await previews.get('huge'), null)
  assert.equal(await previews.get('missing'), null)
  assert.throws(() => readFileSync(previewPath(root, 'broken')))
  assert.throws(() => readFileSync(previewPath(root, 'huge')))
})

test('preview failures degrade to null instead of failing the settings page', async () => {
  const { previews } = store({ fetchImpl: async () => { throw new Error('offline') } })
  assert.equal(await previews.get('boba'), null)
  const timeout = createPreviewStore({ root: mkdtempSync(join(tmpdir(), 'dsh-pet-preview-')), fetchImpl: async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }) } })
  assert.equal(await timeout.get('boba'), null)
})
