import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { registerWorktreeConfigRoutes } from '../../src/modules/worktrees/host/routes/worktree-config.js'
import { isWorktreeConfigUpdate, readWorktreeConfig, updateWorktreeConfig } from '../../src/modules/worktrees/host/worktree/config.js'

const defaults = { directory: '.agents/worktrees', namePrefix: 'dsh-' }
const moduleName = '@deepseek-ai/dsh-experimental-worktree'
const forgeModule = '@deepseek-ai/dsh-experimental-client-ui-forge'

function fakeEditor(initial = {}, initialForge) {
  let raw = initial
  let forgeRaw = initialForge
  let editCalls = 0
  const resolveConfig = config => ({ ...defaults, ...config,
    ...(config.directory?.__jsExpr === 'pool' ? { directory: 'interpolated/pool' } : {}),
    ...(config.namePrefix?.__jsExpr === 'prefix' ? { namePrefix: 'interpolated-' } : {}),
  })
  const resolveForgeConfig = config => ({ worktreePrefix: 'dsh-', ...config })
  const entry = {
    options: { id: 'worktree', name: moduleName },
    fiber: { state: 2, get effectiveConfig() { return resolveConfig(raw) }, resolveConfig },
  }
  const forge = initialForge === undefined ? undefined : {
    options: { id: 'forge-panel', name: forgeModule },
    fiber: { state: 2, get effectiveConfig() { return resolveForgeConfig(forgeRaw) }, resolveConfig: resolveForgeConfig },
  }
  return {
    entry,
    forge,
    get raw() { return raw },
    set raw(next) { raw = next },
    get forgeRaw() { return forgeRaw },
    set forgeRaw(next) { forgeRaw = next },
    get editCalls() { return editCalls },
    entries() { return [entry, forge ?? { ...entry, options: { id: 'forge-panel', name: 'forge' } }] },
    async edit(target, change) {
      editCalls++
      if (forge && target === forge) forgeRaw = change(forgeRaw, {})
      else {
        assert.equal(target, entry)
        raw = change(raw, {})
      }
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
  assert.equal(isWorktreeConfigUpdate({ ...defaults, expected: defaults, directory: '' }), true)
  for (const directory of ['a/', '/a', 'a//b', './a', 'a/../b', 'C:/a', 'a\\b', 'a\0b']) {
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

test('clearing the directory drops its raw value and returns the native default without changing other fields', async () => {
  const raw = { directory: { __jsExpr: 'pool' }, namePrefix: 'team/', retainOnArchive: true, maxOutputBytes: 42 }
  const editor = fakeEditor(raw)
  const expected = readWorktreeConfig(editor)
  const route = setup(editor)
  const request = { ...expected, directory: '', expected }
  const reset = { directory: defaults.directory, namePrefix: 'team/' }
  assert.deepEqual(await route.request('POST', request), { status: 200, body: { ok: true, ...reset }, consumed: true })
  assert.deepEqual(editor.raw, { namePrefix: 'team/', retainOnArchive: true, maxOutputBytes: 42 })
  assert.deepEqual(raw.directory, { __jsExpr: 'pool' })
  assert.deepEqual(await route.request('GET'), { status: 200, body: { ok: true, ...reset }, consumed: false })
  assert.deepEqual(await route.request('POST', request), { status: 409, body: { ok: false, reason: 'worktree-config-conflict' }, consumed: true })
  const saved = editor.raw
  assert.deepEqual(await updateWorktreeConfig(editor, { ...reset, directory: '', expected: reset }), reset)
  assert.equal(editor.raw, saved)
  editor.raw = { ...saved, directory: defaults.directory }
  assert.deepEqual(await updateWorktreeConfig(editor, { ...reset, directory: '', expected: reset }), reset)
  assert.equal(Object.hasOwn(editor.raw, 'directory'), false)
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

test('reads and synchronizes both prefixes without replacing unrelated raw fields', async () => {
  const raw = { directory: { __jsExpr: 'pool' }, retainOnArchive: true, maxOutputBytes: 42 }
  const forgeRaw = { worktreePrefix: 'forge-', maxBranches: 17, gitCommand: { __jsExpr: 'git' } }
  const editor = fakeEditor(raw, forgeRaw)
  const route = setup(editor)
  let expected = { directory: 'interpolated/pool', namePrefix: 'dsh-', worktreePrefix: 'forge-' }
  assert.deepEqual(await route.request('GET'), { status: 200, body: { ok: true, ...expected }, consumed: false })
  for (const namePrefix of ['team/', '']) {
    const next = { directory: expected.directory, namePrefix, worktreePrefix: namePrefix }
    assert.deepEqual(await route.request('POST', { directory: expected.directory, namePrefix, expected }),
      { status: 200, body: { ok: true, ...next }, consumed: true })
    assert.deepEqual(editor.raw, { ...raw, namePrefix })
    assert.deepEqual(editor.forgeRaw, { ...forgeRaw, worktreePrefix: namePrefix })
    expected = next
  }
})

test('an explicit same-prefix repair updates Forge without persisting the native default', async () => {
  const raw = { retainOnArchive: true }
  const editor = fakeEditor(raw, { worktreePrefix: 'forge-', maxCommits: 23 })
  const route = setup(editor)
  const expected = { ...defaults, worktreePrefix: 'forge-' }
  assert.deepEqual(await route.request('POST', { ...defaults, expected, syncNamePrefix: true }),
    { status: 200, body: { ok: true, ...defaults, worktreePrefix: defaults.namePrefix }, consumed: true })
  assert.equal(editor.raw, raw)
  assert.deepEqual(editor.forgeRaw, { worktreePrefix: defaults.namePrefix, maxCommits: 23 })
})

test('rejects stale Forge values before editing and when reloaded inside the native edit', async () => {
  const raw = { retainOnArchive: true }
  const initial = { worktreePrefix: 'forge-' }
  const concurrent = { worktreePrefix: 'other-', maxBranches: 11 }
  const expected = { ...defaults, worktreePrefix: 'forge-' }
  const update = { ...defaults, namePrefix: 'mine-', expected }
  const editor = fakeEditor(raw, concurrent)
  await assert.rejects(updateWorktreeConfig(editor, update), isFailure(409, 'worktree-config-conflict'))
  assert.equal(editor.editCalls, 0)
  assert.equal(editor.raw, raw)
  assert.equal(editor.forgeRaw, concurrent)

  editor.forgeRaw = initial
  const edit = editor.edit.bind(editor)
  editor.edit = async (entry, change) => edit(entry, (...args) => {
    editor.forgeRaw = concurrent
    return change(...args)
  })
  await assert.rejects(updateWorktreeConfig(editor, update), isFailure(409, 'worktree-config-conflict'))
  assert.equal(editor.raw, raw)
  assert.equal(editor.forgeRaw, concurrent)
})

test('checks the reloaded Forge raw prefix inside the Forge edit and rolls back the native write', async () => {
  const raw = { retainOnArchive: true }
  const editor = fakeEditor(raw, { worktreePrefix: 'forge-' })
  const concurrent = { worktreePrefix: 'other-', maxBranches: 11 }
  const expected = { ...defaults, worktreePrefix: 'forge-' }
  const edit = editor.edit.bind(editor)
  editor.edit = async (entry, change) => {
    if (entry !== editor.forge) return edit(entry, change)
    return edit(entry, (_current, inherited) => {
      // The editor's fresh raw input can differ from the effective snapshot read by the route.
      try { return change(concurrent, inherited) }
      finally { editor.forgeRaw = concurrent }
    })
  }
  await assert.rejects(updateWorktreeConfig(editor, { ...defaults, namePrefix: 'mine-', expected }),
    isFailure(409, 'worktree-prefix-unconfirmed'))
  assert.deepEqual(editor.raw, raw)
  assert.equal(editor.forgeRaw, concurrent)
})

test('a failed Forge write restores the exact native raw prefix, including an expression or absent key', async () => {
  const directory = { __jsExpr: 'pool' }
  for (const raw of [{ directory, namePrefix: { __jsExpr: 'prefix' }, retainOnArchive: true }, { directory, retainOnArchive: true }]) {
    const forgeRaw = { worktreePrefix: 'forge-', maxBranches: 22 }
    const editor = fakeEditor(raw, forgeRaw)
    const route = setup(editor)
    const expected = readWorktreeConfig(editor)
    const edit = editor.edit.bind(editor)
    let nativeAfterWrite
    editor.edit = async (entry, change) => {
      if (entry !== editor.forge) return edit(entry, change)
      nativeAfterWrite = editor.raw
      throw new Error('private/forge/patch.yml')
    }
    assert.deepEqual(await route.request('POST', { directory: expected.directory, namePrefix: 'mine-', expected }),
      { status: 500, body: { ok: false, reason: 'worktree-config-failed' }, consumed: true })
    assert.deepEqual(nativeAfterWrite, { ...raw, namePrefix: 'mine-' })
    assert.deepEqual(editor.raw, raw)
    assert.equal(editor.forgeRaw, forgeRaw)
    assert.deepEqual(readWorktreeConfig(editor), expected)
  }
})

test('reports an unconfirmed prefix when the Forge write and native rollback both fail', async () => {
  const raw = { retainOnArchive: true }
  const forgeRaw = { worktreePrefix: 'forge-', maxBranches: 22 }
  const editor = fakeEditor(raw, forgeRaw)
  const route = setup(editor)
  const expected = { ...defaults, worktreePrefix: 'forge-' }
  const edit = editor.edit.bind(editor)
  const attempted = []
  editor.edit = async (entry, change) => {
    attempted.push(entry.options.id)
    if (attempted.length > 1) throw new Error('private/patch.yml')
    return edit(entry, change)
  }
  assert.deepEqual(await route.request('POST', { ...defaults, namePrefix: 'mine-', expected }),
    { status: 409, body: { ok: false, reason: 'worktree-prefix-unconfirmed' }, consumed: true })
  assert.deepEqual(attempted, ['worktree', 'forge-panel', 'worktree'])
  assert.deepEqual(editor.raw, { ...raw, namePrefix: 'mine-' })
  assert.equal(editor.forgeRaw, forgeRaw)
})

test('directory-only edits ignore a stale Forge snapshot and leave both mismatched prefixes untouched', async () => {
  // The native plugin accepts a space, but Forge's branch-prefix check does not.
  const raw = { directory: { __jsExpr: 'pool' }, namePrefix: 'legacy prefix-', retainOnArchive: true }
  const editor = fakeEditor(raw, { worktreePrefix: 'forge-' })
  const route = setup(editor)
  const expected = readWorktreeConfig(editor)
  const concurrent = { worktreePrefix: 'other-', maxBranches: 11 }
  editor.forgeRaw = concurrent
  assert.deepEqual(await route.request('POST', { directory: '', namePrefix: expected.namePrefix, expected }),
    { status: 200, body: { ok: true, directory: defaults.directory, namePrefix: raw.namePrefix, worktreePrefix: 'other-' }, consumed: true })
  assert.deepEqual(editor.raw, { namePrefix: raw.namePrefix, retainOnArchive: true })
  assert.equal(editor.forgeRaw, concurrent)
  assert.equal(editor.editCalls, 1)
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
