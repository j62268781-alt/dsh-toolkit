/**
 * Integration test: the usage client half inside the real bundled artifact.
 *
 * Contract: docs/usage/README.md ("Client 端"). Loads `lib/client.js` in a vm
 * sandbox exactly like tests/integration/client-composition.test.mjs and drives
 * the 7th child plugin (`toolkit-usage-client`) against a fake Cordis context.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'
import React from 'react'

const CLIENT = new URL('../../lib/client.js', import.meta.url)
const NS = 'dsh-toolkit.usage'
const EXPECTED_INJECT = ['slots', 'locale', 'configForms']

/** Minimal functional DOM so deferred effects (stylesheet install) can run. */
function fakeDocument() {
  const head = {
    children: [],
    appendChild(node) { this.children.push(node); node.parentNode = this; return node },
  }
  const document = {
    accesses: 0,
    head,
    documentElement: head,
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        dataset: {},
        textContent: '',
        parentNode: null,
        remove() {
          const siblings = document.head.children
          const index = siblings.indexOf(this)
          if (index >= 0) siblings.splice(index, 1)
        },
      }
    },
  }
  return document
}

async function loadArtifact({ dom = fakeDocument() } = {}) {
  const registrations = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (spec) => registrations.push(spec) } },
    console: { warn: () => {} },
    fetch() { assert.fail('usage client registration must not start network requests') },
  }
  const documentProxy = {
    get head() { dom.accesses += 1; return dom.head },
    get documentElement() { dom.accesses += 1; return dom.documentElement },
    createElement(tag) {
      dom.accesses += 1
      return dom.createElement(tag)
    },
  }
  Object.defineProperty(sandbox, 'document', { get: () => documentProxy })
  vm.runInNewContext(await readFile(CLIENT, 'utf8'), sandbox, { filename: CLIENT.pathname, timeout: 1000 })
  assert.equal(registrations.length, 1, 'the shared artifact registers exactly one classic client module')
  const [spec] = registrations
  assert.equal(spec.id, 'dsh-toolkit')
  const client = spec.factory((id) => {
    if (id === 'react') return React
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
    assert.fail(`unexpected Host module dependency: ${id}`)
  })
  return { client, spec, dom }
}

function bootUsage(client) {
  const children = []
  client.apply({ plugin: (plugin) => children.push(plugin) })
  const child = children.find(({ name }) => name === 'toolkit-usage-client')
  assert.ok(child, 'the shared factory must mount a toolkit-usage-client child')

  const effects = []
  const registrations = []
  const localeRegistrations = []
  const boundNamespaces = new Set()
  const mountNames = []
  const teardowns = []
  const fetchCalls = []
  const rootForm = {
    getSnapshot: () => snapshot,
    mutate(operations, revision) {
      writes.push({ operations, revision })
      return false
    },
  }
  const writes = []
  const snapshot = { value: { usage: { budget: 42, currency: 'CNY', period: 'month', historyDays: 14, refreshMs: 8000, includeSubagents: true, prices: [] } }, status: 'ready', writable: true, revision: 7 }
  const locale = {
    register(namespace, dictionary) {
      localeRegistrations.push({ namespace, dictionary })
      return () => {}
    },
    bind(namespace) {
      boundNamespaces.add(namespace)
      return (key) => `${namespace}:${key}`
    },
  }
  const ctx = {
    effect(run, label) {
      effects.push(label)
      const teardown = run()
      if (typeof teardown === 'function') teardowns.push(teardown)
      return () => {}
    },
    inject(names, run) {
      if (names.every((name) => ['slots', 'locale', 'configForms'].includes(name))) return run()
    },
    slots: {
      inject(name, run) {
        assert.ok(name === 'sidebar.panellist' || name === 'main', `unexpected usage slot: ${name}`)
        return run()
      },
      register(registration, Component) {
        registrations.push({ registration, Component })
        return () => {}
      },
    },
    configForms: { get: (entryId) => entryId === 'shell-kit' ? rootForm : undefined },
    locale,
  }
  child.apply(ctx)
  return { child, effects, registrations, localeRegistrations, boundNamespaces, mountNames, teardowns, fetchCalls, rootForm, writes, snapshot }
}

