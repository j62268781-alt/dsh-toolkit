import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const modules = ['boot', 'theme', 'archived', 'browser', 'judgment', 'mobile', 'skills-mcp', 'notification', 'pet']

test('the plugin consumes DSH runtime packages without installing another core copy', () => {
  const runtime = Object.keys(manifest.devDependencies).filter((name) => name.startsWith('@deepseek-ai/'))
  assert.ok(runtime.includes('@deepseek-ai/dsh-scope'))
  assert.ok(runtime.includes('@deepseek-ai/dsh-system-prompt'))
  for (const name of runtime) {
    assert.equal(manifest.dependencies?.[name], undefined, `${name} must come from the host`)
    assert.equal(typeof manifest.peerDependencies?.[name], 'string', `${name} needs a host compatibility range`)
    assert.equal(manifest.peerDependenciesMeta?.[name]?.optional, true, `${name} must not be auto-installed`)
  }
})

test('each module declares optional DSH peers and only its own runtime dependencies', async () => {
  for (const name of modules) {
    const pkg = JSON.parse(await readFile(new URL(`../../packages/${name}/package.json`, import.meta.url), 'utf8'))
    for (const peer of Object.keys(pkg.peerDependencies ?? {})) {
      assert.equal(pkg.dependencies?.[peer], undefined, `${name}: ${peer} must come from the host`)
      assert.equal(pkg.peerDependenciesMeta?.[peer]?.optional, true, `${name}: ${peer} must be optional`)
      assert.match(pkg.peerDependencies[peer], /[~^*><|]/, `${name}: ${peer} must use a compatibility range`)
    }
    if (name === 'skills-mcp') assert.equal(typeof pkg.dependencies?.yaml, 'string')
    else if (name === 'pet') assert.deepEqual(pkg.dependencies, { '@electron/get': '^3.1.0', 'extract-zip': '^2.0.1' })
    else assert.deepEqual(pkg.dependencies ?? {}, {}, `${name} must not add unrelated runtime packages`)
  }
})
