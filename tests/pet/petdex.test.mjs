import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCatalog, filterCatalog, installPet, isSlug, listInstalled, parseImageSize, parseManifest, removePet, resolveAssetUrl, validatePetJson } from '../../src/modules/pet/host/petdex.js'

const png = (width, height) => {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'latin1')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}
const webp = (width, height) => {
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0, 'latin1')
  bytes.writeUInt32LE(22, 4)
  bytes.write('WEBP', 8, 'latin1')
  bytes.write('VP8X', 12, 'latin1')
  bytes.writeUInt32LE(10, 16)
  const write24 = (value, offset) => { bytes[offset] = value & 0xff; bytes[offset + 1] = (value >> 8) & 0xff; bytes[offset + 2] = (value >> 16) & 0xff }
  write24(width - 1, 24)
  write24(height - 1, 27)
  return bytes
}
const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => (String(name).toLowerCase() === 'content-length' ? String(body?.length ?? 0) : null) },
  async json() { return JSON.parse(body.toString('utf8')) },
  async arrayBuffer() { return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) },
})
const petJson = (slug, extra = {}) => Buffer.from(JSON.stringify({ id: slug, displayName: 'Boba', description: 'A test pet', spritesheetPath: 'spritesheet.webp', ...extra }))

test('image sizes come from the header only', () => {
  assert.deepEqual(parseImageSize(png(1536, 1872)), { format: 'png', width: 1536, height: 1872 })
  assert.deepEqual(parseImageSize(webp(1536, 2288)), { format: 'webp', width: 1536, height: 2288 })
  assert.equal(parseImageSize(Buffer.from('not an image')), null)
  assert.equal(parseImageSize(null), null)
})

test('pet.json validation rejects unsafe or incomplete packages', () => {
  assert.equal(validatePetJson({ id: 'boba', displayName: 'Boba', spritesheetPath: 'spritesheet.webp' }, 'boba').ok, true)
  assert.equal(validatePetJson({ id: 'boba', displayName: 'Boba', spritesheetPath: 'spritesheet.webp', spriteVersionNumber: 2 }, 'boba').manifest.spriteVersionNumber, 2)
  // Petdex 里「同图不同名」的包：id 与目录名不同也能用，身份是目录名。
  assert.equal(validatePetJson({ id: 'other', displayName: 'Boba', spritesheetPath: 'spritesheet.webp' }, 'boba').ok, true, 'the folder name wins as the pet identity')
  assert.equal(validatePetJson({ id: 'other', displayName: 'Boba', spritesheetPath: 'spritesheet.webp' }, 'boba').manifest.id, 'boba')
  assert.equal(validatePetJson({ id: 'Not A Slug', displayName: 'Boba', spritesheetPath: 'spritesheet.webp' }, 'boba').ok, false, 'the id still has to look like a slug')
  assert.equal(validatePetJson({ displayName: 'Boba', spritesheetPath: 'spritesheet.webp' }, 'boba').ok, true, 'a missing id is fine too')
  assert.equal(validatePetJson({ id: 'boba', displayName: '   ', spritesheetPath: 'spritesheet.webp' }, 'boba').ok, false)
  assert.equal(validatePetJson({ id: 'boba', displayName: 'Boba', spritesheetPath: '../secret.png' }, 'boba').ok, false)
  assert.equal(validatePetJson({ id: 'boba', displayName: 'Boba', spritesheetPath: 'spritesheet.jpg' }, 'boba').ok, false)
  assert.equal(validatePetJson({ id: 'boba', displayName: 'Boba', spritesheetPath: 'spritesheet.png', spriteVersionNumber: 3 }, 'boba').ok, false)
  assert.equal(validatePetJson(null, 'boba').ok, false)
})

test('catalog parsing tolerates both manifest shapes and garbage', () => {
  const v2 = parseManifest({ v: 2, assetBase: 'https://assets.petdex.dev', fields: ['slug', 'displayName', 'kind', 'submittedBy', 'spritesheet', 'petJson', 'zip', 'spriteVersionNumber'], pets: [['boba', 'Boba', 'pixel', 'me', 'spritesheet.webp', 'pet.json', null, 2], ['bad slug', 'X', '', '', '', '', null, null]] })
  assert.equal(v2.total, 1)
  assert.deepEqual(v2.pets[0], { slug: 'boba', displayName: 'Boba', spritesheet: 'spritesheet.webp', petJson: 'pet.json', spriteVersionNumber: 2 })
  assert.equal(v2.assetBase, 'https://assets.petdex.dev')
  const legacy = parseManifest({ pets: [{ slug: 'boba', displayName: 'Boba', spritesheet: 'spritesheet.png', petJson: 'pet.json' }] })
  assert.deepEqual(legacy.pets.map((pet) => [pet.slug, pet.spriteVersionNumber]), [['boba', 1]])
  assert.deepEqual(parseManifest(undefined).pets, [])
  assert.deepEqual(parseManifest({ pets: 'nope' }).pets, [])
})

