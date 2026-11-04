import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import React from 'react'

const CLIENT = new URL('../../lib/client.js', import.meta.url)
const EXPECTED_INJECT = {
  'toolkit-theme-client': ['layout', 'slots', 'locale'],
  'toolkit-archived-client': ['slots', 'locale', 'sessions', 'workspaces'],
  'toolkit-skills-mcp-client': ['slots', 'configForms', 'remote', 'remote.pluginInventory'],
  'toolkit-judgment-client': ['slots', 'configForms', 'remote', 'remote.credentials'],
  'toolkit-browser-client': ['slots', 'configForms', 'remote'],
  'toolkit-mobile-client': ['slots', 'sidebarRightTabs'],
  'toolkit-notification-client': ['slots', 'locale', 'configForms', 'sessions', 'uiSession', 'uiConversation', 'uiWorkspace', 'workspaces'],
}
const ALL_SERVICES = new Set([
  ...Object.values(EXPECTED_INJECT).flat(), 'sidebarRight', 'shortcuts', 'uiSession', 'uiConversation', 'uiWorkspace',
])
const IMMEDIATE_EFFECTS = new Set([
  'toolkit-archived:dictionary',
  'toolkit-archived:section',
  'toolkit-notification:dictionary',
  'toolkit-notification:section',
  'dsh-sidebar-mobile:tab-type',
  'dsh-sidebar-mobile:tab-body',
  'dsh-sidebar-mobile:tab-title',
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
    assert.fail(`unexpected Host module dependency: ${id}`)
  })
  return { client, primitives, required, warnings }
}

/**
 * A small dependency-aware plugin host. It runs the actual bundled apply
 * functions, guards declared services, and defers effects that need the DOM or
 * network. Archived page and mobile tab registration effects execute.
 */
