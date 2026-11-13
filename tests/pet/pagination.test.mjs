import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function paginationModule() {
  const result = await build({
    entryPoints: ['src/client/ui/components/pagination/index.tsx'], bundle: true, platform: 'node', format: 'esm',
    target: 'node20', jsxFactory: '__dshReact.createElement', jsxFragment: '__dshReact.Fragment',
    write: false, logLevel: 'silent',
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}

function mount(t) {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'https://dsh.test', pretendToBeVisual: true })
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  globalThis.__dshReact = React
  const root = createRoot(dom.window.document.getElementById('root'))
  t.after(async () => {
    await act(async () => root.unmount())
    delete globalThis.__dshReact
    for (const [key, value] of saved) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key] }
    dom.window.close()
  })
  return { dom, root }
}

test('the shared pagination window keeps both ends and the current page neighbourhood', async () => {
  const { paginationWindow } = await paginationModule()
  assert.deepEqual(paginationWindow(0, 1), [0])
  assert.deepEqual(paginationWindow(0, 3), [0, 1, 2])
  assert.deepEqual(paginationWindow(6, 20), [0, null, 4, 5, 6, 7, 8, null, 19])
  assert.deepEqual(paginationWindow(0, 20), [0, 1, 2, null, 19])
  assert.deepEqual(paginationWindow(19, 20), [0, null, 17, 18, 19])
  assert.deepEqual(paginationWindow(-1, 20), [], 'invalid input yields no pages')
  assert.deepEqual(paginationWindow(0, 0), [])
})

test('the pagination control renders one page button per entry and reports the clicked page', async (t) => {
  const { Pagination } = await paginationModule()
  const { root } = mount(t)
  const picked = []
  await act(async () => {
    root.render(React.createElement(Pagination, { page: 6, pages: 20, onChange: (next) => picked.push(next), labels: { prev: '上一页', next: '下一页', label: '分页' } }))
    await flush()
  })
  const nav = document.querySelector('nav.tk-pagination')
  assert.ok(nav, 'renders the shared nav')
  assert.equal(nav.getAttribute('aria-label'), '分页')
  const current = nav.querySelector('[aria-current=page]')
  assert.equal(current.textContent, '7')
  const labels = [...nav.querySelectorAll('button')].map((button) => button.textContent)
  assert.deepEqual(labels, ['上一页', '1', '5', '6', '7', '8', '9', '20', '下一页'])
  await act(async () => { nav.querySelectorAll('button')[2].click(); await flush() })
  await act(async () => { nav.querySelectorAll('button')[8].click(); await flush() })
  assert.deepEqual(picked, [4, 7])
})

test('the pagination control hides itself for a single page and disables the edges', async (t) => {
  const { Pagination } = await paginationModule()
  const { root } = mount(t)
  await act(async () => { root.render(React.createElement(Pagination, { page: 0, pages: 1 })); await flush() })
  assert.equal(document.querySelector('.tk-pagination'), null)

  await act(async () => { root.render(React.createElement(Pagination, { page: 0, pages: 2, disabled: false })); await flush() })
  const buttons = [...document.querySelectorAll('.tk-pagination button')]
  assert.equal(buttons[0].disabled, true, 'previous is disabled on the first page')
  assert.deepEqual([...buttons].map((button) => button.textContent), ['Previous', '1', '2', 'Next'])

  await act(async () => { root.render(React.createElement(Pagination, { page: 1, pages: 2, disabled: true })); await flush() })
  const last = [...document.querySelectorAll('.tk-pagination button')]
  assert.equal(last.at(-1).disabled, true, 'next is disabled on the last page')
  assert.ok(last.every((button) => button.disabled), 'disabled disables the whole control')
})

test('the summary shares one row with the page buttons, and shows even for a single page', async (t) => {
  const { Pagination } = await paginationModule()
  const { root } = mount(t)
  await act(async () => {
    root.render(React.createElement(Pagination, { page: 6, pages: 20, summary: '第 7 / 20 页 · 命中 5208 只' }))
    await flush()
  })
  const nav = document.querySelector('nav.tk-pagination')
  assert.ok(nav, 'the summary keeps the bar visible')
  const summary = nav.querySelector('.tk-pageSummary')
  assert.equal(summary.textContent, '第 7 / 20 页 · 命中 5208 只')
  const buttons = nav.querySelector('.tk-pageButtons')
  assert.ok(buttons, 'page buttons sit in their own group on the same row')
  assert.equal(buttons.querySelector('[aria-current=page]').textContent, '7', 'summary does not disturb the pager')
  assert.equal(nav.querySelectorAll('.tk-page').length, 9, 'the window still renders the same pages')

  await act(async () => { root.render(React.createElement(Pagination, { page: 0, pages: 1, summary: '第 1 / 1 页' })); await flush() })
  assert.equal(document.querySelector('.tk-pagination .tk-pageSummary').textContent, '第 1 / 1 页')
  assert.equal(document.querySelector('.tk-pageButtons'), null, 'a single page drops the buttons but keeps the total')
})
