import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INITIAL_VISIBLE } from '../../src/modules/task-monitor/host/constants.js'
import { fileAddressFor, groupSections, hiddenOf, timeLabel, visibleOf } from '../../src/modules/task-monitor/client/model.js'

const entry = (id, kind, updatedAt, label = id) => ({ id, kind, label, detail: '', count: 1, status: 'ok', updatedAt })

test('四个分区固定顺序，知识不占分区，组内最近使用倒序、同时间按名字稳定排', () => {
  const sections = groupSections([
    entry('w1', 'web', 30),
    entry('c1', 'capability', 10),
    entry('s1', 'source', 20),
    entry('a1', 'artifact', 20),
    entry('k1', 'knowledge', 5),
    entry('s2', 'source', 20, 'aaa'),
    entry('s3', 'source', 90),
  ])
  assert.deepEqual(sections.map((section) => section.kind), ['capability', 'artifact', 'web', 'source'])
  assert.equal(sections.some((section) => section.entries.some((item) => item.id === 'k1')), false)
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
test('文件地址按宿主规则拼：相对路径折叠、段编码、cwd 外绝对路径原样进 session', () => {
  // 与宿主 fileAddressFor 逐字对齐：右栏只认这一种小写拼写，差一个编码就打不开。
  assert.equal(fileAddressFor('s1', '/repo', 'src/main.ts'), 'dsh-resource://file/session/s1/src/main.ts')
  assert.equal(fileAddressFor('s1', '/repo', './src/main.ts'), 'dsh-resource://file/session/s1/src/main.ts')
  assert.equal(fileAddressFor('s1', '/repo', 'docs/a b.md'), 'dsh-resource://file/session/s1/docs/a%20b.md')
  assert.equal(fileAddressFor('s1', '/repo', '/repo/out.png'), 'dsh-resource://file/session/s1/out.png')
  assert.equal(fileAddressFor('s1', '/repo', '/repo'), 'dsh-resource://file/session/s1/')
  assert.equal(fileAddressFor('s1', '/repo', '/etc/hosts'), 'dsh-resource://file/session/s1//etc/hosts')
  assert.equal(fileAddressFor('s1', 'D:\\repo\\', 'D:\\repo\\src\\main.ts'), 'dsh-resource://file/session/s1/src/main.ts')
  assert.equal(fileAddressFor('s:1', '/repo', 'a.ts'), 'dsh-resource://file/session/s:1/a.ts')
})
