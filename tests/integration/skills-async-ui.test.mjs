import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootPanel, emptyDoc, textOf, visit } from '../skills-mcp/helpers/client-harness.mjs'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const reply = value => ({ ok: true, status: 200, json: async () => value })
const skills = ['alpha', 'beta'].map(name => ({ name, description: name, scope: 'global', source: 'user-dsh', path: `/home/skills/${name}/SKILL.md` }))

async function setup({ tab = 'Skills', timers = [] } = {}) {
  const reads = [], scans = []
  const panel = await bootPanel(emptyDoc({ discoveredSkills: skills }), {
    onTimeout: (run, ms) => timers.push({ run, ms }),
    fetch: async (url, options = {}) => {
      const target = String(url)
      if (target.includes('/skill?')) {
        const gate = deferred()
        reads.push({ ...gate, signal: options.signal, path: new URL(target, 'https://dsh.test').searchParams.get('path') })
        return gate.promise
      }
      if (target.endsWith('/import')) {
        const gate = deferred()
        scans.push({ ...gate, signal: options.signal, request: JSON.parse(options.body) })
        return gate.promise
      }
      return reply({ skills, servers: [], serverTools: [], serverStatus: [], serverToolsError: { reason: '', detail: '' }, workspaces: [{ path: '/project/a', title: 'Project A' }, { path: '/project/b', title: 'Project B' }], skillDirs: {}, oauth: {} })
    },
  })
  if (tab === 'Skills') {
    panel.click(panel.find(node => String(node.props?.className ?? '').includes('smp-tab') && textOf(node).startsWith('Skills')))
  }
  const action = (index, label) => { panel.openMenu(index); panel.click(panel.byText(label)) }
  const closeModal = () => {
    let close
    visit(panel.runtime.tree, node => { if (typeof node.type === 'function' && typeof node.props.onClose === 'function') close = node.props.onClose })
    assert.equal(typeof close, 'function', 'open modal has a close callback')
    close()
    panel.runtime.render()
  }
  const settle = async () => { for (let index = 0; index < 4; index++) await panel.settle() }
  return { panel, reads, scans, action, closeModal, settle }
}

test('Skills filter writes report rejected or absent channels and accept legacy undefined receipts', async () => {
  const row = { entryId: 'mcp-wiki', serverName: 'wiki', scope: 'global', transport: 'streamable-http', target: 'https://example.invalid/mcp', enabled: true, phase: 'active' }
  const panel = await bootPanel(emptyDoc({ profileServers: [row], serverTools: [{ serverName: 'wiki', tools: [{ name: 'mcp__wiki__read' }] }] }))
  try {
    panel.click(panel.byClass('smp-cardToggle'))
    await panel.settle()
    const before = panel.doc.runtimeFetches
    let calls = 0
    panel.runtime.props.form.set = async () => { calls++; return false }
    panel.click(panel.byText('只保留勾选'))
    await panel.settle()
    assert.equal(calls, 1)
    assert.match(panel.text(), /宿主拒绝了这次写入/)
    assert.equal(panel.doc.runtimeFetches, before, 'rejected write does not trigger success refresh')
    panel.runtime.props.form.set = async () => { calls++; return undefined }
    panel.click(panel.byText('只保留勾选'))
    await panel.settle()
    assert.equal(calls, 2)
    assert.doesNotMatch(panel.text(), /宿主拒绝了这次写入/)
    assert.ok(panel.doc.runtimeFetches > before, 'legacy accepted write refreshes runtime')
    panel.runtime.props.form.set = undefined
    panel.runtime.props.mutate = undefined
    panel.click(panel.byText('只保留勾选'))
    await panel.settle()
    assert.match(panel.text(), /当前环境没有配置写入通道/)
  } finally { panel.restore() }
})

test('Skills preview replacement aborts the old read and rejects its late body', async () => {
  const { panel, reads, action, settle } = await setup()
  try {
    action(0, '预览')
    action(1, '预览')
    assert.equal(reads.length, 2)
    assert.equal(reads[0].signal?.aborted, true)
    assert.equal(reads[1].signal?.aborted, false)
    reads[1].resolve(reply({ ok: true, body: 'CURRENT BETA BODY' }))
    await settle()
    assert.match(panel.text(), /CURRENT BETA BODY/)
    reads[0].resolve(reply({ ok: true, body: 'STALE ALPHA BODY' }))
    await settle()
    assert.match(panel.text(), /CURRENT BETA BODY/)
    assert.doesNotMatch(panel.text(), /STALE ALPHA BODY/)
  } finally { panel.restore() }
})

