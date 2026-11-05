import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { JSDOM } from 'jsdom'
import { ThemeCenterPanel } from '../../src/modules/theme/client/settings-theme.jsx'

async function renderPanel(t, { palette = 'ocean', preference = 'light', writable = true, save } = {}) {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>')
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root'))
  const writes = []
  const modeWrites = []
  const paletteListeners = new Set()
  const themeListeners = new Set()
  let themeSnapshot = { preference, colorScheme: preference === 'dark' ? 'dark' : 'light' }
  const form = {
    writable,
    getSnapshot: () => ({ value: { palette } }),
    subscribe(listener) { paletteListeners.add(listener); return () => paletteListeners.delete(listener) },
    async set(field, value) {
      writes.push([field, value])
      const accepted = save ? await save(value) : true
      if (accepted === false) return false
      palette = value
      for (const listener of paletteListeners) listener()
      return accepted
    },
  }
  const theme = {
    getTheme: () => themeSnapshot,
    async setTheme(value) {
      modeWrites.push(value)
      themeSnapshot = { preference: value, colorScheme: value === 'dark' ? 'dark' : 'light' }
      for (const listener of themeListeners) listener()
    },
  }
  await React.act(async () => root.render(React.createElement(ThemeCenterPanel, {
    form, theme, subscribeTheme(listener) { themeListeners.add(listener); return () => themeListeners.delete(listener) },
  })))
  t.after(async () => {
    await React.act(async () => root.unmount())
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const radio = label => document.querySelector(`[role="radio"][aria-label="${label}"]`)
  const selected = group => [...document.querySelectorAll(`[role="radiogroup"][aria-label="${group}"] [aria-checked="true"]`)].map(node => node.getAttribute('aria-label'))
  return {
    writes, modeWrites, radio, selected,
    click: async label => { assert.ok(radio(label)); await React.act(async () => radio(label).click()) },
    systemColor: async colorScheme => {
      await React.act(async () => {
        themeSnapshot = { ...themeSnapshot, colorScheme }
        for (const listener of themeListeners) listener()
      })
    },
  }
}

test('color mode and style stay independently selected across all twelve combinations', async t => {
  const panel = await renderPanel(t)
  const palettes = ['原始 DSH', 'Codex', '大海蓝鲸', '昼夜流光']
  const modes = ['浅色', '深色', '跟随系统']
  assert.equal(document.querySelectorAll('[role="radiogroup"]').length, 2)
  assert.equal(document.querySelectorAll('[role="radio"]').length, 7)
  for (const palette of palettes) {
    const beforeModeWrites = panel.modeWrites.length
    await panel.click(palette)
    assert.equal(panel.modeWrites.length, beforeModeWrites, 'style selection never writes native color mode')
    assert.deepEqual(panel.selected('主题风格'), [palette])
    for (const mode of modes) {
      const beforePaletteWrites = panel.writes.length
      await panel.click(mode)
      assert.equal(panel.writes.length, beforePaletteWrites, 'color mode never writes palette config')
      assert.deepEqual(panel.selected('颜色模式'), [mode])
      assert.deepEqual(panel.selected('主题风格'), [palette])
    }
  }
  await panel.systemColor('dark')
  assert.deepEqual(panel.selected('颜色模式'), ['跟随系统'])
  assert.deepEqual(panel.selected('主题风格'), ['昼夜流光'])
  for (const preview of document.querySelectorAll('[data-preview-palette]')) {
    assert.equal(preview.dataset.previewMode, 'dark', 'system changes refresh every style preview')
  }
})

test('rejected async palette writes keep the selected style and show the error', async t => {
  let response = false
  const panel = await renderPanel(t, { save: async () => {
    await Promise.resolve()
    if (response instanceof Error) throw response
    return response
  } })
  await panel.click('昼夜流光')
  assert.deepEqual(panel.selected('主题风格'), ['大海蓝鲸'])
  assert.match(document.querySelector('[role="status"]').textContent, /宿主拒绝/)
  response = new Error('保存失败')
  await panel.click('昼夜流光')
  assert.deepEqual(panel.selected('主题风格'), ['大海蓝鲸'])
  assert.match(document.querySelector('[role="status"]').textContent, /保存失败/)
  response = undefined
  await panel.click('昼夜流光')
  assert.deepEqual(panel.selected('主题风格'), ['昼夜流光'])
  assert.equal(document.querySelector('[role="status"]'), null)
})

test('read-only palette config does not disable the independent native color mode', async t => {
  const panel = await renderPanel(t, { writable: false })
  assert.equal(panel.radio('昼夜流光').disabled, true)
  assert.equal(panel.radio('深色').disabled, false)
  await panel.click('深色')
  assert.deepEqual(panel.selected('颜色模式'), ['深色'])
  assert.deepEqual(panel.selected('主题风格'), ['大海蓝鲸'])
  assert.deepEqual(panel.writes, [])
})