async function boot({ missing = [] } = {}) {
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
    bind(namespace) { return (key) => namespace === 'shell-kit.archived' ? ({ nav: '已归档的聊天', title: '已归档的聊天' }[key] ?? key) : key },
  }
  const value = {
    browser: { enabled: false, tools: { read: true } },
    judgement: { connections: { main: {} } },
    skillsMcp: { toolFilters: { disabled: [] }, mcpRows: [] },
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
        assert.equal(name, 'settings.section')
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

test('the real classic factory uses only Host seed modules and mounts seven separate plugins', async () => {
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
  assert.deepEqual([...new Set(required)].sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react'])
  assert.deepEqual(warnings, [])
})

test('the unified bundle registers the original settings pages, Remote faces, and mobile tab', async () => {
  const result = await boot()
  assert.equal(result.children.length, 7)
  assert.equal(result.active.length, 7)
  assert.deepEqual(result.pending, [])
  assert.deepEqual(result.warnings, [])
  const sections = result.registrations.filter(({ registration }) => registration.name === 'settings.section')
  assert.deepEqual(sections.map(({ registration }) => registration.id).sort(), ['archived-chats', 'browser', 'judgment', 'notification', 'skills-mcp'])

  const expected = {
    'archived-chats': { namespace: 'shell-kit.archived', order: 20, label: '已归档的聊天' },
    browser: { namespace: 'browser', order: 22, label: '浏览器' },
    judgment: { namespace: 'judgement', order: 21, label: '决策' },
    notification: { namespace: 'notification', order: 24, label: '通知' },
    'skills-mcp': { namespace: 'skillsMcp', order: 20, label: 'Skills & MCP' },
  }
  for (const { registration, Component } of sections) {
    const definition = expected[registration.id]
    assert.equal(typeof Component, 'function')
    assert.equal(registration.order, definition.order)
    assert.equal(registration.label(), definition.label)
    if (registration.id === 'archived-chats') {
      assert.equal(registration.locale, 'shell-kit.archived')
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
  assert.equal(faces.browser.primitives, result.primitives)
  assert.equal(faces.judgment.primitives, result.primitives)
  assert.equal(faces.judgment.credentials, result.credentials)
  assert.equal(faces['skills-mcp'].inventory, result.inventory)
  assert.equal(faces.browser.browser, result.remoteServices.get('remote.browser'))
  assert.equal(faces.judgment.judgment, result.remoteServices.get('remote.judgment'))
  assert.notEqual(faces.browser.form, faces.judgment.form)
  assert.notEqual(faces.browser.form, faces['skills-mcp'].form)

  assert.equal(result.mounted.length, 2)
  for (const { plugin, contribution } of result.mounted) {
    const namespace = contribution.descriptors[0].namespace
    assert.ok(result.trace.indexOf(`${plugin}:mount:${namespace}`) < result.trace.indexOf(`${plugin}:slot:${namespace}`), 'self-check Remote must mount before its settings page')
  }

  assert.equal(result.tabTypes.length, 1)
  const [mobile] = result.tabTypes
  assert.equal(mobile.id, '@j62268781-alt/dsh-sidebar-mobile')
  assert.equal(mobile.kind, 'mobile')
  assert.equal(mobile.title(), '移动设备')
  assert.equal(mobile.multiple, false)
  assert.equal(mobile.keepMounted, true)
  assert.equal(mobile.guide[0].commandId, 'sidebar.mobile')
  const mobileSeats = result.registrations.filter(({ plugin }) => plugin === 'toolkit-mobile-client')
  assert.deepEqual(mobileSeats.map(({ registration }) => registration.name), ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title'])
  for (const { registration, Component } of mobileSeats) {
    assert.equal(registration.key, mobile.id)
    assert.equal(typeof Component, 'function')
  }
  assert.ok(result.effects.some(({ label }) => label === 'toolkit-theme:stylesheet'))
  assert.ok(result.effects.some(({ label }) => label === 'toolkit-archived:stylesheet'))
  assert.ok(result.effects.some(({ label }) => label === 'toolkit-notification:dictionary'))
  assert.ok(result.effects.some(({ label }) => label === 'toolkit-notification:section'))
  assert.ok(result.effects.some(({ label }) => label === 'dsh-sidebar-mobile:panel-open-poll'))
})

test('missing archived session services leave theme, other pages, and the mobile tab active', async () => {
  const result = await boot({ missing: ['sessions'] })
  assert.deepEqual(result.pending, ['toolkit-archived-client', 'toolkit-notification-client'])
  assert.equal(result.active.length, 5)
  assert.deepEqual(result.registrations.filter(({ registration }) => registration.name === 'settings.section').map(({ registration }) => registration.id).sort(), ['browser', 'judgment', 'skills-mcp'])
  assert.equal(result.tabTypes.length, 1)
  assert.equal(result.effects.some(({ plugin }) => plugin === 'toolkit-theme-client'), true)
  assert.equal(result.effects.some(({ plugin }) => plugin === 'toolkit-archived-client'), false)
})

test('nested Remote dependencies block only the client that declares them', async () => {
  for (const [dependency, pending, absentSection] of [
    ['remote.pluginInventory', 'toolkit-skills-mcp-client', 'skills-mcp'],
    ['remote.credentials', 'toolkit-judgment-client', 'judgment'],
  ]) {
    const result = await boot({ missing: [dependency] })
    assert.deepEqual(result.pending, [pending])
    assert.equal(result.active.length, 6)
    const sections = result.registrations.filter(({ registration }) => registration.name === 'settings.section')
    assert.equal(sections.length, 4)
    assert.equal(sections.some(({ registration }) => registration.id === absentSection), false)
    assert.equal(sections.some(({ registration }) => registration.id === 'browser'), true)
    assert.equal(result.tabTypes.length, 1)
  }
})

test('missing settings forms or mobile tab services do not suspend unrelated children', async () => {
  const withoutForms = await boot({ missing: ['configForms'] })
  assert.deepEqual(withoutForms.pending, ['toolkit-skills-mcp-client', 'toolkit-judgment-client', 'toolkit-browser-client', 'toolkit-notification-client'])
  assert.deepEqual(withoutForms.active.sort(), ['toolkit-archived-client', 'toolkit-mobile-client', 'toolkit-theme-client'])
  assert.equal(withoutForms.tabTypes.length, 1)

  const withoutTabs = await boot({ missing: ['sidebarRightTabs'] })
  assert.deepEqual(withoutTabs.pending, ['toolkit-mobile-client'])
  assert.equal(withoutTabs.active.length, 6)
  assert.equal(withoutTabs.tabTypes.length, 0)
  assert.equal(withoutTabs.registrations.length, 5)
})
