/**
 * Git 设置面板的交互：三种控件各自的保存时机与失败回滚。
 *
 * 面板注册走 slot（集成测试覆盖），这里只渲染 surface 导出的组件本体：
 * 前缀与提交说明失焦保存，开关即时保存。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, writeFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React from 'react'
import { GIT_COPY } from '../../src/modules/git/client/locale.ts'

const ENTRY = 'src/modules/git/client/surfaces/settings/index.tsx'

let entryPromise
/** 像 shipped client 那样打包一次（external 掉 react 与宿主 UI kit，CSS 走 text loader）。 */
function loadEntry() {
  entryPromise ??= (async () => {
    const result = await build({
      entryPoints: [ENTRY],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/*'],
      jsx: 'automatic',
      loader: { '.css': 'text' },
      write: false,
      logLevel: 'silent',
    })
    await mkdir('node_modules/.cache', { recursive: true })
    const path = 'node_modules/.cache/git-settings-ui.mjs'
    await writeFile(path, result.outputFiles[0].text)
    return import(new URL(`../../${path}`, import.meta.url).href)
  })()
  return entryPromise
}

function translator() {
  return (key, params) => {
    let text = GIT_COPY.zh[key] ?? key
    for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
    return text
  }
}

function withDom(t) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'https://dsh.example.test',
    pretendToBeVisual: true,
  })
  const saved = new Map()
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  t.after(() => {
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return dom
}

/** 配置表单替身：`set` 返回 false 表示宿主拒绝（acceptConfigWrite 只把 false 当失败）。 */
function fakeForm(initial, { writable = true, reject = false, deferred = false } = {}) {
  const writes = []
  const listeners = new Set()
  const pending = []
  let value = { branchPrefix: '', alwaysForcePush: false, commitInstructions: '', ...initial }
  return {
    writes,
    resolveWrite: (accepted = true) => pending.shift()(accepted),
    getSnapshot: () => ({ value, status: 'ready', writable }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(path, next) {
      writes.push({ path, next })
      const apply = (accepted) => {
        if (!accepted) return false
        value = { ...value, [path]: next }
        for (const listener of listeners) listener()
        return undefined
      }
      if (deferred) return new Promise((resolve) => pending.push((accepted) => resolve(apply(accepted))))
      return apply(!reject)
    },
  }
}

async function mount(dom, form, props = {}) {
  const { act } = React
  const { createRoot } = await import('react-dom/client')
  const { createGitSection } = await loadEntry()
  const Section = createGitSection({ locale: { bind: () => translator() } })
  const root = createRoot(dom.window.document.getElementById('root'))
  await act(async () => root.render(React.createElement(Section, { form, ...props })))
  return { act, root }
}

const query = (dom, selector) => dom.window.document.querySelector(selector)

async function setValue(dom, act, element, value) {
  const proto = element.tagName === 'TEXTAREA'
    ? dom.window.HTMLTextAreaElement.prototype
    : dom.window.HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

async function blur(dom, act, element) {
  await act(async () => {
    element.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }))
  })
}

test('渲染当前值：前缀进输入框、开关进 aria-checked、说明带字数计数', async (t) => {
  const dom = withDom(t)
  const form = fakeForm({ branchPrefix: 'qoder/', alwaysForcePush: true, commitInstructions: '用中文' })
  await mount(dom, form)

  assert.equal(query(dom, 'input.sk-repo-settings__input').value, 'qoder/')
  assert.equal(query(dom, '[role="switch"]').getAttribute('aria-checked'), 'true')
  assert.equal(query(dom, '.sk-git__textarea').value, '用中文')
  assert.match(query(dom, '.sk-git__count').textContent, /^3\/4000$/)
  assert.match(dom.window.document.body.textContent, /Git/)
  // 骨架样式是全局注入的，面板自己只带面板样式。
  assert.ok(query(dom, 'style'))
})

test('非法前缀：失焦时就地报错，一个字节都不写', async (t) => {
  const dom = withDom(t)
  const form = fakeForm({ branchPrefix: 'qoder/' })
  const { act } = await mount(dom, form)

  const input = query(dom, 'input.sk-repo-settings__input')
  await setValue(dom, act, input, 'a b')
  await blur(dom, act, input)

  assert.equal(form.writes.length, 0)
  const error = query(dom, '.sk-repo-settings__hint--error')
  assert.match(error.textContent, /请输入有效的 Git 分支前缀/)
  assert.equal(input.getAttribute('aria-invalid'), 'true')
  assert.equal(input.getAttribute('aria-describedby'), error.id)
})

test('合法前缀：先归一化再保存，成功后草稿让位给服务端的值', async (t) => {
  const dom = withDom(t)
  const form = fakeForm()
  const { act } = await mount(dom, form)

  const input = query(dom, 'input.sk-repo-settings__input')
  await setValue(dom, act, input, '/team//x/')
  await blur(dom, act, input)

  assert.deepEqual(form.writes, [{ path: 'branchPrefix', next: 'team/x/' }])
  assert.equal(query(dom, 'input.sk-repo-settings__input').value, 'team/x/')
  assert.equal(query(dom, '.sk-repo-settings__hint--error'), null)
})

test('开关：切换即保存；宿主拒绝时回滚并报错', async (t) => {
  const dom = withDom(t)
  const form = fakeForm({ alwaysForcePush: false })
  const { act } = await mount(dom, form)

  const toggle = query(dom, '[role="switch"]')
  await act(async () => toggle.click())
  assert.deepEqual(form.writes, [{ path: 'alwaysForcePush', next: true }])
  assert.equal(query(dom, '[role="switch"]').getAttribute('aria-checked'), 'true')

  const rejected = withDom(t)
  const rejecting = fakeForm({ alwaysForcePush: false }, { reject: true })
  const rerender = await mount(rejected, rejecting)
  await rerender.act(async () => query(rejected, '[role="switch"]').click())
  assert.equal(query(rejected, '[role="switch"]').getAttribute('aria-checked'), 'false', '拒绝后回到服务端的值')
  // 失败提示是全局 toast（`src/client/ui/toast.ts` 挂在 document.body 上），面板里不再留一行红字。
  assert.match(query(rejected, '.sk-toast--error').textContent, /无法保存 Git 设置/)
})

test('提交说明：失焦立即保存，写的是归一化后的文本', async (t) => {
  const dom = withDom(t)
  const form = fakeForm()
  const { act } = await mount(dom, form)

  const textarea = query(dom, '.sk-git__textarea')
  await setValue(dom, act, textarea, '  Use Angular  \r\n  ')

  assert.equal(form.writes.length, 0, '输入过程中不写')
  await blur(dom, act, textarea)
  assert.deepEqual(form.writes, [{ path: 'commitInstructions', next: 'Use Angular' }])
  assert.match(query(dom, '.sk-git__status').textContent, /已保存/)
})

test('提交说明：停手超过旧防抖时长仍不写，编辑后失焦才保存', async (t) => {
  const dom = withDom(t)
  const form = fakeForm({ commitInstructions: 'Conventional Commits' })
  const { act } = await mount(dom, form)

  const textarea = query(dom, '.sk-git__textarea')
  await setValue(dom, act, textarea, '  Conventional Commits  ')
  await blur(dom, act, textarea)
  assert.equal(textarea.value, 'Conventional Commits')
  assert.equal(form.writes.length, 0, '归一化后不变时不写')

  await setValue(dom, act, textarea, '用中文')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1300))
  })
  assert.equal(form.writes.length, 0)
  await blur(dom, act, textarea)
  assert.deepEqual(form.writes, [{ path: 'commitInstructions', next: '用中文' }])
})