test('asset urls stay on the catalog origin', () => {
  assert.equal(resolveAssetUrl('https://assets.petdex.dev', '/pets/boba/spritesheet.webp'), 'https://assets.petdex.dev/pets/boba/spritesheet.webp')
  assert.equal(resolveAssetUrl('https://assets.petdex.dev', 'spritesheet.webp'), 'https://assets.petdex.dev/spritesheet.webp')
  for (const bad of ['../secret', 'http://assets.petdex.dev/x.webp', 'https://evil.test/x.webp', '', null]) assert.equal(resolveAssetUrl('https://assets.petdex.dev', bad), null)
  assert.equal(resolveAssetUrl('http://insecure.test', 'x.webp'), null)
})

test('slug rule matches Qoder pet ids', () => {
  for (const good of ['boba', 'a', 'k-9.pet_1']) assert.equal(isSlug(good), true)
  for (const bad of ['', 'Boba', '-boba', 'a'.repeat(200), '../boba', 'boba/x']) assert.equal(isSlug(bad), false)
})

test('catalog falls back and caches, and fails loudly when both endpoints are down', async () => {
  const calls = []
  const ok = createCatalog({
    fetchImpl: async (url) => { calls.push(url); return reply(Buffer.from(JSON.stringify({ assetBase: 'https://assets.petdex.dev', pets: [{ slug: 'boba', displayName: 'Boba', spritesheet: 'spritesheet.webp', petJson: 'pet.json' }] }))) },
  })
  const first = await ok.list()
  const second = await ok.list()
  assert.equal(first.pets[0].slug, 'boba')
  assert.equal(second, first)
  assert.deepEqual(calls, ['https://petdex.dev/api/manifest/v2'])
  await ok.list({ force: true })
  assert.equal(calls.length, 2)

  const fallback = createCatalog({
    fetchImpl: async (url) => url.endsWith('/v2')
      ? reply(Buffer.from('{}'), 500)
      : reply(Buffer.from(JSON.stringify({ pets: [{ slug: 'boba', displayName: 'Boba', spritesheet: 'spritesheet.webp', petJson: 'pet.json' }] }))),
  })
  assert.equal((await fallback.list()).pets[0].slug, 'boba')
  await assert.rejects(() => createCatalog({ fetchImpl: async () => reply(Buffer.from('nope'), 503) }).list(), /Petdex catalog unavailable/)
})

test('install writes a package atomically and rejects bad downloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'petdex-'))
  const urls = {
    'https://petdex.dev/pets/boba/pet.json': reply(petJson('boba')),
    'https://petdex.dev/pets/boba/spritesheet.webp': reply(webp(1536, 1872)),
  }
  const fetchImpl = async (url) => urls[url] ?? reply(Buffer.from('missing'), 404)
  const installed = await installPet({ slug: 'boba', petUrl: 'https://petdex.dev/pets/boba/pet.json', sheetUrl: 'https://petdex.dev/pets/boba/spritesheet.webp', root, fetchImpl })
  assert.equal(installed.ok, true)
  assert.deepEqual(await readdir(join(root, 'boba')), ['pet.json', 'spritesheet.webp'])
  assert.equal(JSON.parse(await readFile(join(root, 'boba', 'pet.json'), 'utf8')).displayName, 'Boba')

  // 同名再装一次会原子替换，而不是叠加出第二份。
  urls['https://petdex.dev/pets/boba/pet.json'] = reply(petJson('boba', { displayName: 'Boba v2' }))
  const again = await installPet({ slug: 'boba', petUrl: 'https://petdex.dev/pets/boba/pet.json', sheetUrl: 'https://petdex.dev/pets/boba/spritesheet.webp', root, fetchImpl })
  assert.equal(again.ok, true)
  assert.equal(JSON.parse(await readFile(join(root, 'boba', 'pet.json'), 'utf8')).displayName, 'Boba v2')

  const failed = [
    { url: 'https://petdex.dev/pets/gone/pet.json', sheet: 'https://petdex.dev/pets/gone/spritesheet.webp' },
  ]
  for (const item of failed) {
    const result = await installPet({ slug: 'gone', petUrl: item.url, sheetUrl: item.sheet, root, fetchImpl })
    assert.equal(result.ok, false)
    assert.ok(result.reason.includes('404'))
  }
  assert.equal((await installPet({ slug: 'boba', petUrl: 'https://petdex.dev/pets/boba/pet.json', sheetUrl: 'https://petdex.dev/pets/boba/spritesheet.webp', root, fetchImpl, maxSheetBytes: 4 })).ok, false)
  const wrongSize = await installPet({ slug: 'boba', petUrl: 'https://petdex.dev/pets/boba/pet.json', sheetUrl: 'https://petdex.dev/pets/boba/spritesheet.webp', root, fetchImpl: async (url) => url.endsWith('.webp') ? reply(png(1536, 100)) : reply(petJson('boba')) })
  assert.equal(wrongSize.ok, false)
  assert.ok(wrongSize.reason.includes('expected 1536x1872'))
  const badJson = await installPet({ slug: 'boba', petUrl: 'https://petdex.dev/pets/boba/pet.json', sheetUrl: 'https://petdex.dev/pets/boba/spritesheet.webp', root, fetchImpl: async (url) => url.endsWith('pet.json') ? reply(Buffer.from('{')) : reply(webp(1536, 1872)) })
  assert.equal(badJson.ok, false)
  assert.ok(badJson.reason.includes('not valid JSON'))
  // 失败不留半成品，也不留临时目录。
  assert.deepEqual((await readdir(root)).sort(), ['boba'])
})

