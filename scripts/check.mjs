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
run(['scripts/verify-client.mjs'])
run(['tests/skills-mcp/helpers/undefined-check.mjs'])
