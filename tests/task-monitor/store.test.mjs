import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MAX_ENTRIES, TASK_MONITOR_REASON } from '../../src/modules/task-monitor/host/constants.js'
import { createTaskMonitorStore } from '../../src/modules/task-monitor/host/domain/store.js'

async function withStore(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-monitor-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  let clock = 1000
  const store = createTaskMonitorStore({ home, now: () => clock, persistDelayMs: 5, ...options })
  return { home, store, tick: (ms = 1) => { clock += ms } }
}

const seed = (id, kind = 'source') => ({ kind, id, label: id, detail: '' })

test('record 聚合计数与状态翻转，snapshot 按会话隔离', async (t) => {
  const { store, tick } = await withStore(t)
  await store.record('s1', [seed('a')], 'ok')
  tick()
  await store.record('s1', [seed('a')], 'failed')
  await store.record('s2', [seed('b')], 'ok')
  const one = await store.snapshot('s1')
  assert.equal(one.ok, true)
  assert.equal(one.entries.length, 1)
  assert.equal(one.entries[0].count, 2)
  assert.equal(one.entries[0].status, 'failed')
  const two = await store.snapshot('s2')
  assert.deepEqual(two.entries.map((entry) => entry.id), ['b'])
  assert.deepEqual(await store.snapshot(''), { ok: false, code: TASK_MONITOR_REASON.invalidSession, detail: '缺少 sessionId。' })
})

test('手动来源：校验、幂等、只删手动', async (t) => {
  const { store } = await withStore(t)
  assert.equal((await store.addSource('s1', 'url', 'javascript:alert(1)')).code, TASK_MONITOR_REASON.invalidSource)
  assert.equal((await store.addSource('s1', 'url', '  ')).code, TASK_MONITOR_REASON.invalidSource)
  assert.equal((await store.addSource('s1', 'file', 'x'.repeat(2049))).code, TASK_MONITOR_REASON.invalidSource)
  assert.equal((await store.addSource('s1', 'exe', 'x')).code, TASK_MONITOR_REASON.invalidSource)

  const added = await store.addSource('s1', 'url', ' https://example.com/a ')
  assert.equal(added.ok, true)
  assert.equal(added.entry.label, 'example.com')
  assert.equal(added.entry.detail, 'https://example.com/a')
  assert.equal(added.entry.manual, true)
  const again = await store.addSource('s1', 'url', 'https://example.com/a')
  assert.equal(again.entry, added.entry)

  await store.record('s1', [seed('auto')], 'ok')
  assert.equal((await store.removeSource('s1', 'auto')).code, TASK_MONITOR_REASON.notManual)
  assert.equal((await store.removeSource('s1', 'nope')).code, TASK_MONITOR_REASON.notFound)
  assert.equal((await store.removeSource('s1', added.entry.id)).ok, true)
  const after = await store.snapshot('s1')
  assert.deepEqual(after.entries.map((entry) => entry.id), ['auto'])
})

test('落盘与重启恢复：磁盘只补不覆盖内存', async (t) => {
  const { home, store, tick } = await withStore(t)
  await store.record('s1', [seed('a')], 'ok')
  await store.flush('s1')
  const file = join(home, 'toolkit-task-monitor', 'sessions', `${encodeURIComponent('s1')}.json`)
  const persisted = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(persisted.entries.length, 1)

  // 新实例（模拟重启）先记一条再读盘：两条都在，内存不被磁盘盖掉。
  const reborn = createTaskMonitorStore({ home, now: () => 5000, persistDelayMs: 5 })
  await reborn.record('s1', [seed('b')], 'ok')
  const snapshot = await reborn.snapshot('s1')
  assert.deepEqual(snapshot.entries.map((entry) => entry.id).sort(), ['a', 'b'])
  await reborn.dispose()
})

test('dispose 把防抖窗口里的改动落盘', async (t) => {
  const { home, store } = await withStore(t, { persistDelayMs: 60_000 })
  await store.record('s1', [seed('a')], 'ok')
  await store.dispose()
  const file = join(home, 'toolkit-task-monitor', 'sessions', 's1.json')
  const persisted = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(persisted.entries[0].id, 'a')
})

test('超上限淘汰最旧非手动，手动来源永远保留', async (t) => {
  const { store, tick } = await withStore(t)
  await store.addSource('s1', 'file', '/repo/pinned.md')
  for (let index = 0; index < MAX_ENTRIES + 10; index++) {
    tick()
    await store.record('s1', [seed(`auto-${index}`, 'artifact')], 'ok')
  }
  const snapshot = await store.snapshot('s1')
  assert.equal(snapshot.entries.length, MAX_ENTRIES)
  assert.ok(snapshot.entries.some((entry) => entry.manual === true))
  assert.equal(snapshot.entries.some((entry) => entry.id === 'auto-0'), false)
  assert.ok(snapshot.entries.some((entry) => entry.id === `auto-${MAX_ENTRIES + 9}`))
})

test('enabled 关掉：不记录，三条域操作都回 4105', async (t) => {
  let on = true
  const { store } = await withStore(t, { enabled: () => on })
  await store.record('s1', [seed('a')], 'ok')
  on = false
  await store.record('s1', [seed('b')], 'ok')
  assert.deepEqual((await store.snapshot('s1')).code, TASK_MONITOR_REASON.disabled)
  assert.deepEqual((await store.addSource('s1', 'file', '/x')).code, TASK_MONITOR_REASON.disabled)
  assert.deepEqual((await store.removeSource('s1', 'manual:file:/x')).code, TASK_MONITOR_REASON.disabled)
  on = true
  const snapshot = await store.snapshot('s1')
  assert.deepEqual(snapshot.entries.map((entry) => entry.id), ['a'])
})

test('坏磁盘文件当空会话，不抛错', async (t) => {
  const { home, store } = await withStore(t)
  const { mkdir, writeFile } = await import('node:fs/promises')
  const dir = join(home, 'toolkit-task-monitor', 'sessions')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 's1.json'), '{broken', 'utf8')
  const snapshot = await store.snapshot('s1')
  assert.equal(snapshot.ok, true)
  assert.deepEqual(snapshot.entries, [])
})