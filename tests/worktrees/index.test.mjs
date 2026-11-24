import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { createManagedWorktreeIndex } from '../../src/modules/worktrees/host/worktree/managed.js'

const record = id => ({ header: { id } })
const live = (revision, identity = Symbol()) => ({ source: 'live', revision, identity })
const cold = (revision, identity = Symbol()) => ({ source: 'persisted', revision, identity })
const signal = () => new AbortController().signal
const projection = branch => ({ worktree: [{ owned: true, worktree: {
  path: 'checkout', repositoryRoot: '/repo', branch,
} }], title: 'Origin' })

function fixture() {
  const list = createManagedWorktreeIndex()
  const slots = new Map()
  const reads = []
  const denied = new Set()
  const sources = {
    async listSessions() { return [...slots.keys()].map(record) },
    canRead(id) { return !denied.has(id) },
    revision({ header: { id } }) { return slots.get(id).revision },
    async readProjection({ header: { id } }) {
      reads.push(id)
      const { values, cacheable = true } = slots.get(id)
      return { values, cacheable }
    },
  }
  return { slots, reads, denied, sources, run: (abort = signal()) => list(sources, abort) }
}

test('only inspects new or changed versions; remembers empty projections and copies rows', async () => {
  const { slots, reads, run } = fixture()
  const a = live(0)
  const b = cold('r1')
  slots.set('a', { revision: a, values: { worktree: [] } })
  slots.set('b', { revision: b, values: projection('first') })
  const initial = await run()
  assert.deepEqual(reads, ['a', 'b'])
  initial[0].branch = 'untrusted result mutation'
  assert.deepEqual(await run(), [{ path: 'checkout', repositoryRoot: '/repo', branch: 'first', sessionId: 'b', sessionTitle: 'Origin' }])
  assert.deepEqual(reads, ['a', 'b'])

  slots.set('a', { revision: live(1, a.identity), values: projection('newly created') })
  assert.equal((await run())[0].branch, 'newly created')
  assert.deepEqual(reads, ['a', 'b', 'a'])
  slots.delete('a')
  slots.set('b', { revision: cold('r2', b.identity), values: projection('changed on disk') })
  assert.equal((await run())[0].branch, 'changed on disk')
  assert.deepEqual(reads, ['a', 'b', 'a', 'b'])

  // Even if an id and version appear again, a disappeared entry was pruned.
  slots.set('a', { revision: live(1, a.identity), values: projection('present again') })
  await run()
  assert.deepEqual(reads, ['a', 'b', 'a', 'b', 'a'])
})

test('distinguishes live objects, live/cold transitions, and persistence instances', async () => {
  const { slots, reads, run } = fixture()
  for (const [index, revision] of [live(5), live(5), cold('5'), cold('5'), live(5)].entries()) {
    slots.set('same-id', { revision, values: projection(`branch-${index}`) })
    assert.equal((await run())[0].branch, `branch-${index}`)
    assert.equal((await run())[0].branch, `branch-${index}`)
  }
  assert.deepEqual(reads, Array(5).fill('same-id'))
})

test('does not reuse a warm entry for denied sessions or allow it to hide authorized rows', async () => {
  const { slots, reads, denied, sources, run } = fixture()
  slots.set('first', { revision: live(0), values: projection('private') })
  slots.set('second', { revision: live(0), values: projection('public') })
  assert.equal((await run())[0].branch, 'private')
  denied.add('first')
  assert.equal((await run())[0].branch, 'public')
  assert.deepEqual(reads, ['first', 'second'])
  denied.delete('first')
  slots.set('second', { revision: live(1), values: projection('public') })
  const inspect = sources.readProjection
  sources.readProjection = async row => {
    if (row.header.id === 'second') denied.add('first')
    return inspect(row)
  }
  assert.equal((await run())[0].branch, 'public', 'late revocation does not let the earlier row win deduplication')
  assert.deepEqual(reads, ['first', 'second', 'first', 'second'])
})

test('re-inspects unversioned or unverified cuts and does not commit aborted or failed scans', async () => {
  const { slots, reads, sources, run } = fixture()
  slots.set('unversioned', { values: { worktree: [] } })
  slots.set('mismatched', { revision: live(1), values: projection('mismatched'), cacheable: false })
  await run()
  await run()
  assert.deepEqual(reads, ['unversioned', 'mismatched', 'unversioned', 'mismatched'])
  slots.clear()
  slots.set('a', { revision: live(0), values: projection('valid') })
  slots.set('b', { revision: live(0), values: { worktree: null } })
  await assert.rejects(run(), /missing worktree projection/)
  slots.delete('b')
  const inspect = sources.readProjection
  const controller = new AbortController()
  sources.readProjection = async row => {
    const result = await inspect(row)
    controller.abort(new Error('disconnect'))
    return result
  }
  await assert.rejects(run(controller.signal), /disconnect/)
  sources.readProjection = inspect
  await run()
  assert.deepEqual(reads.slice(4), ['a', 'b', 'a', 'a'])
})

test('an older overlapping scan cannot replace the fresher committed cache', async () => {
  const { slots, reads, sources, run } = fixture()
  slots.set('a', { revision: live(0), values: projection('first cut') })
  const inspect = sources.readProjection
  let release
  sources.readProjection = async row => {
    const result = await inspect(row)
    if (reads.length === 1) await new Promise(resolve => { release = resolve })
    return result
  }
  const first = run()
  await setImmediate()
  slots.set('a', { revision: live(1), values: projection('later cut') })
  assert.equal((await run())[0].branch, 'later cut')
  release()
  assert.equal((await first)[0].branch, 'first cut')
  assert.equal((await run())[0].branch, 'later cut')
  assert.deepEqual(reads, ['a', 'a'])
})
