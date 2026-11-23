import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { draftFromRow } from '../../src/modules/skills-mcp/client/crud/servers.js'
import { serverFormView } from '../../src/modules/skills-mcp/client/views/serverForm.jsx'

globalThis.__dshReact = React

test('服务器表单只为按需启动的服务器显示手动更新工具清单开关', () => {
  const label = '手动更新工具清单'
  let draft = { serverName: 'alpha' }
  const getControl = (name) => {
    const controls = new Map()
    serverFormView({
      tier: { tier: 'global' }, editing: { kind: 'mcp', tier: 'global' },
      draft, setDraft: (next) => { draft = next }, scopeDraft: {}, projectChoices: [],
      switchControl: (checked, onChange, label) => { controls.set(label, { checked, onChange }) },
    })
    return controls.get(name)
  }
  assert.equal(getControl(label), undefined)
  assert.equal(getControl('按需启动（懒加载）'), undefined)
  draft = draftFromRow({ serverName: 'alpha', lazy: true })
  assert.equal(getControl(label).checked, false)
  getControl(label).onChange(true)
  assert.equal(getControl(label).checked, true)
  assert.equal(draft.serverName, 'alpha')

  draft = draftFromRow({ serverName: 'beta', lazy: true, manualToolCache: true })
  assert.equal(getControl(label).checked, true)
  getControl(label).onChange(false)
  assert.equal(draft.manualToolCache, false)
  assert.equal(draft.lazy, true)
  draft = draftFromRow({ serverName: 'legacy', lazy: false })
  assert.equal(getControl(label), undefined)
})

test('服务器表单只在按需启动时显示单一 MCP 入口开关，并保留已保存的设置', () => {
  const label = '合并为单一 MCP 入口'
  let draft = draftFromRow({ serverName: 'alpha' })
  const getControls = () => {
    const controls = new Map()
    serverFormView({
      tier: { tier: 'global' }, editing: { kind: 'mcp', tier: 'global' },
      draft, setDraft: (next) => { draft = next }, scopeDraft: {}, projectChoices: [],
      switchControl: (checked, onChange, label) => { controls.set(label, { checked, onChange }) },
    })
    return controls
  }
  assert.equal(getControls().has(label), false)
  draft = draftFromRow({ serverName: 'alpha', lazy: true })
  assert.equal(getControls().get(label).checked, false)
  getControls().get(label).onChange(true)
  assert.equal(draft.singleMcpEntry, true)
  assert.equal(draft.serverName, 'alpha')
  draft = draftFromRow({ serverName: 'beta', lazy: true, singleMcpEntry: true })
  assert.equal(getControls().get(label).checked, true)
  getControls().get(label).onChange(false)
  assert.equal(draft.singleMcpEntry, false)
})
