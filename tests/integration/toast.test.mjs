/**
 * 全局 toast 通道（`src/client/ui/toast.ts`）：一条挂在 document.body 上的栈，与 React 树无关。
 *
 * 断言的都是「面板里看不到它就没意义」的那几件事：同文案不叠、超出上限挤掉最老的、
 * 语气决定 role、空文案不建栈、样式只插一份、换一份 document 就换一个栈。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { clearToasts, showToast, toast } from '../../src/client/ui/toast.ts'

const STACK = '.sk-toast-stack'
const ENTRY = '.sk-toast'

function usePage(t) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  const previous = globalThis.document
  globalThis.document = dom.window.document
  // host 挂在 globalThis 上，会跨用例存活；每个用例从干净的一页开始。
  delete globalThis.__dshToolkitToast__
  t.after(() => {
    clearToasts()
    delete globalThis.__dshToolkitToast__
    globalThis.document = previous
  })
  return dom.window.document
}

function texts(document) {
  return [...document.querySelectorAll(`${STACK} ${ENTRY}`)].map((node) => node.textContent.replace(/^[!✓]/, ''))
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('error 走 role="alert"，success/info 走 role="status"，只有带语气的才配图标', (t) => {
  const document = usePage(t)
  toast.error('写盘失败')
  toast.success('已保存')
  toast.info('正在重启')
  const [error, success, info] = [...document.querySelectorAll(ENTRY)]
  assert.equal(error.getAttribute('role'), 'alert')
  assert.equal(success.getAttribute('role'), 'status')
  assert.equal(info.getAttribute('role'), 'status')
  // 语气由 class 与 data-tone 两处同时给出：样式挂在 class 上，测试与调试看 data-tone。
  assert.equal(error.className, 'sk-toast sk-toast--error')
  assert.equal(error.dataset.tone, 'error')
  assert.equal(error.querySelector('.sk-toast__icon').textContent, '!')
  assert.equal(success.querySelector('.sk-toast__icon').textContent, '✓')
  assert.equal(info.querySelector('.sk-toast__icon'), null)
  assert.deepEqual(texts(document), ['写盘失败', '已保存', '正在重启'])
})

test('同一条文案重复出现只续命，不叠第二条', (t) => {
  const document = usePage(t)
  toast.error('宿主拒绝了这次写入')
  toast.error('宿主拒绝了这次写入')
  assert.equal(document.querySelectorAll(ENTRY).length, 1)
  assert.equal(texts(document)[0], '宿主拒绝了这次写入')
})

test('超过三条时最老的一条先离场，栈里始终只剩三条', async (t) => {
  const document = usePage(t)
  for (const text of ['第一条', '第二条', '第三条', '第四条']) toast.info(text)
  const live = [...document.querySelectorAll(ENTRY)]
  assert.equal(live.length, 4, '离场要等动画，节点先留在场上')
  assert.equal(live[0].classList.contains('sk-toast--leaving'), true, '被挤出去的是最老那条')
  assert.equal(live[3].classList.contains('sk-toast--leaving'), false)
  await wait(260)
  assert.deepEqual(texts(document), ['第二条', '第三条', '第四条'])
})

test('空文案不建栈：面板里 error 为空的前置判断可以省掉', (t) => {
  const document = usePage(t)
  showToast('')
  showToast('   ')
  showToast(undefined)
  assert.equal(document.querySelector(STACK), null)
})

test('样式只插一份，重复调用与多个 bundle 实例共用同一个 <style>', (t) => {
  const document = usePage(t)
  toast.info('一')
  toast.error('二')
  const style = document.querySelectorAll('style[data-plugin-css="dsh-toolkit-toast/styles.css"]')
  assert.equal(style.length, 1)
  assert.match(style[0].textContent, /\.sk-toast-stack\s*\{[^}]*position:\s*fixed/)
})

test('换一份 document 就换一个栈：host 在 globalThis 上会跨用例存活', (t) => {
  const first = usePage(t)
  toast.error('上一页的报错')
  assert.equal(first.querySelectorAll(ENTRY).length, 1)

  const second = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  globalThis.document = second.window.document
  toast.error('这一页的报错')
  assert.equal(second.window.document.querySelectorAll(ENTRY).length, 1, 'toast 必须落在当前文档')
  assert.equal(first.querySelectorAll(ENTRY).length, 1, '旧文档里那条不再改动，整页销毁时一起消失')
})

test('clearToasts 清空整栈，且之后还能继续用', async (t) => {
  const document = usePage(t)
  toast.info('一')
  toast.info('二')
  clearToasts()
  await wait(260)
  assert.equal(document.querySelectorAll(ENTRY).length, 0)
  toast.info('三')
  assert.deepEqual(texts(document), ['三'])
})
