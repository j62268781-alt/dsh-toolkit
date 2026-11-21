import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from 'yaml'

const root = new URL('../../', import.meta.url)
const combo = new URL('packages/git-task-monitor/', root)
const modules = ['git', 'task-monitor']
const ids = modules.map((name) => `dsh-toolkit-${name}`)
const text = (path, base = root) => readFile(new URL(path, base), 'utf8')
const json = async (path, base) => JSON.parse(await text(path, base))
const patch = async (path, base) => parse(await text(path, base))

// Use the same Cordis composition implementation, not an id-deduplicating mock.
const { applyEntryPatches } = createRequire(import.meta.resolve('@deepseek-ai/cordis'))('@deepseek-ai/cordis-plugin-include')

async function loadCombo() {
  const manifest = await json('package.json', combo)
  assert.equal(manifest.name, 'dsh-toolkit-git-task-monitor')
  assert.equal(manifest.dsh.client, undefined, 'only the two component rows load clients')
  assert.equal(manifest.dependencies, undefined, 'the tarball carries both module closures')
  return patch(manifest.dsh.bundle.patch, combo)
}

test('切换后两条 Cordis 条目保留配置和开关；不能与旧声明叠加', async () => {
  const combination = await loadCombo()
  assert.deepEqual(combination, [{ insert: modules.map((name, index) => ({
    id: ids[index], name: `./lib/${name}/index.js`,
  })) }])
  const standalone = await Promise.all(modules.map((name) => patch(`packages/${name}/cordis.patch.yml`)))
  const aggregate = await patch('cordis.patch.yml')
  assert.equal((await json('package.json')).dependencies['dsh-toolkit-git-task-monitor'], undefined)
  const overrides = [
    { id: ids[0], config: { branchPrefix: 'team/', alwaysForcePush: true, commitInstructions: 'Use Chinese.' } },
    { id: ids[1], config: { enabled: false }, disabled: true },
  ]
  const compose = (source) => applyEntryPatches([], [...source, ...overrides], (message) => assert.fail(message))
  const migrated = compose(combination)
  assert.deepEqual(migrated, combination[0].insert.map((entry, index) => ({ ...entry, ...overrides[index] })))
  for (const old of [standalone.flat(), aggregate]) {
    assert.deepEqual(compose(old).filter(({ id }) => ids.includes(id)).map(({ name, ...entry }) => entry), overrides)
    const duplicates = applyEntryPatches([], [...old, ...combination], (message) => assert.fail(message))
    for (const id of ids) assert.equal(duplicates.filter((row) => row.id === id).length, 2)
  }
})

test('两个包内入口仍独立解析到原有 Host 和 Client', async () => {
  const [{ insert }] = await loadCombo()
  for (const [index, row] of insert.entries()) {
    const standalone = new URL(`packages/${modules[index]}/`, root)
    const entryUrl = new URL(row.name, combo)
    const expected = await json('package.json', standalone)
    // File-based DSH rows resolve browser metadata beside each Host wrapper.
    const manifest = await json('package.json', entryUrl)
    assert.equal(manifest.name, row.id)
    assert.deepEqual(manifest.dsh, { client: expected.dsh.client })
    assert.deepEqual(manifest.exports, expected.exports)
    const plugin = (await import(entryUrl.href)).default
    const original = (await import(new URL('index.js', standalone).href)).default
    assert.equal(plugin.name, row.id)
    assert.deepEqual(plugin.inject, original.inject)
    assert.deepEqual(plugin.Config.dict && Object.keys(plugin.Config.dict), original.Config.dict && Object.keys(original.Config.dict))
    assert.equal(typeof plugin.apply, 'function')
    const code = await text(manifest.exports['./client'], entryUrl)
    assert.equal(code, await text(expected.exports['./client'], standalone))
    const clientIds = []
    runInNewContext(code, { window: { __ModuleLoader__: { load: ({ id }) => clientIds.push(id) } } })
    assert.deepEqual(clientIds, [row.id])
  }
})

test('包内 Git 保留工具名，任务监控读取独立包的数据', async (t) => {
  const tools = []
  const { default: git } = await import(new URL('lib/git/index.js', combo).href)
  git.apply({
    inject(names, run) {
      if (names[0] === 'tools') run({ effect: (apply) => apply(), tools: { register: ({ name }) => tools.push(name) } })
    },
    on() {},
  })
  assert.deepEqual(tools.sort(), ['git_branch_create', 'git_branch_delete', 'git_branch_rename', 'git_commit', 'git_push', 'git_sync'])

  const home = await mkdtemp(join(tmpdir(), 'dsh-combo-monitor-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const storePath = 'lib/modules/task-monitor/host/domain/store.js'
  const standalone = await import(new URL(`packages/task-monitor/${storePath}`, root).href)
  const original = standalone.createTaskMonitorStore({ home })
  await original.addSource('existing-session', 'url', 'https://example.com/history')
  await original.dispose()
  const embedded = await import(new URL(`lib/task-monitor/${storePath}`, combo).href)
  const result = await embedded.createTaskMonitorStore({ home }).snapshot('existing-session')
  assert.equal(result.ok, true)
  assert.deepEqual(result.entries.map(({ detail, manual }) => ({ detail, manual })), [
    { detail: 'https://example.com/history', manual: true },
  ])
})
