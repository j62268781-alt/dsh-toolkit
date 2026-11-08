/** Check the package entry, emitted syntax, theme contracts and upstream JS names. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Check failed (${result.signal ?? result.status}): ${args.join(' ')}`)
}
const walk = async (directory) => {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files.sort()
}

const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const toolkit = await import('../index.js')
assert.equal(manifest.name, 'dsh-toolkit')
assert.equal(toolkit.name, manifest.name)
assert.equal(typeof toolkit.apply, 'function')
assert.deepEqual(toolkit.inject, [])
assert.equal(manifest.dsh?.client, undefined, 'the aggregate package must not mount a duplicate client bundle')

const moduleNames = ['boot', 'theme', 'archived', 'browser', 'judgment', 'mobile', 'skills-mcp', 'notification', 'pet', 'weixin-clawbot']
for (const name of moduleNames) {
  const moduleRoot = join(root, 'packages', name)
  const packageManifest = JSON.parse(await readFile(join(moduleRoot, 'package.json'), 'utf8'))
  assert.equal(packageManifest.name, `dsh-toolkit-${name}`)
  assert.equal(packageManifest.dsh?.bundle?.patch, './cordis.patch.yml')
  const plugin = await import(pathToFileURL(join(moduleRoot, 'index.js')).href)
  const hostEntry = plugin.default
  assert.ok(typeof hostEntry === 'function' || typeof hostEntry?.apply === 'function', `${name} must export a Cordis plugin`)
  assert.equal(packageManifest.dsh?.client?.platform, 'web')
  assert.ok(packageManifest.dsh?.client?.inject?.length > 0)
  const built = await readFile(join(moduleRoot, 'lib', 'client.js'), 'utf8')
  assert.match(built, new RegExp(`id: "dsh-toolkit-${name}"`))
  new Script(built, { filename: `packages/${name}/lib/client.js` })
}
const aggregateDeps = manifest.dependencies ?? {}
for (const name of moduleNames) assert.equal(aggregateDeps[`dsh-toolkit-${name}`], 'workspace:^')

const client = await readFile(join(root, 'lib/client.js'), 'utf8')
new Script(client, { filename: 'lib/client.js' })
assert.equal((client.match(/window\.__ModuleLoader__\.load\(/g) ?? []).length, 1)
assert.match(client, /id: "dsh-toolkit"/)
assert.doesNotMatch(client, /__CLIENT_CSS__|__SVG:|__SVGURI:/)
for (const path of await walk(join(root, 'lib'))) {
  if (path.endsWith('.js')) run(['--check', path])
}
for (const path of await walk(join(root, 'scripts'))) {
  if (path.endsWith('.mjs')) run(['--check', path])
}
console.log('Package entry, single client loader and generated JS syntax checked')

// Archived settings page: the search field keeps the built-in plugin inventory
// geometry (PluginInventorySettingsTab.module.css), the project filter copies the
// Skills & MCP select, and the list uses the 15/14/12 title scale.
for (const pattern of [
  /\.sk-searchInput\s*\{[^}]*height:\s*36px/,
  /\.sk-searchInput\s*\{[^}]*border:\s*\.5px solid var\(--dsw-alias-border-l4\)/,
  /\.sk-searchInput\s*\{[^}]*padding:\s*0 34px 0 36px/,
  /\.sk-searchInput:focus-visible\s*\{[^}]*box-shadow:/,
  /\.sk-arch__select\s*\{[^}]*appearance:\s*none/,
  /\.sk-arch__select\s*\{[^}]*background-position:\s*right 10px center/,
  /\.sk-arch__select\s*\{[^}]*border:\s*0?\.5px solid var\(--dsw-alias-border-l3\)/,
  /\.sk-arch__removeAll\s*\{[^}]*white-space:\s*nowrap/,
  /\.sk-arch__groupTitle\s*\{[^}]*font-size:\s*15px/,
  /\.sk-arch__rowTitle\s*\{[^}]*font-size:\s*14px/,
  /\.sk-arch__rowTime\s*\{[^}]*font-size:\s*12px/,
]) {
  assert.match(client, pattern)
}
assert.doesNotMatch(client, /sk-arch__search/)
assert.doesNotMatch(client, /全部恢复|Restore all/, 'the header bulk restore action was removed')
assert.doesNotMatch(client, /永久删除 \{w\}|个工作区和 \d|个工作区和 \{t\}/, 'the archived module no longer deletes workspaces')
for (const copy of [
  '已归档的会话',
  '搜索、恢复或永久删除已归档的会话。',
  '永久删除 {t} 个会话？',
  '此操作会从本机移除全部已归档会话，之后不能从 dsh 恢复。',
  '归档“{t}”？',
  '它会离开当前任务列表，保留在设置里的已归档的会话中；之后你可以在那里永久删除。',
]) {
  assert.ok(client.includes(copy), `archived copy missing: ${copy}`)
}
assert.ok(client.includes('个会话'), 'archived counters use 会话 instead of 聊天')
console.log('Archived settings copy, search geometry and title scale checked')
run(['scripts/verify-client.mjs'])
run(['tests/skills-mcp/helpers/undefined-check.mjs'])