test('catalog filters split installed from missing and fall back to everything', () => {
  const pets = [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }]
  const installed = new Set(['b'])
  assert.deepEqual(filterCatalog(pets, installed, 'all').map(({ slug }) => slug), ['a', 'b', 'c'])
  assert.deepEqual(filterCatalog(pets, installed, 'installed').map(({ slug }) => slug), ['b'])
  assert.deepEqual(filterCatalog(pets, installed, 'missing').map(({ slug }) => slug), ['a', 'c'])
  assert.deepEqual(filterCatalog(pets, installed, 'garbage').map(({ slug }) => slug), ['a', 'b', 'c'], 'an unknown filter degrades to all')
})

test('install streams the sheet and reports download progress', async () => {
  const root = await mkdtemp(join(tmpdir(), 'petdex-progress-'))
  const sheet = webp(1536, 1872)
  const seen = []
  const fetchImpl = async (url) => {
    if (url.endsWith('pet.json')) return reply(petJson('boba'))
    // 分两块吐出，模拟真实下载：进度回调应当先到 50%，最后到 100%。
    return {
      ok: true,
      headers: { get: (name) => (String(name).toLowerCase() === 'content-length' ? String(sheet.length) : null) },
      body: new ReadableStream({
        start(controller) {
          const half = Math.floor(sheet.length / 2)
          controller.enqueue(sheet.subarray(0, half))
          controller.enqueue(sheet.subarray(half))
          controller.close()
        },
      }),
    }
  }
  const result = await installPet({
    slug: 'boba',
    petUrl: 'https://petdex.dev/pets/boba/pet.json',
    sheetUrl: 'https://petdex.dev/pets/boba/spritesheet.webp',
    root,
    fetchImpl,
    onProgress: (value) => seen.push(value),
  })
  assert.equal(result.ok, true)
  const percents = seen.map(({ percent }) => percent)
  assert.equal(percents.at(-1), 100, 'the last report closes the bar')
  assert.ok(percents.every((value, index) => index === 0 || value >= percents[index - 1]), 'progress never goes backwards')
  assert.ok(seen.some(({ phase, percent }) => phase === 'download' && percent === 50), 'the sheet download reports half way from content-length')
  assert.ok(seen.every(({ slug }) => slug === 'boba'))
})

test('installed pets are listed and bad folders are reported, not fatal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'petdex-'))
  const fetchImpl = async (url) => url.endsWith('pet.json') ? reply(petJson('boba')) : reply(webp(1536, 1872))
  await installPet({ slug: 'boba', petUrl: 'https://petdex.dev/pets/boba/pet.json', sheetUrl: 'https://petdex.dev/pets/boba/spritesheet.webp', root, fetchImpl })
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(join(root, 'broken'))
  await writeFile(join(root, 'broken', 'pet.json'), '{"id":"broken"}')
  await writeFile(join(root, 'not-a-folder.txt'), 'x')
  const listing = await listInstalled(root)
  assert.deepEqual(listing.pets.map((pet) => [pet.slug, pet.sheetFile, pet.manifest.spriteVersionNumber]), [['boba', 'spritesheet.webp', 1]])
  assert.deepEqual(listing.skipped.map((item) => item.slug), ['broken'])
  assert.deepEqual(await listInstalled(join(root, 'missing')), { pets: [], skipped: [] })
})

test('removing a pet refuses unsafe ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'petdex-'))
  const fetchImpl = async (url) => url.endsWith('pet.json') ? reply(petJson('boba')) : reply(webp(1536, 1872))
  await installPet({ slug: 'boba', petUrl: 'https://petdex.dev/pets/boba/pet.json', sheetUrl: 'https://petdex.dev/pets/boba/spritesheet.webp', root, fetchImpl })
  assert.equal(await removePet(root, '../boba'), false)
  assert.equal(await removePet(root, 'boba'), true)
  assert.deepEqual(await readdir(root), [])
  assert.equal(await removePet(root, 'boba'), false)
})
