/**
 * notification 模块测试的共享夹具。
 *
 * 三件事：
 *  1. 用主 bundle 同款的 jsxFactory 把 `src/modules/notification/client/index.tsx` 现场打成
 *     ESM（node 不能直接 import `.css`，CSS 走 esbuild 的 text loader）；
 *  2. 一套 jsdom 全局的安装/还原；
 *  3. 一个「够真」的假 ctx：effect/locale/slots/configForms + sessions/uiSession/
 *     uiConversation/uiWorkspace 的可观察 store，用来跑注册契约与端到端通知链路。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import React from 'react'
import { DEFAULT_SETTINGS } from '../../src/modules/notification/client/model.ts'
import { NOTIFICATION_COPY } from '../../src/modules/notification/client/locale.ts'

/** 与 scripts/build-client.mjs 一致：JSX 走全局 __dshReact。 */
export async function loadClientEntry(entry, name) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    external: ['react', 'react/*', '@deepseek-ai/*'],
    jsxFactory: '__dshReact.createElement',
    jsxFragment: '__dshReact.Fragment',
    loader: {  '.ts': 'ts', '.tsx': 'tsx','.js': 'jsx', '.css': 'text' },
    write: false,
    logLevel: 'silent',
  })
  await mkdir('node_modules/.cache', { recursive: true })
  const out = `node_modules/.cache/${name}.mjs`
  await writeFile(out, result.outputFiles[0].text)
  return import(`../../${out}?v=${Date.now()}`)
}

/** 客户端半（index.jsx）的打包入口。 */
export function loadNotificationModule(name = 'notification-client') {
  return loadClientEntry('src/modules/notification/client/index.tsx', name)
}

/**
 * 安装 jsdom 全局；返回 restore()。
 * @param {{url?: string}} [options] `url` 用来摆出「页面是被点通知新开出来的」那种带 `#…` 的地址。
 */
export function makeDom(options = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: options.url ?? 'https://dsh.example.test',
  })
  const saved = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  return {
    dom,
    window: dom.window,
    document: dom.window.document,
    restore() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
      dom.window.close()
    },
  }
}

/** 一个假 Notification：记录实例、权限可控、点击可模拟、平台失败可模拟（error 事件）。 */
export function createNotificationStub({ permission = 'granted', requestResult } = {}) {
  const instances = []
  class FakeNotification {
    constructor(title, options) {
      this.title = title
      this.options = options ?? {}
      this.closed = false
      this.listeners = new Map()
      instances.push(this)
    }
    close() {
      this.closed = true
    }
    addEventListener(type, listener) {
      const bucket = this.listeners.get(type) ?? []
      bucket.push(listener)
      this.listeners.set(type, bucket)
    }
    /** 测试用：模拟原生层事件（close / error）。 */
    emit(type) {
      for (const listener of this.listeners.get(type) ?? []) listener({ type })
    }
  }
  FakeNotification.permission = permission
  FakeNotification.requestPermission = async () => {
    FakeNotification.permission = requestResult ?? permission
    return FakeNotification.permission
  }
  FakeNotification.instances = instances
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Notification')
  Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: FakeNotification })
  return {
    FakeNotification,
    instances,
    restore() {
      if (previous) Object.defineProperty(globalThis, 'Notification', previous)
      else delete globalThis.Notification
    },
  }
}

/** Same-origin sound API stub; no real network or audio playback. */
export function createSoundFetchStub({ sounds = [{ id: 'system', label: 'System default' }, { id: 'a'.repeat(32), label: 'Glass' }], status = 200 } = {}) {
  const requests = []
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'fetch')
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, 'https://dsh.example.test')
    requests.push({ url, options })
    if (url.pathname === '/api/plugins/toolkit/notification/sounds') {
      return new Response(JSON.stringify({ platform: 'darwin', sounds }), { status, headers: { 'content-type': 'application/json' } })
    }
    if (url.pathname === '/api/plugins/toolkit/notification/sound') {
      return new Response(new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 65, 86, 69]), { headers: { 'content-type': 'audio/wav' } })
    }
    // 点击通知时 client 会请求提窗路由；测试里只需成功应答，断言看 requests。
    if (url.pathname === '/api/plugins/toolkit/notification/raise') {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`unexpected notification request ${url.pathname}`)
  } })
  return {
    requests,
    sounds,
    restore() {
      if (previous) Object.defineProperty(globalThis, 'fetch', previous)
      else delete globalThis.fetch
    },
  }
}

/** 构造一段最小可用的 chat 快照：assistant 回复 + 可选 turn-error。 */
export function chatSnapshot({ reply = '', error = undefined, userText = '' } = {}) {
  const nodes = []
  if (userText !== '') {
    nodes.push({ kind: 'user', data: { content: [{ type: 'text', text: userText }], source: { kind: 'user' } } })
  }
  if (error !== undefined) {
    nodes.push({ kind: 'turn-error', data: { seq: error.seq ?? 1, message: error.message ?? 'boom' } })
  }
  if (reply !== '') {
    nodes.push({ kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: reply }] } })
  }
  return { nodes: { values: () => nodes.values() } }
}

