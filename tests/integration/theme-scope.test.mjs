/**
 * 主题安装器的作用域：聊天区流式输出不该触发任何全文档扫描。
 *
 * 旧实现让五个安装器都监听 document.body，流式输出时每帧会跑 3 次
 * document.querySelectorAll、6 次 rAF（120 批 token 实测 360/720）。
 * 这里把「侧栏之外的变化不扫描」钉成回归测试。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

import { installBandHeight } from '../../src/modules/theme/client/band.ts'
import { installSidebarWidth, installWorkspaceCollapse } from '../../src/modules/theme/client/sidebar.ts'
import { installUpdateTile } from '../../src/modules/theme/client/update-tile.ts'
import { installRailUnpin } from '../../src/modules/theme/client/rail-unpin.ts'

const railBundle = await build({
  entryPoints: ['src/modules/theme/client/rail.ts'], bundle: true, platform: 'node',
  format: 'esm', loader: { '.svg': 'text' }, write: false, logLevel: 'silent',
})
const { installRailTitles, installHomeRail } = await import(
  `data:text/javascript;base64,${Buffer.from(railBundle.outputFiles[0].text).toString('base64')}`
)

const PAGE = `<!doctype html><html data-platform="windows"><body>
  <div class="_frame_test" style="grid-template-columns:296px minmax(0, 1fr) 0px">
    <aside data-slot="sidebar"><div class="_root_test">
      <div class="_panelList_test">
        <button class="_panelRow_test" title="Original"><span class="_panelTitle_test">Tools</span></button>
      </div>
    </div></aside>
    <main data-slot="main.conversation"><div class="_msgs"></div></main>
    <div class="_handle_test" data-side="sidebar" style="left:296px" role="presentation"></div>
  </div>
</body></html>`

function sandbox() {
  const dom = new JSDOM(PAGE)
  const frames = new Map()
  let nextFrame = 0
  const counts = { docQueries: 0, elQueries: 0, raf: 0 }
  const docQuery = dom.window.Document.prototype.querySelectorAll
  const elQuery = dom.window.Element.prototype.querySelectorAll
  dom.window.Document.prototype.querySelectorAll = function (...args) {
    counts.docQueries += 1
    return docQuery.apply(this, args)
  }
  dom.window.Element.prototype.querySelectorAll = function (...args) {
    counts.elQueries += 1
    return elQuery.apply(this, args)
  }
  const previous = new Map()
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, Element: dom.window.Element,
    MutationObserver: dom.window.MutationObserver,
    requestAnimationFrame(run) { counts.raf += 1; frames.set(++nextFrame, run); return nextFrame },
    cancelAnimationFrame(key) { frames.delete(key) },
  })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  const teardown = () => {
    dom.window.close()
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
  return {
    teardown,
    document: dom.window.document,
    counts,
    reset() { counts.docQueries = 0; counts.elQueries = 0; counts.raf = 0 },
    async flush() {
      for (let i = 0; i < 40; i += 1) {
        await Promise.resolve()
        if (frames.size === 0) return
        const pending = [...frames.values()]
        frames.clear()
        for (const run of pending) run()
      }
    },
  }
}

function context() {
  const listeners = new Set()
  return {
    layout: {
      panelInfo: {
        getSnapshot: () => ({ activePanelId: null }),
        subscribe(run) { listeners.add(run); return () => listeners.delete(run) },
      },
      selectPanel() {},
      toggleSidebar() {},
    },
  }
}

test('聊天区流式输出不触发任何全文档扫描，侧栏变化仍然生效', async () => {
  const { document, counts, reset, flush, teardown } = sandbox()
  const ctx = context()
  const disposers = [
    installRailTitles(), installHomeRail(ctx), installRailUnpin(), installUpdateTile(),
    installBandHeight(), installSidebarWidth(ctx), installWorkspaceCollapse(ctx),
  ]
  await flush()

  // 120 批 token：旧实现每批 3 次 document.querySelectorAll、6 次 rAF。
  reset()
  const msgs = document.querySelector('._msgs')
  for (let i = 0; i < 120; i += 1) {
    if (i % 3 === 0 || msgs.lastElementChild === null) {
      const line = document.createElement('div')
      line.textContent = `token ${i}`
      msgs.append(line)
    } else {
      msgs.lastElementChild.textContent += ` ${i}`
    }
    await flush()
  }
  assert.deepEqual(counts, { docQueries: 0, elQueries: 0, raf: 0 }, '流式输出不该唤醒侧栏安装器')

  // 侧栏变化仍然被观察到：标题与查询都落在侧栏子树内。
  reset()
  const list = document.querySelector('._panelList_test')
  const row = document.createElement('button')
  row.className = '_panelRow_test'
  row.setAttribute('title', 'Native title')
  row.innerHTML = '<span class="_panelTitle_test">Sessions</span>'
  list.append(row)
  await flush()
  assert.equal(row.getAttribute('title'), 'Sessions')
  assert.equal(counts.docQueries, 0, '侧栏变化也不该退化成全文档查询')
  assert.ok(counts.elQueries > 0, '查询应当落在侧栏元素上')

  // 宿主重建侧栏根节点后观察器要重新挂上。
  reset()
  const aside = document.createElement('aside')
  aside.setAttribute('data-slot', 'sidebar')
  aside.innerHTML = '<div class="_root_test"><div class="_panelList_test"></div></div>'
  document.querySelector('[data-slot="sidebar"]').replaceWith(aside)
  await flush()
  assert.equal(aside.querySelector('.sk-home') !== null, true, '重建后首页入口要重新挂载')

  for (const stop of disposers.reverse()) stop()
  teardown()
})
