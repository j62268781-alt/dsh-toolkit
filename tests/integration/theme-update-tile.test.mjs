/**
 * 桌面更新磁贴的状态映射：update-tile.js 把桥的 phase/percent 写进 DOM，
 * 样式表只认这两个属性。这里在 jsdom 里验证映射、降级路径和卸载清理。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

import { installUpdateTile } from '../../src/modules/theme/client/update-tile.ts'

const PAGE = `<!doctype html><html><body>
  <div data-slot="sidebar">
    <div class="wtg9ga_triggerRow">
      <button class="VUhOWa_indicator" type="button" aria-disabled="false" aria-label="新版本"></button>
    </div>
  </div>
</body></html>`

/** jsdom 全局环境；bridge 省略时模拟没有 preload 桥的纯浏览器。 */
function sandbox(bridge) {
  const dom = new JSDOM(PAGE, { url: 'http://localhost/', pretendToBeVisual: true })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.MutationObserver = dom.window.MutationObserver
  globalThis.requestAnimationFrame = (callback) => dom.window.setTimeout(() => callback(Date.now()), 0)
  globalThis.cancelAnimationFrame = (handle) => dom.window.clearTimeout(handle)
  if (bridge) globalThis.dshDesktop = { protocolVersion: 1, updates: bridge }
  else delete globalThis.dshDesktop
  return { dom, tile: dom.window.document.querySelector('.VUhOWa_indicator') }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

const state = (tile) => ({
  phase: tile.getAttribute('data-cx-update'),
  progress: tile.getAttribute('data-cx-progress'),
  percent: tile.style.getPropertyValue('--cx-update-pct'),
})

test('没有桥时按 aria-label 的百分比显示下载进度', () => {
  const { dom, tile } = sandbox()
  tile.setAttribute('aria-label', '42%')
  const dispose = installUpdateTile()
  assert.deepEqual(state(tile), { phase: 'downloading', progress: '42', percent: '42%' })
  dispose()
  dom.window.close()
})

test('没有桥也没有百分比时退回通用图标', () => {
  const { dom, tile } = sandbox()
  const dispose = installUpdateTile()
  assert.deepEqual(state(tile), { phase: 'unknown', progress: null, percent: '' })
  dispose()
  dom.window.close()
})

test('桥的相位与百分比写入磁贴，idle 会清空', async () => {
  let push = () => {}
  const { dom, tile } = sandbox({
    subscribe(listener) {
      push = listener
      return () => {
        push = () => {}
      }
    },
    status: () => Promise.resolve({ phase: 'available' }),
  })
  assert.ok(tile, '磁贴应当存在')
  const dispose = installUpdateTile()
  await settle()
  assert.deepEqual(state(tile), { phase: 'available', progress: null, percent: '' })

  push({ phase: 'downloading', percent: 7.4 })
  await settle()
  assert.deepEqual(state(tile), { phase: 'downloading', progress: '7', percent: '7%' })

  push({ phase: 'verifying', percent: 100 })
  await settle()
  assert.deepEqual(state(tile), { phase: 'verifying', progress: null, percent: '' })

  push({ phase: 'idle' })
  await settle()
  assert.deepEqual(state(tile), { phase: null, progress: null, percent: '' })

  dispose()
  dom.window.close()
})

test('迟到的 status() 不会覆盖已经到达的实时相位', async () => {
  let resolveStatus
  const { dom, tile } = sandbox({
    subscribe(listener) {
      listener({ phase: 'ready' })
      return () => {}
    },
    status: () => new Promise((resolve) => {
      resolveStatus = resolve
    }),
  })
  const dispose = installUpdateTile()
  await settle()
  assert.deepEqual(state(tile), { phase: 'ready', progress: null, percent: '' })

  resolveStatus({ phase: 'downloading', percent: 55 })
  await settle()
  assert.deepEqual(state(tile), { phase: 'ready', progress: null, percent: '' })

  dispose()
  dom.window.close()
})

test('status() 失败不会抛到调用方，卸载后属性全部清除', async () => {
  let push = () => {}
  let unsubscribed = false
  const { dom, tile } = sandbox({
    subscribe(listener) {
      push = listener
      return () => {
        unsubscribed = true
      }
    },
    status: () => Promise.reject(new Error('offline')),
  })
  const dispose = installUpdateTile()
  push({ phase: 'error' })
  await settle()
  assert.deepEqual(state(tile), { phase: 'error', progress: null, percent: '' })

  dispose()
  assert.equal(unsubscribed, true)
  assert.deepEqual(state(tile), { phase: null, progress: null, percent: '' })

  push({ phase: 'available' })
  await settle()
  assert.deepEqual(state(tile), { phase: null, progress: null, percent: '' })

  dom.window.close()
})