/** 默认的表单值（与根 Config 的默认值一致，去掉宿主包装）。 */
export function defaultFormValues(overrides = {}) {
  const types = DEFAULT_SETTINGS.types
  return {
    enabled: true,
    soundEnabled: true,
    volume: 1,
    currentMode: 'unfocused',
    sound: 'system',
    scope: 'main-wait',
    completedEnabled: types.completed.enabled,
    completedSound: types.completed.sound,
    failedEnabled: types.failed.enabled,
    failedSound: types.failed.sound,
    questionEnabled: types.question.enabled,
    questionSound: types.question.sound,
    permissionEnabled: types.permission.enabled,
    permissionSound: types.permission.sound,
    ...overrides,
  }
}

/**
 * 假 ctx + 可驱动的 store。
 *
 * @param {object} [options]
 * @param {boolean} [options.withConfigForms] 是否提供 configForms（false = 只读降级）。
 * @param {boolean} [options.withServices] 是否提供服务（false = 只有 slots/locale/configForms）。
 * @param {boolean} [options.withSlots] 是否提供 slots 服务（false = 只有 locale/configForms）。
 * @param {object} [options.notification] 初始表单值覆盖。
 * @param {object} [options.sessions] 初始会话列表 `{ [id]: summary }`。
 * @param {object} [options.chats] 会话 id → chat 快照。
 * @param {object} [options.retainedBy] 会话 id → retainedBy（判断「正在读的会话」）。
 * @param {boolean|'always'|'never'|'second'|Function} [options.retainOnOpen] 打开会话时是否让主视图持有它
 *   （默认每次；'never' 用来测「导航没生效」，'second' 用来测「重试一次后成功」）。
 * @param {object} [options.agentErrors] 会话 id → lastAgentError。
 * @param {string[]} [options.archived] 已归档会话 id。
 * @param {object} [options.projections] projectionsBySession。
 */