test('the usage client keeps its documented position and inject contract', async () => {
  const { client, dom } = await loadArtifact()
  assert.deepEqual(Array.from(client.inject), [])
  const children = []
  client.apply({ plugin: (plugin) => children.push(plugin) })
  assert.equal(dom.accesses, 0, 'registering the child list must not touch the DOM')
  assert.equal(children.length, 8, 'exactly eight separate child plugins')
  assert.deepEqual(children.map(({ name }) => name), [
    'toolkit-theme-client',
    'toolkit-archived-client',
    'toolkit-skills-mcp-client',
    'toolkit-judgment-client',
    'toolkit-browser-client',
    'toolkit-mobile-client',
    'toolkit-usage-client',
    // Appended after usage so the indexes above stay stable.
    'toolkit-notification-client',
  ])
  const usage = children[6]
  assert.deepEqual(Array.from(usage.inject), EXPECTED_INJECT)
  assert.equal(typeof usage.apply, 'function')
})

test('the usage child registers the left-sidebar entry and the main panel', async () => {
  const { client, dom } = await loadArtifact()
  const result = bootUsage(client)
  assert.deepEqual(result.fetchCalls, [], 'apply must not start network requests')

  // Left sidebar icon, directly below 自动化任务 (schedules, order 10).
  const icons = result.registrations.filter(({ registration }) => registration.name === 'sidebar.panellist')
  assert.equal(icons.length, 1, 'exactly one left-sidebar entry')
  const [{ registration: icon, Component: Icon }] = icons
  assert.equal(icon.id, 'usage-tokens')
  assert.equal(icon.order, 11)
  assert.equal(typeof icon.label, 'function')
  assert.equal(typeof Icon, 'function')

  // The main-column panel uses the same key, so clicking the icon opens it.
  const panels = result.registrations.filter(({ registration }) => registration.name === 'main')
  assert.equal(panels.length, 1, 'exactly one main panel')
  const [{ registration: panel, Component }] = panels
  assert.equal(panel.key, 'usage-tokens')
  assert.equal(typeof Component, 'function')
  assert.equal(
    result.registrations.some(({ registration }) => registration.name === 'settings.section'),
    false,
    'the usage page must not live in Settings',
  )

  // The label must come from the usage locale namespace, not a hardcoded string.
  const label = icon.label()
  assert.equal(typeof label, 'string')
  assert.ok(label.length > 0)
  assert.ok(
    result.boundNamespaces.has(NS),
    `the sidebar label must be bound to locale namespace ${NS}`,
  )
  assert.ok(
    result.localeRegistrations.some(({ namespace, dictionary }) => namespace === NS && dictionary && Object.keys(dictionary).length > 0),
    `a non-empty locale dictionary must be registered for ${NS}`,
  )

  // The contract requires a separate stylesheet installed under the module id.
  const style = dom.head.children.find((node) => node.dataset?.plugin === 'toolkit-usage')
  assert.ok(style, 'stylesheet must be installed with installStylesheet(css, "toolkit-usage")')
  assert.ok(String(style.textContent).length > 0, 'stylesheet must contain CSS')
  assert.ok(String(style.textContent).includes('usg-'), 'usage CSS must use the usg- class prefix')
  // Theme variables only: no hardcoded primitive colours in the usage CSS.
  assert.doesNotMatch(String(style.textContent), /#[0-9a-fA-F]{3,8}\b/, 'usable theme must not hardcode hex colours')
  assert.doesNotMatch(String(style.textContent), /\brgba?\(\s*\d+\s*,/, 'theme must not hardcode rgb() colours')

  // Effects own their cleanup so the page cannot leak on reload.
  for (const teardown of result.teardowns) teardown()
  assert.equal(dom.head.children.includes(style), false, 'stylesheet teardown must remove the style tag')
})

test('a missing settings form degrades to read-only instead of crashing', async () => {
  const { client } = await loadArtifact()
  const children = []
  client.apply({ plugin: (plugin) => children.push(plugin) })
  const usage = children[6]
  const registrations = []
  const ctx = {
    effect(run) { const teardown = run(); if (typeof teardown === 'function') teardowns.push(teardown); return () => {} },
    slots: {
      inject(name, run) { return run() },
      register(registration, Component) { registrations.push({ registration, Component }); return () => {} },
    },
    configForms: { get: () => undefined },
    locale: { register: () => () => {}, bind: (ns) => (key) => `${ns}:${key}` },
    inject(names, run) { return run() },
  }
  const teardowns = []
  usage.apply(ctx)
  const [panel] = registrations.filter(({ registration }) => registration.name === 'main')
  assert.ok(panel, 'the main panel must still register without configForms')
  assert.equal(panel.registration.key, 'usage-tokens')
  for (const teardown of teardowns) teardown()
})
