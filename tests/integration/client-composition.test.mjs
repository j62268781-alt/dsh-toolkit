import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import React from 'react'

const CLIENT = new URL('../../lib/client.js', import.meta.url)
const EXPECTED_INJECT = {
  'dsh-toolkit-theme-client': ['layout', 'slots', 'locale', 'configForms', 'theme'],
  'dsh-toolkit-archived-client': ['slots', 'locale', 'sessions', 'workspaces'],
  'dsh-toolkit-skills-mcp-client': ['slots', 'configForms', 'remote', 'remote.pluginInventory'],
  'dsh-toolkit-judgment-client': ['slots', 'configForms', 'remote', 'remote.credentials'],
  'dsh-toolkit-mobile-client': ['slots', 'sidebarRightTabs'],
  'dsh-toolkit-notification-client': ['slots', 'locale', 'configForms', 'sessions', 'uiSession', 'uiConversation', 'uiWorkspace', 'workspaces'],
  'dsh-toolkit-boot-client': ['slots', 'configForms'],
  'dsh-toolkit-pet-client': ['slots', 'locale', 'configForms', 'uiWorkspace', 'workspaces', 'sessions'],
  'dsh-toolkit-remote-client': ['locale'],
  'dsh-toolkit-hooks-client': ['slots', 'locale'],
  'dsh-toolkit-git-client': ['slots', 'locale', 'configForms'],
  'dsh-toolkit-session-panel-client': ['slots', 'locale'],
  'dsh-toolkit-worktrees-client': ['slots', 'locale', 'configForms'],
}
const ALL_SERVICES = new Set([
  ...Object.values(EXPECTED_INJECT).flat(), 'sidebarRight', 'shortcuts', 'uiSession', 'uiConversation', 'uiWorkspace',
])
const IMMEDIATE_EFFECTS = new Set([
  'dsh-toolkit-theme:settings-section',
  // Archived registers its dictionary through the shared bridge (generic label) and
  // mounts its settings page as one of several surfaces.
  'locale shell-kit.archived',
  'dsh-toolkit-archived:settings',
  'dsh-toolkit-notification:dictionary',
  'dsh-toolkit-notification:section',
  'dsh-toolkit-pet:dictionary',
  'dsh-toolkit-pet:section',
  'dsh-toolkit-mobile:tab-type',
  'dsh-toolkit-mobile:tab-body',
  'dsh-toolkit-mobile:tab-title',
  // 钩子页只读配置：注册 section 与图标都不需要 DOM 或网络。
  'dsh-toolkit-hooks:settings',
  'dsh-toolkit-hooks:settings-icon',
  // Git 页注册 section 只需要 slots + locale；骨架样式与图标效果要 DOM，留给宿主。
  'dsh-toolkit-git:settings',
  // composer 里的分支按钮：注册只是 slots.inject，弹层与样式在真正挂载时才要 DOM。
  'dsh-toolkit-git:branch-chip',
  // 任务监控只注册官方会话面板分区；样式留给宿主挂载。
  'locale shell-kit.session-panel',
  'dsh-toolkit-session-panel:session-panel',
])

async function loadClient() {
  const registrations = []
  const required = []
  const warnings = []
  const primitives = {
    Button: () => null,
    Switch: () => null,
    Tooltip: () => null,
    IconChevronDownOutlineRegular: () => null,
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (spec) => registrations.push(spec) } },
    console: { warn: (...args) => warnings.push(args) },
    fetch() { assert.fail('registration smoke tests must not start network requests') },
  }
  Object.defineProperty(sandbox, 'document', {
    get() { assert.fail('registration smoke tests must defer DOM effects') },
  })
  vm.runInNewContext(await readFile(CLIENT, 'utf8'), sandbox, { filename: CLIENT.pathname, timeout: 1000 })
  assert.equal(registrations.length, 1, 'the shared artifact registers exactly one classic client module')
  const [spec] = registrations
  assert.equal(spec.id, 'dsh-toolkit')
  assert.equal(typeof spec.factory, 'function')
  const client = spec.factory((id) => {
    required.push(id)
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    // react-dom and react-dom/client are Host seed modules: portal for the popover,
    // createRoot for the account-row icon mount.
    if (id === 'react-dom') return { createPortal: (node) => node }
    if (id === 'react-dom/client') return { createRoot: () => ({ render() {}, unmount() {} }) }
    assert.fail(`unexpected Host module dependency: ${id}`)
  })
  return { client, primitives, required, warnings }
}

