import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findScopedForm, ROOT_ENTRIES, scopeForm } from '../../src/client/config.js'

function makeForm(initial, { storeOnly = false } = {}) {
  let snapshot = initial
  const listeners = new Set()
  const store = {
    getSnapshot() {
      assert.equal(this, store)
      return snapshot
    },
    subscribe(listener) {
      assert.equal(this, store)
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const form = {
    store,
    get status() { return snapshot?.status },
    get writable() { return snapshot?.writable },
    get revision() { return snapshot?.revision },
  }
  if (!storeOnly) {
    form.getSnapshot = function () {
      assert.equal(this, form)
      return store.getSnapshot()
    }
    form.subscribe = function (listener) {
      assert.equal(this, form)
      return store.subscribe(listener)
    }
  }
  return {
    form,
    listeners,
    publish(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

test('namespace projections retain controller and snapshot identities until the root changes', () => {
  const browser = { enabled: true }
  const judgement = { connections: {} }
  const initial = { value: { browser, judgement }, revision: 3, status: 'ready', writable: true }
  const { form, publish } = makeForm(initial)
  const scoped = scopeForm(form, 'browser')
  const first = scoped.getSnapshot()

  assert.equal(scopeForm(form, 'browser'), scoped)
  assert.notEqual(scopeForm(form, 'judgement'), scoped)
  assert.notEqual(scopeForm(makeForm(initial).form, 'browser'), scoped)
  assert.equal(first.value, browser)
  assert.equal(first.revision, 3)
  assert.equal(first.status, 'ready')
  assert.equal(first.writable, true)
  assert.equal(first.value.judgement, undefined)
  assert.equal(scoped.getSnapshot(), first)
  assert.equal(scoped.snapshot, first)
  assert.equal(scoped.store.getSnapshot(), first)
  assert.equal(form.getSnapshot(), initial)

  const nextBrowser = { enabled: false }
  publish({ ...initial, value: { browser: nextBrowser, judgement }, revision: 4 })
  const next = scoped.getSnapshot()
  assert.notEqual(next, first)
  assert.equal(next.value, nextBrowser)
  assert.equal(next.revision, 4)
  assert.equal(scoped.getSnapshot(), next)
  assert.equal(first.value, browser)
  assert.equal(first.revision, 3)
})

test('snapshot projection supports raw values, store controllers, and snapshot properties', () => {
  const browser = { limits: { commandTimeoutMs: 1000 } }
  const raw = { browser, judgement: { connections: {} } }
  const wrapped = { value: raw, revision: 8, status: 'ready' }
  const cases = [
    [{ getSnapshot: () => raw }, browser],
    [{ store: { getSnapshot: () => wrapped } }, wrapped],
    [{ snapshot: wrapped }, wrapped],
  ]
  for (const [form, expected] of cases) {
    const scoped = scopeForm(form, 'browser')
    const snapshot = scoped.getSnapshot()
    if (expected === browser) assert.equal(snapshot, browser)
    else {
      assert.equal(snapshot.value, browser)
      assert.equal(snapshot.revision, 8)
      assert.equal(snapshot.status, 'ready')
    }
    assert.equal(scoped.snapshot, snapshot)
    assert.equal(scoped.store.getSnapshot(), snapshot)
  }
})

test('missing namespaces and loading snapshots produce stable empty values', () => {
  for (const form of [
    {},
    { getSnapshot: () => ({ status: 'loading', value: null }) },
    { snapshot: { value: { judgement: {} }, revision: 1 } },
    { snapshot: { judgement: {} } },
  ]) {
    const scoped = scopeForm(form, 'browser')
    // A real controller returns a stable root reference; freeze this fixture's
    // loading view too so repeated reads exercise the same subscription contract.
    if (form.getSnapshot) {
      const snapshot = form.getSnapshot()
      form.getSnapshot = () => snapshot
    }
    const snapshot = scoped.getSnapshot()
    assert.deepEqual(snapshot.value ?? snapshot, {})
    assert.equal(scoped.getSnapshot(), snapshot)
    assert.equal(scoped.store.getSnapshot(), snapshot)
  }
})

test('direct and store subscriptions forward changes, disposal, and live form metadata', () => {
  for (const storeOnly of [false, true]) {
    const controller = makeForm({ value: { browser: { enabled: true } }, status: 'ready', writable: true, revision: 1 }, { storeOnly })
    const scoped = scopeForm(controller.form, 'browser')
    const seen = []
    const unsubscribe = scoped.subscribe(() => seen.push(scoped.getSnapshot()))
    const unsubscribeStore = scoped.store.subscribe(() => seen.push(scoped.store.getSnapshot()))
    assert.equal(controller.listeners.size, 2)

    controller.publish({ value: { browser: { enabled: false } }, status: 'conflict', writable: false, revision: 2 })
    assert.equal(seen.length, 2)
    assert.equal(seen[0], seen[1])
    assert.equal(seen[0].value.enabled, false)
    assert.equal(scoped.status, 'conflict')
    assert.equal(scoped.writable, false)
    assert.equal(scoped.revision, 2)

    unsubscribe()
    unsubscribeStore()
    assert.equal(controller.listeners.size, 0)
    controller.publish({ value: {}, status: 'ready', writable: true, revision: 3 })
    assert.equal(seen.length, 2)
    assert.equal(scoped.revision, 3)
  }
})

test('writes use atomic mutate paths because the Host set and unset accept scalar fields', () => {
  const calls = []
  const form = {
    set() { assert.fail('a namespace path must not go through Host set(field, value)') },
    unset() { assert.fail('a namespace path must not go through Host unset(field)') },
    mutate(operations, ...args) {
      assert.equal(this, form)
      calls.push({ operations, args })
      return true
    },
  }
  const scoped = scopeForm(form, 'browser')
  assert.equal(scoped.set('enabled', false, 11), true)
  assert.equal(scoped.set(['tools', 'read'], false), true)
  assert.equal(scoped.unset('limits', 12), true)
  assert.equal(scoped.unset(['tools', 'read']), true)
  assert.deepEqual(calls, [
    { operations: [{ op: 'set', path: ['browser', 'enabled'], value: false }], args: [11] },
    { operations: [{ op: 'set', path: ['browser', 'tools', 'read'], value: false }], args: [] },
    { operations: [{ op: 'unset', path: ['browser', 'limits'] }], args: [12] },
    { operations: [{ op: 'unset', path: ['browser', 'tools', 'read'] }], args: [] },
  ])
})

test('batch writes prefix each path once and preserve caller operations and revisions', () => {
  let actual
  const form = { mutate: (...args) => { actual = args; return true } }
  const scoped = scopeForm(form, 'judgement')
  const operations = Object.freeze([
    Object.freeze({ op: 'set', path: Object.freeze(['purposes', 'browser.action']), value: { connection: 'main' } }),
    Object.freeze({ op: 'unset', path: Object.freeze(['connections', 'main', 'models', 0]) }),
    Object.freeze({ op: 'set', path: Object.freeze([]), value: { connections: {} } }),
    Object.freeze({ op: 'unset', path: 'defaultConnection' }),
    Object.freeze({ op: 'set', value: { ledger: { enabled: false } } }),
  ])
  assert.equal(scoped.mutate(operations, 'revision-7'), true)
  assert.deepEqual(actual, [[
    { op: 'set', path: ['judgement', 'purposes', 'browser.action'], value: { connection: 'main' } },
    { op: 'unset', path: ['judgement', 'connections', 'main', 'models', 0] },
    { op: 'set', path: ['judgement'], value: { connections: {} } },
    { op: 'unset', path: ['judgement', 'defaultConnection'] },
    { op: 'set', path: ['judgement'], value: { ledger: { enabled: false } } },
  ], 'revision-7'])
  assert.deepEqual(operations[0].path, ['purposes', 'browser.action'])
  assert.equal(operations[4].path, undefined)
  assert.notEqual(actual[0], operations)
  assert.notEqual(actual[0][0], operations[0])
  assert.equal(actual[0][0].value, operations[0].value)
})

test('write rejection stays false for synchronous and asynchronous Host receipts', async () => {
  let result = false
  const scoped = scopeForm({ mutate: () => result }, 'skillsMcp')
  assert.equal(scoped.set('toolFilters', {}), false)
  assert.equal(scoped.unset('toolFilters'), false)
  assert.equal(scoped.mutate([{ op: 'unset', path: ['toolFilters'] }]), false)

  result = Promise.resolve(false)
  for (const receipt of [
    scoped.set('toolFilters', {}),
    scoped.unset('toolFilters'),
    scoped.mutate([{ op: 'unset', path: ['toolFilters'] }]),
  ]) {
    assert.equal(receipt, result)
    assert.equal(await receipt, false)
  }
})

test('a controller without atomic mutate does not expose incorrectly scoped scalar writes', () => {
  const scoped = scopeForm({ set() {}, unset() {} }, 'browser')
  assert.equal(scoped.set, undefined)
  assert.equal(scoped.unset, undefined)
  assert.equal(scoped.mutate, undefined)
})

test('root entry candidates precede legacy entries and share the cached scoped form', () => {
  const first = makeForm({ value: { browser: { enabled: true } } }).form
  const second = makeForm({ value: { browser: { enabled: false } } }).form
  const legacy = { getSnapshot: () => ({ enabled: false }) }
  const visited = []
  const renamed = makeForm({ value: { browser: { enabled: false } } }).form
  const forms = new Map([['shell-kit', first], ['dsh-toolkit', renamed], ['dsh-shell-kit', second], ['agent-browser', legacy]])
  const ctx = { configForms: { get(entryId) { visited.push(entryId); return forms.get(entryId) } } }
  const result = findScopedForm(ctx, 'browser', ['agent-browser', 'dsh-agent-browser'])
  assert.deepEqual(ROOT_ENTRIES, ['shell-kit', 'dsh-toolkit', 'dsh-shell-kit'])
  assert.equal(result.entryId, 'shell-kit')
  assert.equal(result.form, scopeForm(first, 'browser'))
  assert.deepEqual(visited, ['shell-kit'])

  forms.delete('shell-kit')
  visited.length = 0
  const fallback = findScopedForm(ctx, 'browser', ['agent-browser'])
  assert.equal(fallback.entryId, 'dsh-toolkit')
  assert.equal(fallback.form, scopeForm(renamed, 'browser'))
  assert.deepEqual(visited, ['shell-kit', 'dsh-toolkit'])

  forms.delete('dsh-toolkit')
  visited.length = 0
  const oldRoot = findScopedForm(ctx, 'browser', ['agent-browser'])
  assert.equal(oldRoot.entryId, 'dsh-shell-kit')
  assert.equal(oldRoot.form, scopeForm(second, 'browser'))
  assert.deepEqual(visited, ['shell-kit', 'dsh-toolkit', 'dsh-shell-kit'])
})

test('legacy entry fallback preserves its original unscoped form despite throwing lookups', () => {
  const legacy = { getSnapshot: () => ({ value: { connections: {} } }), set() {} }
  const visited = []
  const ctx = { configForms: { get(entryId) {
    visited.push(entryId)
    if (entryId === 'dsh-judgment') return legacy
    throw new Error(`No entry: ${entryId}`)
  } } }
  const result = findScopedForm(ctx, 'judgement', ['judgment/provider', 'dsh-judgment'])
  assert.equal(result.form, legacy)
  assert.equal(result.entryId, 'dsh-judgment')
  assert.equal(result.form.set, legacy.set)
  assert.deepEqual(visited, ['shell-kit', 'dsh-toolkit', 'dsh-shell-kit', 'judgment/provider', 'dsh-judgment'])
})

test('missing config controllers return the root entry id without a writable form', () => {
  for (const ctx of [undefined, {}, { configForms: {} }, { configForms: { get: () => undefined } }, { configForms: { get() { throw new Error('not mounted') } } }]) {
    assert.deepEqual(findScopedForm(ctx, 'browser', ['agent-browser']), { form: undefined, entryId: 'shell-kit' })
  }
})
