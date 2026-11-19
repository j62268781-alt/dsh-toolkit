import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INITIAL_VISIBLE } from '../../src/modules/task-monitor/host/constants.js'
import { groupSections, hiddenOf, timeLabel, visibleOf } from '../../src/modules/task-monitor/client/model.js'

const entry = (id, kind, updatedAt, label = id) => ({ id, kind, label, detail: '', count: 1, status: 'ok', updatedAt })

test('五个分区固定顺序，组内最近使用倒序、同时间按名字稳定排', () => {
  const sections = groupSections([
    entry('w1', 'web', 30),
    entry('c1', 'capability', 10),
    entry('s1', 'source', 20),
    entry('a1', 'artifact', 20),
    entry('k1', 'knowledge', 5),
    entry('s2', 'source', 20, 'aaa'),
    entry('s3', 'source', 90),
  ])
  assert.deepEqual(sections.map((section) => section.kind), ['capability', 'artifact', 'web', 'source', 'knowledge'])
  assert.deepEqual(sections[3].entries.map((item) => item.id), ['s3', 's2', 's1'])
  assert.deepEqual(sections[0].entries.map((item) => item.id), ['c1'])
})

test('首屏裁切与查看更多计数', () => {
  const entries = Array.from({ length: INITIAL_VISIBLE + 3 }, (_, index) => entry(`e${index}`, 'web', index))
  assert.equal(visibleOf(entries, false).length, INITIAL_VISIBLE)
  assert.equal(hiddenOf(entries, false), 3)
  assert.equal(visibleOf(entries, true).length, INITIAL_VISIBLE + 3)
  assert.equal(hiddenOf(entries, true), 0)
  assert.equal(hiddenOf(entries.slice(0, 2), false), 0)
})

test('timeLabel 补零', () => {
  const at = new Date(2026, 0, 1, 9, 5).getTime()
  assert.equal(timeLabel(at), '09:05')
})