export function createFakeContext(options = {}) {
  const effects = []
  const cleanups = []
  const localeRegistrations = []
  const sections = []
  const overlays = []
  const writes = []
  const openedSessions = []
  const unarchived = []
  const listListeners = new Set()
  const statusListeners = new Set()
  const formListeners = new Set()

  /* ── 配置表单 ─────────────────────────────────────────────────────── */
  let formValues = defaultFormValues(options.notification)
  let revision = 1
  const formSnapshot = () => ({
    value: { notification: { ...formValues } },
    status: 'ready',
    writable: true,
    revision,
  })
  const notifyForm = () => {
    for (const listener of [...formListeners]) listener()
  }
  const rootForm = {
    writable: true,
    getSnapshot: formSnapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {}
      formListeners.add(listener)
      return () => formListeners.delete(listener)
    },
    mutate(operations) {
      writes.push(operations)
      for (const operation of operations) {
        if (operation.op !== 'set') continue
        const [namespace, field] = operation.path
        if (namespace !== 'notification') continue
        formValues = { ...formValues, [field]: operation.value }
        revision += 1
      }
      notifyForm()
      return true
    },
    set(field, value) {
      return rootForm.mutate([{ op: 'set', path: ['notification', field], value }])
    },
  }

  /* ── 会话列表 / 待交互 / 对话 ──────────────────────────────────────── */
  const summaryById = new Map(Object.entries(options.sessions ?? {}))
  const statusById = new Map(Object.entries(options.statuses ?? {}))
  const chatById = options.chats ?? {}
  const agentErrors = options.agentErrors ?? {}
  const projections = options.projections ?? {}

  /** 主视图的引用数：模拟宿主在 openSession 时把会话挂到主视图。 */
  const retainCounts = new Map(
    Object.entries(options.retainedBy ?? {}).map(([id, entries]) => [id, { ...entries }]),
  )
  const openCounts = new Map()
  const retainOnOpen = options.retainOnOpen ?? 'always'
  /** 第 count 次打开时，主视图是否应该持有该会话。 */
  const retainsOnOpen = (count) => {
    if (retainOnOpen === 'never' || retainOnOpen === false) return false
    if (retainOnOpen === 'second') return count >= 2
    if (typeof retainOnOpen === 'function') return retainOnOpen(count) === true
    return true
  }

  const listSnapshot = () => ({
    ids: [...summaryById.keys()],
    byId: Object.fromEntries(summaryById),
    phase: 'ready',
    projectionsBySession: projections,
  })
  const notifyList = () => {
    for (const listener of [...listListeners]) listener()
  }
  const notifyStatus = () => {
    for (const listener of [...statusListeners]) listener()
  }

  const bindingFor = (id) => ({
    sessionId: id,
    session: {
      getSnapshot: () => ({ sessionId: id, lastAgentError: agentErrors[id] ?? null, running: summaryById.get(id)?.running === true }),
    },
  })

  const sessions = {
    list: {
      getSnapshot: listSnapshot,
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {}
        listListeners.add(listener)
        return () => listListeners.delete(listener)
      },
    },
    binding: (id) => (options.withServices === false ? undefined : bindingFor(id)),
    retainInfo: (id) => ({
      getSnapshot: () => ({ referenceCount: 0, retainedBy: { ...(retainCounts.get(id) ?? {}) } }),
      subscribe: () => () => {},
    }),
    using: async (id, _options, operation) => operation({ sessionId: id, binding: bindingFor(id), release() {} }),
  }

  const uiSession = {
    sessionStatus: {
      getSnapshot: () => new Map([...statusById].map(([id, status]) => [id, {
        running: status.running,
        pendingInteraction: status.pendingInteraction,
        completionUnread: status.completionUnread === true,
      }])),
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {}
        statusListeners.add(listener)
        return () => statusListeners.delete(listener)
      },
    },
  }

  const uiConversation = {
    binding(source) {
      const id = typeof source === 'string' ? source : source?.sessionId
      return {
        activate() {},
        target: () => ({ getSnapshot: () => chatById[id] }),
      }
    },
  }

  const uiWorkspace = {
    openSession(id) {
      openedSessions.push(id)
      const count = (openCounts.get(id) ?? 0) + 1
      openCounts.set(id, count)
      if (!retainsOnOpen(count)) return
      const current = retainCounts.get(id) ?? {}
      retainCounts.set(id, { ...current, mainView: Math.max(1, Number(current.mainView ?? 0) + 1) })
    },
    async unarchiveSession(id) {
      unarchived.push(id)
    },
  }

  const workspaces = {
    list: { getSnapshot: () => ({ archivedSessionIds: options.archived ?? [] }) },
  }

  /* ── ctx ─────────────────────────────────────────────────────────── */
  const ctx = {
    effect(run, label) {
      effects.push(label)
      const teardown = run()
      if (typeof teardown === 'function') cleanups.push(teardown)
      return teardown
    },
    locale: {
      register(namespace, dictionary) {
        localeRegistrations.push({ namespace, dictionary })
        return () => {}
      },
      bind(namespace) {
        const dictionary = namespace === 'dsh-toolkit.notification' ? NOTIFICATION_COPY.zh : {}
        return (key) => dictionary[key] ?? key
      },
    },
    slots: {
      inject(name, run) {
        if (name !== 'settings.section' && name !== 'shell.overlay') throw new Error(`unexpected slot: ${name}`)
        return run()
      },
      register(meta, Component) {
        if (meta?.name === 'shell.overlay') overlays.push({ meta, Component })
        else sections.push({ meta, Component })
        return () => {}
      },
    },
    sessions,
    uiSession,
    uiConversation,
    uiWorkspace,
    workspaces,
  }
  if (options.withConfigForms === false) {
    ctx.configForms = undefined
  } else {
    ctx.configForms = {
      get(entryId) {
        return entryId === 'shell-kit' ? rootForm : undefined
      },
    }
  }
  if (options.withServices === false) {
    ctx.sessions = undefined
    ctx.uiSession = undefined
    ctx.uiConversation = undefined
    ctx.uiWorkspace = undefined
    ctx.workspaces = undefined
  }
  // 降级宿主可能没有 slots 服务：此时卡片通道不可用，分发器应回退到系统通知。
  if (options.withSlots === false) {
    ctx.slots = undefined
  }

  return {
    ctx,
    effects,
    cleanups,
    localeRegistrations,
    sections,
    overlays,
    writes,
    openedSessions,
    unarchived,
    rootForm,
    get formValues() {
      return { ...formValues }
    },
    /** 改一个会话的 running 并发布列表快照。 */
    setRunning(id, running) {
      const previous = summaryById.get(id) ?? { id }
      summaryById.set(id, { ...previous, id, running })
      notifyList()
    },
    /** 追加/更新一个会话行并发布。 */
    setSession(id, summary) {
      summaryById.set(id, { id, ...summary })
      notifyList()
    },
    /** 覆盖待交互集合并发布。 */
    setStatuses(next) {
      statusById.clear()
      for (const [id, status] of Object.entries(next ?? {})) statusById.set(id, status)
      notifyStatus()
    },
    /** 卸载所有 effect（逆序）。 */
    dispose() {
      for (const teardown of [...cleanups].reverse()) {
        try {
          teardown()
        } catch {
          // 已清理的 effect 忽略。
        }
      }
    },
  }
}

/** 等一小段时间（含宏任务），让 settle 窗口与 React 渲染都落地。 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 供渲染用例：挂载组件到 #root，返回 root 与卸载函数。 */
export async function mountComponent(Component, props = {}) {
  const { createRoot } = await import('react-dom/client')
  const { act } = React
  const container = globalThis.document.getElementById('root')
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(Component, props))
  })
  await act(async () => {
    await sleep(10)
  })
  return {
    root,
    container,
    async unmount() {
      try {
        await act(async () => {
          root.unmount()
        })
      } catch {
        // 测试夹具可能已经先还原了 jsdom 全局；卸载失败不影响断言。
      }
    },
    async click(node) {
      await act(async () => {
        node.click()
      })
      await act(async () => {
        await sleep(10)
      })
    },
  }
}
