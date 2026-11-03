/** Check the package entry, emitted syntax, theme contracts and upstream JS names. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Script } from 'node:vm'
import { fileURLToPath } from 'node:url'

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
assert.equal(typeof toolkit.Config, 'function')
assert.deepEqual(toolkit.inject, [])

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

// Archived settings page: the search field must keep the built-in plugin
// inventory geometry (PluginInventorySettingsTab.module.css), and the list uses
// the 15/14/12 title scale with the 恢复 / 删除 actions.
for (const pattern of [
  /\.sk-searchInput\s*\{[^}]*height:\s*36px/,
  /\.sk-searchInput\s*\{[^}]*border:\s*\.5px solid var\(--dsw-alias-border-l4\)/,
  /\.sk-searchInput\s*\{[^}]*padding:\s*0 34px 0 36px/,
  /\.sk-searchInput:focus-visible\s*\{[^}]*box-shadow:/,
  /\.sk-arch__groupTitle\s*\{[^}]*font-size:\s*15px/,
  /\.sk-arch__rowTitle\s*\{[^}]*font-size:\s*14px/,
  /\.sk-arch__rowTime\s*\{[^}]*font-size:\s*12px/,
]) {
  assert.match(client, pattern)
}
assert.doesNotMatch(client, /sk-arch__search/)
for (const copy of [
  '搜索、恢复或永久删除已归档的会话。',
  '永久删除 {w} 个工作区和 {t} 个任务？',
  '此操作会从本机移除全部已归档工作区及其任务，以及单独归档的任务，之后不能从 dsh 恢复。',
  '归档“{t}”？',
  '它会离开当前任务列表，保留在设置里的已归档的聊天中；之后你可以在那里永久删除。',
]) {
  assert.ok(client.includes(copy), `archived copy missing: ${copy}`)
}
console.log('Archived settings copy, search geometry and title scale checked')
run(['scripts/verify-client.mjs'])
run(['tests/skills-mcp/helpers/undefined-check.mjs'])
