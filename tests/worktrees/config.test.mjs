import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { registerWorktreeConfigRoutes } from '../../src/modules/worktrees/host/routes/worktree-config.js'
import { isWorktreeConfigUpdate, readWorktreeConfig, updateWorktreeConfig } from '../../src/modules/worktrees/host/worktree/config.js'

const defaults = { directory: '.agents/worktrees', namePrefix: 'dsh-' }
const moduleName = '@deepseek-ai/dsh-experimental-worktree'

function fakeEditor(initial = {}) {
  let raw = initial
  let editCalls = 0
  const resolveConfig = config => ({ ...defaults, ...config,
    ...(config.directory?.__jsExpr === 'pool' ? { directory: 'interpolated/pool' } : {}),
  })
  const entry = {
    options: { id: 'worktree', name: moduleName },
    fiber: { state: 2, get effectiveConfig() { return resolveConfig(raw) }, resolveConfig },
  }
  return {
    entry,
    get raw() { return raw },
    set raw(next) { raw = next },
    get editCalls() { return editCalls },
    entries() { return [entry, { ...entry, options: { id: 'forge-panel', name: 'forge' } }] },
    async edit(target, change) {
      editCalls++
      assert.equal(target, entry)
      raw = change(raw, {})
    },
  }
}

function setup(editor) {
  const path = '/worktree-config'
  let route
  let lookups = 0
  registerWorktreeConfigRoutes({
    get(name) { assert.equal(name, 'configEditor'); lookups++; return editor },
    webServer: { register(value) { assert.equal(route, undefined); route = value } },
    connection: { admit() {} },
    effect(fn) { fn() },
  }, path)
  assert.equal(route.path, path)
  assert.equal(route.auth, 'required')
  const owner = { principal: { kind: 'owner' }, signal: new AbortController().signal }
  return {
    get lookups() { return lookups },
    async request(method, body, peer = owner) {
      let consumed = false
      const req = Readable.from(function* () { consumed = true; yield JSON.stringify(body) }())
      req.method = method
      return new Promise(resolve => route.handler(req, {
        setHeader() {},
        end(body) { resolve({ status: this.statusCode, body: body === undefined ? undefined : JSON.parse(body), consumed }) },
      }, peer))
    },
  }
}

const isFailure = (status, reason) => error => error.status === status && error.reason === reason

test('native directory/prefix validation preserves empty/slashed prefixes without allowing traversal', () => {
  for (const namePrefix of ['', 'team/', '团队/feat-']) {
    assert.equal(isWorktreeConfigUpdate({ expected: defaults, directory: '.agents/中文', namePrefix }), true)
  }
  for (const directory of ['', 'a/', '/a', 'a//b', './a', 'a/../b', 'C:/a', 'a\\b', 'a\0b']) {
    assert.equal(isWorktreeConfigUpdate({ ...defaults, expected: defaults, directory }), false)
  }
  for (const namePrefix of ['-x', '/x', 'a//', '../x', 'a/./x', 'a:b', 'a\\b']) {
    assert.equal(isWorktreeConfigUpdate({ ...defaults, expected: defaults, namePrefix }), false)
  }
  assert.equal(isWorktreeConfigUpdate({ ...defaults, expected: { ...defaults, directory: false } }), false)
})

test('reads resolved native config and preserves raw untouched fields and non-native targets', async () => {
  const raw = { directory: { __jsExpr: 'pool' }, retainOnArchive: true, maxOutputBytes: 42 }
  const editor = fakeEditor(raw)
  const expected = { directory: 'interpolated/pool', namePrefix: 'dsh-' }
  assert.deepEqual(readWorktreeConfig(editor), expected)
  assert.deepEqual(await updateWorktreeConfig(editor, { ...expected, expected }), expected)
  assert.equal(editor.raw, raw)
  const result = await updateWorktreeConfig(editor, { ...expected, namePrefix: 'team/', expected, retainOnArchive: false })
  assert.deepEqual(result, { directory: 'interpolated/pool', namePrefix: 'team/' })
  assert.deepEqual(editor.raw, { ...raw, namePrefix: 'team/' })
})

test('refuses stale values reloaded by ConfigEditor before entering the change callback', async () => {
  const editor = fakeEditor()
  const edit = editor.edit.bind(editor)
  editor.edit = async (...args) => {
    editor.raw = { directory: 'other/pool', retainOnArchive: true }
    return edit(...args)
  }
  await assert.rejects(updateWorktreeConfig(editor, { ...defaults, namePrefix: 'mine-', expected: defaults }),
    isFailure(409, 'worktree-config-conflict'))
  assert.deepEqual(editor.raw, { directory: 'other/pool', retainOnArchive: true })
})

test('refuses unavailable entries and sanitizes host config editor errors', async () => {
  const editor = fakeEditor({ gitCommand: 'private/path' })
  editor.edit = async () => { throw new Error('private/path') }
  await assert.rejects(updateWorktreeConfig(editor, { ...defaults, namePrefix: 'x-', expected: defaults }),
    isFailure(500, 'worktree-config-failed'))
  editor.entry.options.name = 'unrelated-worktree'
  assert.throws(() => readWorktreeConfig(editor), isFailure(404, 'worktree-config-unavailable'))
  editor.entry.options.name = moduleName
  editor.entry.fiber.state = 3
  assert.throws(() => readWorktreeConfig(editor), isFailure(404, 'worktree-config-unavailable'))
})

test('registers one owner-authenticated GET/POST route and rejects non-owners before touching request body', async () => {
  const editor = fakeEditor()
  const route = setup(editor)
  const shared = { principal: { kind: 'shared' }, signal: new AbortController().signal }
  const revokedOwner = { principal: { kind: 'owner' }, signal: AbortSignal.abort() }
  assert.deepEqual(await route.request('POST', {}, null), { status: 401, body: undefined, consumed: false })
  for (const peer of [shared, revokedOwner]) {
    assert.deepEqual(await route.request('POST', {}, peer), { status: 403, body: undefined, consumed: false })
  }
  assert.equal(route.lookups, 0)
  assert.deepEqual(await route.request('GET'), { status: 200, body: { ok: true, ...defaults }, consumed: false })
  assert.deepEqual(await route.request('POST', {}), { status: 400, body: { ok: false, reason: 'invalid-worktree-config' }, consumed: true })
  const next = { directory: 'local/pool', namePrefix: '' }
  assert.deepEqual(await route.request('POST', { ...next, expected: defaults }), { status: 200, body: { ok: true, ...next }, consumed: true })
  assert.deepEqual(await route.request('POST', { ...next, expected: defaults }), { status: 409, body: { ok: false, reason: 'worktree-config-conflict' }, consumed: true })
  assert.equal(editor.editCalls, 2)
  const missing = await setup(undefined).request('GET')
  assert.deepEqual(missing, { status: 404, body: { ok: false, reason: 'worktree-config-unavailable' }, consumed: false })
})