/**
 * A small dependency-aware plugin host. It runs the actual bundled apply
 * functions, guards declared services, and defers effects that need the DOM or
 * network. Archived page and mobile tab registration effects execute.
 */
async function boot({ missing = [], missingSlots = [] } = {}) {
  const loaded = await loadClient()
  const available = new Set(ALL_SERVICES)
  for (const name of missing) available.delete(name)
  const children = []
  const active = []
  const pending = []
  const effects = []
  const registrations = []
  const tabTypes = []
  const mounted = []
  const trace = []
  const writes = []
  const remoteServices = new Map()
  const inventory = { marker: 'plugin-inventory' }
  const credentials = { marker: 'credentials' }
  const locale = {
    register() { return () => {} },
    bind(namespace) {
      if (namespace === 'shell-kit.archived') return (key) => ({ nav: '已归档的聊天', title: '已归档的聊天' }[key] ?? key)
      if (namespace === 'shell-kit.hooks') return (key) => ({ nav: '钩子', title: '钩子' }[key] ?? key)
      if (namespace === 'shell-kit.git') return (key) => ({ nav: 'Git', title: 'Git' }[key] ?? key)
      if (namespace === 'shell-kit.session-panel') return (key) => ({ sectionCapability: '技能与 MCP', sectionWeb: '网页查阅', sectionArtifact: '产出', sectionSource: '来源' }[key] ?? key)
      return (key) => key
    },
  }
  const value = {
    judgement: { connections: { main: {} } },
    skillsMcp: { toolFilters: { disabled: [] }, mcpRows: [] },
    git: { branchPrefix: '', alwaysForcePush: false, commitInstructions: '' },
  }
  const rootForm = {
    getSnapshot: () => snapshot,
    set() { assert.fail('bundled scoped forms must use mutate for a nested path') },
    unset() { assert.fail('bundled scoped forms must use mutate for a nested path') },
    mutate(operations, revision) { writes.push({ operations, revision }); return false },
  }
  const snapshot = { value, status: 'ready', writable: true, revision: 12 }
  const tasks = []

  function contextFor(plugin, requirements = plugin.inject) {
    const allowed = new Set(requirements)
    const ctx = {
      get: (name) => remoteServices.get(name),
      effect(run, label) {
        effects.push({ plugin: plugin.name, label })
        if (IMMEDIATE_EFFECTS.has(label)) return run()
        return () => {}
      },
      inject(names, run) {
        if (names.every((name) => available.has(name))) {
          return run(contextFor(plugin, [...allowed, ...names]))
        }
      },
    }
    const slots = {
      inject(name, run) {
        assert.ok(
          ['settings.section', 'conversation.input.left', 'conversation.session.panel.section'].includes(name),
          `unexpected slot ${name}`,
        )
        if (missingSlots.includes(name)) return () => {}
        return run()
      },
      register(registration, Component) {
        trace.push(`${plugin.name}:slot:${registration.id ?? registration.name}`)
        registrations.push({ plugin: plugin.name, registration, Component })
        return () => {}
      },
    }
    const remote = new Proxy({
      credentials,
      pluginInventory: inventory,
      async $mount(contribution) {
        mounted.push({ plugin: plugin.name, contribution })
        const namespaces = new Set(contribution.descriptors.map(({ namespace }) => namespace))
        for (const namespace of namespaces) {
          remoteServices.set(`remote.${namespace}`, { marker: namespace })
          trace.push(`${plugin.name}:mount:${namespace}`)
        }
      },
    }, {
      get(target, key) {
        if (key === 'credentials' || key === 'pluginInventory') {
          assert.ok(allowed.has(`remote.${key}`), `${plugin.name} must inject remote.${key}`)
        }
        return target[key]
      },
    })
    const services = {
      slots,
      configForms: { get: (entryId) => entryId === 'shell-kit' ? rootForm : undefined },
      remote,
      sidebarRightTabs: { register(definition) { tabTypes.push(definition); return () => {} } },
      locale,
    }
    return new Proxy(ctx, {
      get(target, key) {
        if (key in target) return target[key]
        assert.ok(allowed.has(key), `${plugin.name} accessed ${String(key)} without injection`)
        assert.ok(available.has(key), `${plugin.name} accessed unavailable service ${String(key)}`)
        return services[key] ?? {}
      },
    })
  }

  loaded.client.apply({
    plugin(plugin) {
      children.push(plugin)
      if (!plugin.inject.every((name) => available.has(name))) {
        pending.push(plugin.name)
        return
      }
      tasks.push(Promise.resolve(plugin.apply(contextFor(plugin))).then(() => active.push(plugin.name)))
    },
  })
  await Promise.all(tasks)
  return { ...loaded, children, active, pending, effects, registrations, tabTypes, mounted, trace, writes, value, rootForm, inventory, credentials, remoteServices }
}

