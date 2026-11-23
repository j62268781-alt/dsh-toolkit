import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileAddressFor, groupSections } from '../../src/modules/session-panel/client/model.js'

const entry = (id, kind, updatedAt, label = id) => ({ id, kind, label, detail: '', count: 1, status: 'ok', updatedAt })

test('四个分区，知识不占分区，组内最近使用倒序、同时间按名字稳定排', () => {
  const sections = groupSections([
    entry('w1', 'web', 30),
    entry('c1', 'capability', 10),
    entry('s1', 'source', 20),
    entry('a1', 'artifact', 20),
    entry('k1', 'knowledge', 5),
    entry('s2', 'source', 20, 'aaa'),
    entry('s3', 'source', 90),
  ])
  assert.deepEqual(sections.map((section) => section.kind).sort(), ['artifact', 'capability', 'source', 'web'])
  assert.equal(sections.some((section) => section.entries.some((item) => item.id === 'k1')), false)
  assert.deepEqual(sections.find((section) => section.kind === 'source').entries.map((item) => item.id), ['s3', 's2', 's1'])
  assert.deepEqual(sections.find((section) => section.kind === 'capability').entries.map((item) => item.id), ['c1'])
})

test('产出按文件 mtime 排序，不可用的文件排最后', () => {
  const section = groupSections([
    { ...entry('missing', 'artifact', 999), unavailable: true },
    { ...entry('older', 'artifact', 200), modifiedAt: 20 },
    { ...entry('newer', 'artifact', 100), modifiedAt: 40 },
  ]).find((section) => section.kind === 'artifact')
  assert.deepEqual(section.entries.map(item => item.id), ['newer', 'older', 'missing'])
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