test('提交说明：重复失焦不产生并行写入，只串行写已失焦的最新草稿', async (t) => {
  const dom = withDom(t)
  const form = fakeForm({}, { deferred: true })
  const { act } = await mount(dom, form)
  const textarea = query(dom, '.sk-git__textarea')
  const status = query(dom, '.sk-git__status[role="status"]')

  await setValue(dom, act, textarea, '第一稿')
  await blur(dom, act, textarea)
  await blur(dom, act, textarea)
  assert.equal(form.writes.length, 1)
  assert.match(status.textContent, /正在保存/)
  assert.equal(textarea.disabled, false)

  await setValue(dom, act, textarea, '第二稿')
  await blur(dom, act, textarea)
  await setValue(dom, act, textarea, '第三稿')
  await blur(dom, act, textarea)
  await setValue(dom, act, textarea, '仍在编辑')
  assert.equal(form.writes.length, 1)

  await act(async () => form.resolveWrite())
  assert.deepEqual(form.writes.map(({ next }) => next), ['第一稿', '第三稿'])
  await act(async () => form.resolveWrite())
  assert.equal(form.writes.length, 2, '仍在编辑的草稿不会跟着保存')
  assert.equal(textarea.value, '仍在编辑')
  assert.equal(status.textContent, '', '不把旧稿报告为当前稿已保存')

  await blur(dom, act, textarea)
  await act(async () => form.resolveWrite())
  assert.deepEqual(form.writes.map(({ next }) => next), ['第一稿', '第三稿', '仍在编辑'])
  assert.match(status.textContent, /已保存/)
})

