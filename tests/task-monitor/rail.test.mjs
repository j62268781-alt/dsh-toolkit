import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  railHidden, setRailHidden, subscribeRail,
  railChoice, setRailChoice,
  railNarrow, setRailNarrow, subscribeRailNarrow,
} from '../../src/modules/task-monitor/client/state/rail.js'

function fakeStorage() {
  const data = new Map()
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: (key) => { data.delete(key) },
  }
}

test('会话内监控栏默认可见，收起后按会话记住', (t) => {
  const storage = fakeStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage })
  t.after(() => { delete globalThis.localStorage })

  assert.equal(railHidden('s1'), false)
  setRailHidden('s1', true)
  assert.equal(railHidden('s1'), true)
  assert.equal(railHidden('s2'), false, '收起只影响当前会话')

  setRailHidden('s1', false)
  assert.equal(railHidden('s1'), false)
  assert.equal(storage.data.has('dsh-toolkit-task-monitor:rail:s1'), false)
})

test('没有会话 id 时不显示栏位', () => {
  assert.equal(railHidden(undefined), true)
  assert.equal(railHidden(''), true)
})

test('写入时通知订阅者，退订后不再通知', (t) => {
  const storage = fakeStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage })
  t.after(() => { delete globalThis.localStorage })

  let calls = 0
  const off = subscribeRail(() => { calls += 1 })
  setRailHidden('s1', true)
  assert.equal(calls, 1)
  setRailHidden('s1', true)
  assert.equal(calls, 2)
  off()
  setRailHidden('s1', false)
  assert.equal(calls, 2)
})

test('localStorage 不可用时退回进程内记账', (t) => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('blocked') },
  })
  t.after(() => { delete globalThis.localStorage })

  setRailHidden('s3', true)
  assert.equal(railHidden('s3'), true)
  setRailHidden('s3', false)
  assert.equal(railHidden('s3'), false)
})

test('narrow flag: 订阅、去重、退订', () => {
  assert.equal(railNarrow(), false);
  const seen = [];
  const off = subscribeRailNarrow(() => { seen.push(railNarrow()); });
  setRailNarrow(true);
  setRailNarrow(true);
  setRailNarrow(false);
  off();
  setRailNarrow(true);
  assert.deepEqual(seen, [true, false]);
  assert.equal(railNarrow(), true);
  setRailNarrow(false);
});

test('显式展开记成 visible：窄列下也能覆盖自动收起', (t) => {
  const storage = fakeStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: storage })
  t.after(() => { delete globalThis.localStorage })

  assert.equal(railChoice('s4'), null, '没表态时跟随宽度')
  setRailChoice('s4', 'visible')
  assert.equal(railChoice('s4'), 'visible')
  assert.equal(railHidden('s4'), false)
  setRailChoice('s4', 'hidden')
  assert.equal(railChoice('s4'), 'hidden')
  assert.equal(railHidden('s4'), true)
  setRailChoice('s4', null)
  assert.equal(railChoice('s4'), null)
  assert.equal(storage.data.has('dsh-toolkit-task-monitor:rail:s4'), false)
})