test('the real classic factory uses only Host seed modules and mounts thirteen separate plugins', async () => {
  const { client, required, warnings } = await loadClient()
  assert.deepEqual(Array.from(client.inject), [])
  assert.equal(typeof client.apply, 'function')
  const children = []
  client.apply({ plugin: (plugin) => children.push(plugin) })
  assert.deepEqual(children.map(({ name }) => name), Object.keys(EXPECTED_INJECT))
  for (const plugin of children) {
    assert.deepEqual(Array.from(plugin.inject), EXPECTED_INJECT[plugin.name])
    assert.equal(typeof plugin.apply, 'function')
  }
  // react-dom and react-dom/client are Host seed modules: portal for the popover and
  // createRoot for the icon mounted into the sidebar account row.
  assert.deepEqual([...new Set(required)].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react', 'react-dom', 'react-dom/client'])
  assert.deepEqual(warnings, [])
})

test('the unified bundle registers the original settings pages, Remote faces, and mobile tab', async () => {
  const result = await boot()
  assert.equal(result.children.length, 13)
  assert.equal(result.active.length, 13)
  assert.deepEqual(result.pending, [])
  assert.deepEqual(result.warnings, [])
  const sections = result.registrations.filter(({ registration }) => registration.name === 'settings.section')
  assert.deepEqual(sections.map(({ registration }) => registration.id).sort(), ['archived-chats', 'boot', 'desktop-pet', 'git', 'hooks', 'judgment', 'notification', 'skills-mcp', 'theme'])

  const expected = {
    'archived-chats': { namespace: 'shell-kit.archived', order: 40, label: '已归档的聊天' },
    boot: { namespace: 'boot', order: 7, label: '启动动画' },
    judgment: { namespace: 'judgement', order: 21, label: '决策' },
    notification: { namespace: 'notification', order: 9, label: '通知' },
    'desktop-pet': { namespace: 'pet', order: 8, label: '桌面宠物' },
    'skills-mcp': { namespace: 'skillsMcp', order: 20, label: 'Skills & MCP' },
    hooks: { namespace: 'shell-kit.hooks', order: 23, label: '钩子' },
    git: { namespace: 'git', order: 24, label: 'Git' },
    theme: { namespace: 'theme', order: 6, label: '外观' },
  }
  for (const { registration, Component } of sections) {
    const definition = expected[registration.id]
    assert.equal(typeof Component, 'function')
    assert.equal(registration.order, definition.order)
    assert.equal(registration.label(), definition.label)
    if (registration.id === 'hooks') {
      // 钩子页只读配置：自己带 locale，不需要注入任何 form/remote face。
      assert.equal(registration.locale, 'shell-kit.hooks')
      assert.equal(registration.inject, undefined)
      continue
    }
    if (registration.id === 'archived-chats') {
      assert.equal(registration.locale, 'shell-kit.archived')
      assert.equal(registration.inject, undefined)
      continue
    }
    if (registration.id === 'desktop-pet') {
      assert.equal(registration.locale, 'dsh-toolkit.pet')
      assert.equal(registration.inject, undefined)
      continue
    }
    if (registration.id === 'notification') {
      // The notification page reads the scoped form inside apply, subscribes to the
      // config form itself, and needs no Remote/configForm registration face.
      assert.equal(registration.locale, 'dsh-toolkit.notification')
      assert.equal(registration.inject, undefined)
      continue
    }
    if (registration.id === 'boot') {
      // The boot page resolves its form in apply and injects it directly.
      const face = registration.inject()
      assert.ok(face.form)
      assert.equal(face.form.getSnapshot().status, 'ready')
      assert.equal(face.form.set('probe-field', false, 12), false)
      const bootWrite = result.writes.at(-1)
      assert.deepEqual(Array.from(bootWrite.operations[0].path), ['boot', 'probe-field'])
      assert.equal(bootWrite.revision, 12)
      continue
    }
    if (registration.id === 'theme') {
      // The appearance page resolves its form and the native theme service in apply.
      const face = registration.inject()
      assert.ok(face.form)
      assert.equal(typeof face.subscribeTheme, 'function')
      assert.equal(face.form.set('probe-field', false, 12), false)
      const themeWrite = result.writes.at(-1)
      assert.deepEqual(Array.from(themeWrite.operations[0].path), ['theme', 'probe-field'])
      assert.equal(themeWrite.revision, 12)
      continue
    }
    const face = registration.inject()
    assert.equal(face.entryId, 'shell-kit')
    assert.notEqual(face.form, result.rootForm)
    assert.equal(face.form.getSnapshot().value, result.value[definition.namespace])
    assert.equal(face.form.getSnapshot(), face.form.getSnapshot())
    assert.equal(face.form.set('probe-field', false, 12), false)
    const write = result.writes.at(-1)
    assert.deepEqual(Array.from(write.operations[0].path), [definition.namespace, 'probe-field'])
    assert.equal(write.revision, 12)
  }
  const faces = Object.fromEntries(sections.filter(({ registration }) => registration.inject).map(({ registration }) => [registration.id, registration.inject()]))
  assert.equal(faces.judgment.primitives, result.primitives)
  assert.equal(faces.judgment.credentials, result.credentials)
  assert.equal(faces['skills-mcp'].inventory, result.inventory)
  assert.equal(faces.judgment.judgment, result.remoteServices.get('remote.judgment'))
  assert.notEqual(faces.judgment.form, faces['skills-mcp'].form)

  // 只有 judgment 自检需要先挂 Remote（浏览器模块的 installCli 已随模块删除）。
  assert.equal(result.mounted.length, 1)
  for (const { plugin, contribution } of result.mounted) {
    const namespace = contribution.descriptors[0].namespace
    assert.ok(result.trace.indexOf(`${plugin}:mount:${namespace}`) < result.trace.indexOf(`${plugin}:slot:${namespace}`), 'self-check Remote must mount before its settings page')
  }

  assert.equal(result.tabTypes.length, 1)
  const branchSeats = result.registrations.filter(({ registration }) => registration.name === 'conversation.input.left')
  assert.deepEqual(branchSeats.map(({ registration }) => registration.id), ['dsh-toolkit.git.branch'])
  const [mobile] = result.tabTypes
  assert.equal(mobile.id, '@j62268781-alt/dsh-sidebar-mobile')
  assert.equal(mobile.kind, 'mobile')
  assert.equal(mobile.title(), '移动设备')
  assert.equal(mobile.multiple, false)
  assert.equal(mobile.keepMounted, true)
  assert.equal(mobile.guide[0].commandId, 'sidebar.mobile')
  const mobileSeats = result.registrations.filter(({ plugin }) => plugin === 'dsh-toolkit-mobile-client')
  assert.deepEqual(mobileSeats.map(({ registration }) => registration.name), ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
  for (const { registration, Component } of mobileSeats) {
    assert.equal(registration.key, mobile.id)
    assert.equal(typeof Component, 'function')
  }
  // 任务监控只向官方会话面板注册这四个分区。
  const taskMonitorSeats = result.registrations.filter(({ plugin }) => plugin === 'dsh-toolkit-session-panel-client')
  assert.deepEqual(taskMonitorSeats.map(({ registration: { name, id, order, label, locale }, Component }) => [name, id, order, label(), locale, typeof Component]), [
    ['conversation.session.panel.section', 'dsh-toolkit-session-panel.capability', 310, '技能与 MCP', 'shell-kit.session-panel', 'function'],
    ['conversation.session.panel.section', 'dsh-toolkit-session-panel.web', 320, '网页查阅', 'shell-kit.session-panel', 'function'],
    ['conversation.session.panel.section', 'dsh-toolkit-session-panel.artifact', 330, '产出', 'shell-kit.session-panel', 'function'],
    ['conversation.session.panel.section', 'dsh-toolkit-session-panel.source', 340, '来源', 'shell-kit.session-panel', 'function'],
  ])
  assert.ok(result.effects.some(({ label }) => label === 'dsh-toolkit-session-panel:stylesheet'))
  assert.ok(result.effects.some(({ label }) => label === 'dsh-toolkit-theme:stylesheet'))
  assert.ok(result.effects.some(({ label }) => label === 'dsh-toolkit-archived:stylesheet'))
  assert.ok(result.effects.some(({ label }) => label === 'dsh-toolkit-notification:dictionary'))
  assert.ok(result.effects.some(({ label }) => label === 'dsh-toolkit-notification:section'))
  assert.ok(result.effects.some(({ label }) => label === 'dsh-toolkit-mobile:panel-open-poll'))
})

test('without the official session panel slot Task Monitor does not register a fallback surface', async () => {
  const result = await boot({ missingSlots: ['conversation.session.panel.section'] })
  assert.ok(result.active.includes('dsh-toolkit-session-panel-client'))
  assert.ok(!result.registrations.some(({ plugin }) => plugin === 'dsh-toolkit-session-panel-client'))
})

test('missing archived session services leave theme, other pages, and the mobile tab active', async () => {
  const result = await boot({ missing: ['sessions'] })
  // pet 客户端现在也读 sessions（主视图切会话时上报已读），缺该服务时与其他会话相关插件一起等待。
  assert.deepEqual(result.pending, ['dsh-toolkit-archived-client', 'dsh-toolkit-notification-client', 'dsh-toolkit-pet-client'])
  assert.equal(result.active.length, 10)
  assert.deepEqual(result.registrations.filter(({ registration }) => registration.name === 'settings.section').map(({ registration }) => registration.id).sort(), ['boot', 'git', 'hooks', 'judgment', 'skills-mcp', 'theme'])
  assert.equal(result.tabTypes.length, 1)
  assert.equal(result.effects.some(({ plugin }) => plugin === 'dsh-toolkit-theme-client'), true)
  assert.equal(result.effects.some(({ plugin }) => plugin === 'dsh-toolkit-archived-client'), false)
  assert.equal(result.effects.some(({ plugin }) => plugin === 'dsh-toolkit-pet-client'), false)
})

test('nested Remote dependencies block only the client that declares them', async () => {
  for (const [dependency, pending, absentSection] of [
    ['remote.pluginInventory', 'dsh-toolkit-skills-mcp-client', 'skills-mcp'],
    ['remote.credentials', 'dsh-toolkit-judgment-client', 'judgment'],
  ]) {
    const result = await boot({ missing: [dependency] })
    assert.deepEqual(result.pending, [pending])
    assert.equal(result.active.length, 12)
    const sections = result.registrations.filter(({ registration }) => registration.name === 'settings.section')
    assert.equal(sections.length, 8)
    assert.equal(sections.some(({ registration }) => registration.id === absentSection), false)
    assert.equal(sections.some(({ registration }) => registration.id === 'theme'), true)
    assert.equal(result.tabTypes.length, 1)
  }
})

test('missing settings forms or mobile tab services do not suspend unrelated children', async () => {
  const withoutForms = await boot({ missing: ['configForms'] })
  assert.deepEqual(withoutForms.pending, ['dsh-toolkit-theme-client', 'dsh-toolkit-skills-mcp-client', 'dsh-toolkit-judgment-client', 'dsh-toolkit-notification-client', 'dsh-toolkit-boot-client', 'dsh-toolkit-pet-client', 'dsh-toolkit-git-client', 'dsh-toolkit-worktrees-client'])
  assert.deepEqual(withoutForms.active.sort(), ['dsh-toolkit-archived-client', 'dsh-toolkit-hooks-client', 'dsh-toolkit-mobile-client', 'dsh-toolkit-remote-client', 'dsh-toolkit-session-panel-client'])
  assert.equal(withoutForms.tabTypes.length, 1)

  const withoutTabs = await boot({ missing: ['sidebarRightTabs'] })
  assert.deepEqual(withoutTabs.pending, ['dsh-toolkit-mobile-client'])
  assert.equal(withoutTabs.active.length, 12)
  assert.equal(withoutTabs.tabTypes.length, 0)
  assert.equal(withoutTabs.registrations.length, 14)
})