test('提交说明：失败时就地提示并保留草稿，再次失焦可重试', async (t) => {
  const dom = withDom(t)
  const form = fakeForm({}, { deferred: true })
  const { act } = await mount(dom, form)
  const textarea = query(dom, '.sk-git__textarea')
  const status = query(dom, '.sk-git__status[role="status"]')

  await setValue(dom, act, textarea, '保留我')
  await blur(dom, act, textarea)
  await act(async () => form.resolveWrite(false))
  assert.equal(textarea.value, '保留我')
  assert.match(status.textContent, /无法保存 Git 设置/)
  assert.ok(textarea.getAttribute('aria-describedby').split(' ').includes(status.id))
  assert.ok(query(dom, '.sk-toast--error') === null)

  await blur(dom, act, textarea)
  await act(async () => form.resolveWrite())
  assert.deepEqual(form.writes.map(({ next }) => next), ['保留我', '保留我'])
  assert.match(status.textContent, /已保存/)
})

test('只读文档：整页禁用并说明原因', async (t) => {
  const dom = withDom(t)
  await mount(dom, fakeForm({}, { writable: false }))

  assert.equal(query(dom, 'input.sk-repo-settings__input').disabled, true)
  assert.equal(query(dom, '.sk-git__textarea').disabled, true)
  assert.equal(query(dom, '[role="switch"]').disabled, true)
  assert.match(query(dom, '.sk-git__note').textContent, /只读/)
})

test('工作树设置：原生保留开关独立，目录保存冲突后可重新读取', async (t) => {
  const dom = withDom(t)
  let directory = '.agents/worktrees'
  let submitted
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /\/worktree-config$/)
    if (options.method === 'POST') {
      submitted = JSON.parse(options.body)
      directory = '.agents/changed-elsewhere'
      return Response.json({ ok: false, reason: 'worktree-config-conflict' }, { status: 409 })
    }
    return Response.json({ ok: true, directory, namePrefix: 'dsh-' })
  })
  const worktreeForm = fakeForm({ retainOnArchive: false })
  const { act, root } = await mount(dom, fakeForm(), { worktreeForm })
  assert.doesNotMatch(dom.window.document.body.textContent, /当前仓库的工作树/)
  const input = query(dom, '[name="directory"]')
  const retain = query(dom, 'input[type="checkbox"]')
  assert.equal(input.value, '.agents/worktrees')
  assert.equal(retain.checked, false)
  await act(async () => retain.click())
  assert.deepEqual(worktreeForm.writes, [{ path: 'retainOnArchive', next: true }])
  await setValue(dom, act, input, '.agents/custom')
  await act(async () => query(dom, 'button[type="submit"]').click())
  assert.deepEqual(submitted, { expected: { directory: '.agents/worktrees', namePrefix: 'dsh-' }, directory: '.agents/custom', namePrefix: 'dsh-' })
  assert.equal(input.value, '.agents/custom')
  assert.equal(input.disabled, true)
  const reload = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '重新读取')
  await act(async () => reload.click())
  assert.equal(input.value, '.agents/changed-elsewhere')
  await act(async () => root.unmount())
})