test('Skills preview close and timeout invalidate transport and ignore late results', async () => {
  const timers = []
  const { panel, reads, action, closeModal, settle } = await setup({ timers })
  try {
    action(0, '预览')
    closeModal()
    assert.equal(reads[0].signal?.aborted, true)
    reads[0].resolve(reply({ ok: true, body: 'CLOSED PREVIEW BODY' }))
    await settle()
    assert.doesNotMatch(panel.text(), /CLOSED PREVIEW BODY/)
    action(1, '预览')
    const timeout = timers.filter(timer => timer.ms === 15000).at(-1)
    assert.ok(timeout, 'preview has a 15-second read deadline')
    timeout.run()
    panel.runtime.render()
    assert.equal(reads[1].signal?.aborted, true)
    reads[1].resolve(reply({ ok: true, body: 'EXPIRED PREVIEW BODY' }))
    await settle()
    assert.doesNotMatch(panel.text(), /EXPIRED PREVIEW BODY/)
  } finally { panel.restore() }
})

test('Skills editing cancellation protects the next draft and its pending state', async () => {
  const { panel, reads, action, settle } = await setup()
  try {
    action(0, '编辑')
    panel.click(panel.byText('取消'))
    assert.equal(reads[0].signal?.aborted, true)
    action(1, '编辑')
    reads[0].resolve(reply({ ok: true, body: 'STALE EDIT BODY' }))
    await settle()
    assert.doesNotMatch(String(panel.find(node => node.type === 'textarea')?.props.value), /STALE EDIT BODY/)
    assert.ok(panel.find(node => node.type === 'button' && node.props.disabled === true && /保存/.test(textOf(node))), 'the second read is still pending')
    reads[1].resolve(reply({ ok: true, body: 'CURRENT EDIT BODY' }))
    await settle()
    assert.equal(panel.find(node => node.type === 'textarea')?.props.value, 'CURRENT EDIT BODY')
    assert.equal(panel.byText('保存')?.props.disabled, false)
  } finally { panel.restore() }
})

test('Import scope and project changes abort scans and require the whole target to match', async () => {
  const { panel, scans, settle } = await setup({ tab: 'MCP' })
  try {
    panel.click(panel.byText('选择来源'))
    panel.click(panel.byText('扫描'))
    panel.click(panel.byText('项目级'))
    assert.equal(scans[0].signal?.aborted, true)
    const projectPicker = () => panel.find(node => node.type === 'select' && ['', '/project/a', '/project/b'].includes(node.props.value))
    panel.change(projectPicker(), '/project/a')
    panel.click(panel.byText('扫描'))
    panel.change(projectPicker(), '/project/b')
    assert.equal(scans[1].signal?.aborted, true)
    panel.click(panel.byText('扫描'))
    scans[2].resolve(reply({ ok: true, source: 'claude', scope: 'project', project: '/project/b', files: [], servers: [{ serverName: 'PROJECT_B_SCAN' }], error: '' }))
    await settle()
    assert.match(panel.text(), /PROJECT_B_SCAN/)
    scans[1].resolve(reply({ ok: true, source: 'claude', scope: 'project', project: '/project/a', files: [], servers: [{ serverName: 'STALE_PROJECT_A_SCAN' }], error: '' }))
    scans[0].resolve(reply({ ok: true, source: 'claude', scope: 'global', project: '', files: [], servers: [{ serverName: 'STALE_GLOBAL_SCAN' }], error: '' }))
    await settle()
    assert.match(panel.text(), /PROJECT_B_SCAN/)
    assert.doesNotMatch(panel.text(), /STALE_PROJECT_A_SCAN|STALE_GLOBAL_SCAN/)
    panel.change(projectPicker(), '/project/a')
    assert.doesNotMatch(panel.text(), /PROJECT_B_SCAN|STALE_PROJECT_A_SCAN/)
  } finally { panel.restore() }
})

test('Import source changes and collapse invalidate scans without restoring stale results', async () => {
  const { panel, scans, settle } = await setup({ tab: 'MCP' })
  try {
    panel.click(panel.byText('选择来源'))
    panel.click(panel.byText('扫描'))
    const sourcePicker = () => panel.find(node => node.type === 'select' && ['claude', 'codex'].includes(node.props.value))
    panel.change(sourcePicker(), 'codex')
    assert.equal(scans[0].signal?.aborted, true)
    panel.click(panel.byText('扫描'))
    scans[1].resolve(reply({ ok: true, source: 'codex', scope: 'global', project: '', files: [], servers: [{ serverName: 'CURRENT_SCAN' }], error: '' }))
    await settle()
    assert.match(panel.text(), /CURRENT_SCAN/)
    scans[0].resolve(reply({ ok: true, source: 'claude', scope: 'global', project: '', files: [], servers: [{ serverName: 'STALE_SCAN' }], error: '' }))
    await settle()
    assert.match(panel.text(), /CURRENT_SCAN/)
    panel.change(sourcePicker(), 'claude')
    assert.doesNotMatch(panel.text(), /STALE_SCAN/)
    panel.click(panel.byText('扫描'))
    panel.click(panel.byText('收起'))
    assert.equal(scans[2].signal?.aborted, true)
    scans[2].resolve(reply({ ok: true, source: 'claude', scope: 'global', project: '', files: [], servers: [{ serverName: 'CLOSED_SCAN' }], error: '' }))
    await settle()
    panel.click(panel.byText('选择来源'))
    assert.doesNotMatch(panel.text(), /CLOSED_SCAN|STALE_SCAN/)
  } finally { panel.restore() }
})
