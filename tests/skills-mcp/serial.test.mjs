import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSerialQueue } from '../../src/host/serial.ts'

test('serial queue preserves FIFO and continues after rejection', async () => {
  const queue = createSerialQueue()
  const order = []
  const first = queue.run(async () => {
    order.push('first-start')
    await new Promise((resolve) => setTimeout(resolve, 5))
    order.push('first-end')
    throw new Error('expected failure')
  })
  const second = queue.run(() => { order.push('second'); return 2 })
  await assert.rejects(first, /expected failure/)
  assert.equal(await second, 2)
  assert.deepEqual(order, ['first-start', 'first-end', 'second'])
})
