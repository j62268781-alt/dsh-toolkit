/**
 * 共享可调尺寸对话框：断言它在视口里保持自己的尺寸（不铺满），
 * 拖拽把手改大小、夹到最小/最大值，Esc 与遮罩关闭。
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { test } from 'node:test'
import { build } from 'esbuild'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function dialogModule(name) {
  const result = await build({
    entryPoints: ['src/client/ui/resizable-dialog.jsx'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    jsx: 'automatic',
    loader: { '.jsx': 'jsx', '.js': 'jsx' },
    write: false,
    logLevel: 'silent',
  })
  await mkdir('node_modules/.cache', { recursive: true })
  const out = `node_modules/.cache/pet_dialog_${name}.mjs`
  await writeFile(out, result.outputFiles[0].text)
  return import(`../../${out}?case=${Math.random()}`)
}

function mount(t) {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://dsh.test', pretendToBeVisual: true })
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const root = createRoot(dom.window.document.getElementById('root'))
  t.after(async () => {
    await act(async () => root.unmount())
    for (const [key, value] of saved) {
      if (value) Object.defineProperty(globalThis, key, value)
      else delete globalThis[key]
    }
    dom.window.close()
  })
  return { dom, root }
}

const mouse = (dom, type, x, y) => new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 })

test('the dialog keeps its own size inside the viewport instead of filling it', async (t) => {
  const { ResizableDialog } = await dialogModule('size')
  const { dom, root } = mount(t)
  const closed = []
  await act(async () => {
    root.render(React.createElement(ResizableDialog, { open: true, onClose: () => closed.push(1), title: '宠物库', description: '说明', footer: React.createElement('span', null, 'footer') }, React.createElement('p', null, 'body')))
    await flush()
  })
  const dialog = document.querySelector('.tk-dialog')
  assert.ok(dialog, 'renders the overlay')
  assert.equal(dialog.getAttribute('role'), 'dialog')
  assert.equal(dialog.getAttribute('aria-label'), '宠物库')
  const card = document.querySelector('.tk-dialogCard')
  assert.equal(card.style.width, '920px', 'default width, not the 1024px viewport')
  assert.equal(card.style.height, '640px')
  assert.ok(document.querySelector('.tk-dialogBody p'), 'children land in the body')
  assert.ok(document.querySelector('.tk-dialogFoot span'), 'footer lands in the footer')
  assert.ok(document.querySelector('.tk-dialogResize'), 'exposes the resize handle')

  await act(async () => { dialog.dispatchEvent(mouse(dom, 'mousedown', 5, 5)); await flush() })
  assert.deepEqual(closed, [1], 'clicking the overlay closes')
})

test('dragging the handle resizes within the minimum and maximum bounds', async (t) => {
  const { ResizableDialog } = await dialogModule('drag')
  const { dom, root } = mount(t)
  await act(async () => { root.render(React.createElement(ResizableDialog, { open: true, onClose: () => {}, title: '宠物库' })); await flush() })
  const card = () => document.querySelector('.tk-dialogCard')
  const handle = document.querySelector('.tk-dialogResize')

  await act(async () => { handle.dispatchEvent(mouse(dom, 'mousedown', 100, 100)); await flush() })
  await act(async () => { document.dispatchEvent(mouse(dom, 'mousemove', 300, 200)); await flush() })
  assert.equal(card().style.width, '976px', 'widened by the drag, capped by the 1024px viewport')
  assert.equal(card().style.height, '720px', 'clamped to viewport height minus padding')

  await act(async () => { document.dispatchEvent(mouse(dom, 'mousemove', -4000, -4000)); await flush() })
  assert.equal(card().style.width, '640px', 'clamped at the minimum width')
  assert.equal(card().style.height, '420px', 'clamped at the minimum height')

  await act(async () => { document.dispatchEvent(mouse(dom, 'mouseup', 0, 0)); await flush() })
  await act(async () => { document.dispatchEvent(mouse(dom, 'mousemove', 400, 400)); await flush() })
  assert.equal(card().style.width, '640px', 'moving after mouseup no longer resizes')
})

test('the handle resizes from the keyboard and Escape closes the dialog', async (t) => {
  const { ResizableDialog } = await dialogModule('keys')
  const { root } = mount(t)
  const closed = []
  await act(async () => { root.render(React.createElement(ResizableDialog, { open: true, onClose: () => closed.push(1), title: '宠物库', resizeLabel: '调整弹窗大小' })); await flush() })
  const card = () => document.querySelector('.tk-dialogCard')
  const handle = document.querySelector('.tk-dialogResize')
  assert.equal(handle.getAttribute('aria-label'), '调整弹窗大小')

  await act(async () => { handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await flush() })
  assert.equal(card().style.width, '936px', 'arrow keys nudge the width')
  await act(async () => { handle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })); await flush() })
  assert.equal(card().style.height, '704px', 'shift multiplies the step')

  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })); await flush() })
  assert.deepEqual(closed, [1], 'Escape closes')
})

test('a window smaller than the minimum shrinks the minimum instead of overflowing', async () => {
  const { dialogLimits } = await dialogModule('limits')
  const limits = dialogLimits({}, { width: 600, height: 500 })
  assert.equal(limits.maxWidth, 552, 'viewport minus the overlay padding')
  assert.equal(limits.minWidth, 552, 'minimum follows the cap so the card never spills')
  assert.equal(limits.maxHeight, 452)
  assert.equal(limits.minHeight, 420, 'height still has room for its own minimum')
})
