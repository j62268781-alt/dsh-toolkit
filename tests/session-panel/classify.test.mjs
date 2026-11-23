import assert from 'node:assert/strict'
import { test } from 'node:test'
import { baseName, classifyCall, dirName, hostOf } from '../../src/modules/session-panel/host/domain/classify.js'

test('skill 与 MCP 能力各归其位', () => {
  assert.deepEqual(classifyCall('skill', { skill: 'browser-use' }), [
    { kind: 'capability', id: 'skill:browser-use', label: 'browser-use', detail: 'Skill' },
  ])
  // 同一个 server 的多个工具合并成一条「来源」：id 只到 server，细节不再区分工具。
  assert.deepEqual(classifyCall('mcp__node-repl__node_repl', {}), [
    { kind: 'capability', id: 'mcp:node-repl', label: 'node-repl', detail: '' },
  ])
  // 工具名里再带双下划线也不影响合并。
  assert.deepEqual(classifyCall('mcp__srv__a__b', {}), [
    { kind: 'capability', id: 'mcp:srv', label: 'srv', detail: '' },
  ])
  assert.deepEqual(
    classifyCall('mcp__srv__other_tool', {}).map((seed) => seed.id),
    ['mcp:srv'],
    '同 server 的不同工具落到同一个 id，聚合时就是一行',
  )
})

test('知识类 MCP 与内置检索进知识分区', () => {
  const [seed] = classifyCall('mcp__plugin_qoder-qmind_qoder-qmind__retrieve', { query: '支付模块' })
  assert.equal(seed.kind, 'knowledge')
  assert.equal(seed.label, '支付模块')
  assert.match(seed.detail, /retrieve/)
  const [builtin] = classifyCall('search_knowledge', { query: '架构' })
  assert.equal(builtin.kind, 'knowledge')
  assert.equal(builtin.label, '架构')
  const [workspace] = classifyCall('SearchWorkspace', { requirements: '找路由' })
  assert.equal(workspace.kind, 'knowledge')
  assert.equal(workspace.label, '找路由')
})

test('浏览器 MCP 导航与 web_fetch 进网页查阅，搜索单独成条', () => {
  const [nav] = classifyCall('mcp__browser-use__navigate_page', { url: 'https://example.com/a' })
  assert.deepEqual(nav, { kind: 'web', id: 'url:https://example.com/a', label: 'example.com', detail: 'https://example.com/a', target: 'https://example.com/a' })
  const [fetch] = classifyCall('web_fetch', { url: 'https://example.com/b' })
  assert.equal(fetch.kind, 'web')
  assert.equal(fetch.target, 'https://example.com/b')
  const [search] = classifyCall('web_search', { query: 'cordis 事件' })
  assert.deepEqual(search, { kind: 'web', id: 'search:cordis 事件', label: 'cordis 事件', detail: 'web_search' })
  // 浏览器服务但不是导航动作：仍算能力，不算打开网页。
  const [other] = classifyCall('mcp__browser-use__take_screenshot', {})
  assert.equal(other.kind, 'capability')
})

test('写工具与 present 进产出', () => {
  // 反斜杠统一成 `/`：同一文件在 Windows 路径与 POSIX 路径下是同一个 id。
  const [write] = classifyCall('write', { file_path: 'D:\\repo\\src\\a.ts' })
  assert.deepEqual(write, { kind: 'artifact', id: 'artifact:D:/repo/src/a.ts', label: 'a.ts', detail: 'D:/repo/src', target: 'D:/repo/src/a.ts' })
  const [edit] = classifyCall('Edit', { path: '/repo/b.md' })
  assert.equal(edit.kind, 'artifact')
  assert.equal(edit.label, 'b.md')
  const presented = classifyCall('present', { files: [{ path: '/repo/c.png' }, { path: '' }, null, { path: '/repo/d.pdf' }] })
  assert.deepEqual(presented.map((seed) => seed.label), ['c.png', 'd.pdf'])
})

test('归不了类的调用返回空数组，不造垃圾条目', () => {
  assert.deepEqual(classifyCall('bash', { command: 'ls' }), [])
  assert.deepEqual(classifyCall('todo_write', {}), [])
  assert.deepEqual(classifyCall('', {}), [])
  assert.deepEqual(classifyCall(undefined, {}), [])
  assert.deepEqual(classifyCall('write', {}), [])
  assert.deepEqual(classifyCall('web_fetch', { url: '  ' }), [])
  assert.deepEqual(classifyCall('read', null), [])
})

test('路径与主机名工具函数', () => {
  assert.equal(baseName('D:\\repo\\src\\a.ts'), 'a.ts')
  assert.equal(baseName('/repo/b.md'), 'b.md')
  assert.equal(baseName('plain'), 'plain')
  assert.equal(dirName('D:\\repo\\src\\a.ts'), 'D:/repo/src')
  assert.equal(dirName('/b.md'), '')
  assert.equal(hostOf('https://example.com/x'), 'example.com')
  assert.equal(hostOf('not a url'), 'not a url')
})