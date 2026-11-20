/**
 * 「这个会话有没有可展示的内容」的内存记账：新会话没有条目时，右栏与标题栏按钮
 * 都靠它不出现。三档语义（undefined / true / false）是这块的全部逻辑，单独测。
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  hasContentOf, setHasContent, subscribeContent,
} from '../../src/modules/task-monitor/client/state/content.js'

test('还没拉到快照时是 undefined，不能当成空', () => {
  assert.equal(hasContentOf('never-seen'), undefined)
  assert.equal(hasContentOf(undefined), undefined)
  assert.equal(hasContentOf(''), undefined)
  setHasContent('', true)
  assert.equal(hasContentOf(''), undefined, '空会话号不记账')
})

test('按会话记账，同值不重复通知，退订后不再通知', () => {
  let calls = 0
  const off = subscribeContent(() => { calls += 1 })
  setHasContent('c1', true)
  assert.equal(hasContentOf('c1'), true)
  assert.equal(hasContentOf('c2'), undefined, '只影响被写入的那个会话')
  assert.equal(calls, 1)

  setHasContent('c1', true)
  assert.equal(calls, 1, '值没变不该惊动订阅者')

  setHasContent('c1', false)
  assert.equal(hasContentOf('c1'), false, '会话后续又产生内容时要能翻回来')
  assert.equal(calls, 2)

  off()
  setHasContent('c1', true)
  assert.equal(calls, 2, '退订后不再通知')
  assert.equal(hasContentOf('c1'), true)
})
