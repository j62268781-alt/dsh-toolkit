import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { JSDOM } from 'jsdom'
import { ThemeCenterPanel } from '../../src/modules/theme/client/settings-theme.tsx'

// 宿主快照的真实形状：解析后的明暗只出现在 active.colorScheme，顶层没有 colorScheme。
const hostSnapshot = (preference, colorScheme = preference === 'dark' ? 'dark' : 'light') => ({
  preference,
  fontSizes: {},
  fontFamilies: {},
  active: { id: colorScheme, colorScheme, tokens: {} },
  themes: [{ id: 'light', colorScheme: 'light', tokens: {} }, { id: 'dark', colorScheme: 'dark', tokens: {} }],
  revision: 1,
})

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
  let themeSnapshot = hostSnapshot(preference)
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
      themeSnapshot = hostSnapshot(value)
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
  // 页面顶部的大预览 + 五张风格卡片的缩略图，都带 data-preview-palette。
  const previewModes = () => [...document.querySelectorAll('[data-preview-palette]')].map(node => node.dataset.previewMode)
  const windowMode = () => document.querySelector('.sk-theme-preview-window').dataset.previewMode
  return {
    writes, modeWrites, radio, selected, previewModes, windowMode,
    click: async label => { assert.ok(radio(label)); await React.act(async () => radio(label).click()) },
    systemColor: async colorScheme => {
      await React.act(async () => {
        themeSnapshot = { ...themeSnapshot, active: { ...themeSnapshot.active, id: colorScheme, colorScheme } }
        for (const listener of themeListeners) listener()
      })
    },
  }
}

test('color mode and style stay independently selected across all fifteen combinations', async t => {
  const panel = await renderPanel(t)
  const palettes = ['原始 DSH', 'Codex', '大海蓝鲸', '夕阳红', '赛博朋克2077']
  const modes = ['浅色', '深色', '跟随系统']
  assert.equal(document.querySelectorAll('[role="radiogroup"]').length, 2)
  assert.equal(document.querySelectorAll('[role="radio"]').length, 8)
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
  assert.deepEqual(panel.selected('主题风格'), ['赛博朋克2077'])
  assert.equal(panel.windowMode(), 'dark', 'the page preview follows the scheme the host resolved')
  for (const mode of panel.previewModes()) {
    assert.equal(mode, 'dark', 'system changes refresh every style preview')
  }
})

test('a dark preference renders the page preview dark from the first frame', async t => {
  const panel = await renderPanel(t, { preference: 'dark' })
  assert.equal(panel.windowMode(), 'dark')
  assert.deepEqual(panel.previewModes(), ['dark', 'dark', 'dark', 'dark', 'dark', 'dark'])
  await panel.click('浅色')
  assert.equal(panel.windowMode(), 'light')
  assert.deepEqual(panel.previewModes(), ['light', 'light', 'light', 'light', 'light', 'light'])
})

test('rejected async palette writes keep the selected style and report through the toast channel', async t => {
  let response = false
  const panel = await renderPanel(t, { save: async () => {
    await Promise.resolve()
    if (response instanceof Error) throw response
    return response
  } })
  // 一次性的失败告知走 body 上的 toast 栈：它不该在页面里常驻一行、把下面的卡片推上推下。
  const toastText = () => document.querySelector('.sk-toast-stack')?.textContent ?? ''
  await panel.click('夕阳红')
  assert.deepEqual(panel.selected('主题风格'), ['大海蓝鲸'])
  assert.match(toastText(), /宿主拒绝/)
  assert.equal(document.querySelector('.sk-theme-status'), null)
  response = new Error('保存失败')
  await panel.click('夕阳红')
  assert.deepEqual(panel.selected('主题风格'), ['大海蓝鲸'])
  assert.match(toastText(), /保存失败/)
  response = undefined
  await panel.click('夕阳红')
  assert.deepEqual(panel.selected('主题风格'), ['夕阳红'])
  assert.equal(document.querySelector('.sk-theme-status'), null)
  assert.doesNotMatch(document.body.textContent, /正在保存/)
})

test('read-only palette config does not disable the independent native color mode', async t => {
  const panel = await renderPanel(t, { writable: false })
  assert.equal(panel.radio('夕阳红').disabled, true)
  assert.equal(panel.radio('深色').disabled, false)
  await panel.click('深色')
  assert.deepEqual(panel.selected('颜色模式'), ['深色'])
  assert.deepEqual(panel.selected('主题风格'), ['大海蓝鲸'])
  assert.deepEqual(panel.writes, [])
})
