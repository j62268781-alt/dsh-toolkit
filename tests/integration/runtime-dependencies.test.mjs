import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))

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
