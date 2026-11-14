import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, readdir, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { migratePatch, MODULE_NAMESPACES, ROOT_IDS } from '../../src/host/migration.ts'
import { main, migrateYaml } from '../../scripts/migrate-config.mjs'

const moduleId = (name) => `dsh-toolkit-${name}`
const last = (rows, id) => rows.filter((row) => row.id === id).at(-1)

// Mirror the verified DSH rules: insert creates entries; top-level patches
// override existing entry fields, including replacing config as a whole.
function apply(rows, patches) {
  const output = structuredClone(rows)
  const index = new Map()
  const scan = (entries) => entries.forEach((entry) => { index.set(entry.id, entry); if (entry.group) scan(entry.config) })
  scan(output)
  for (const patch of patches) {
    if (patch.insert) {
      const destination = patch.id ? index.get(patch.id)?.config : output
      if (!destination) continue
      destination.push(...structuredClone(patch.insert))
      scan(destination)
    } else {
      const entry = index.get(patch.id)
      if (!entry || (patch.name && entry.name !== patch.name)) continue
      for (const [key, value] of Object.entries(patch)) if (!['id', 'name'].includes(key)) entry[key] = structuredClone(value)
    }
  }
  return output
}

for (const rootId of ROOT_IDS) test(`migrates ${rootId} top-level overrides and preserves unknown root data`, () => {
  const input = [{ id: rootId, config: { browser: { enabled: true }, judgement: { connections: { main: { model: 'x' } } }, skillsMcp: { toolFilters: {} }, shell: { retained: true }, custom: 42 }, note: 'keep' }, { id: 'unrelated', disabled: true, config: { keep: true } }]
  const original = structuredClone(input)
  const result = migratePatch(input)
  assert.deepEqual(input, original)
  assert.equal(result.patches[0].disabled, true)
  assert.deepEqual(result.patches[0].config, original[0].config)
  assert.equal(result.patches[0].note, 'keep')
  assert.deepEqual(result.patches[1], original[1])
  assert.deepEqual(last(result.patches, moduleId('judgment')).config, input[0].config.judgement)
  assert.deepEqual(last(result.patches, moduleId('skills-mcp')).config, { toolFilters: {} })
  assert.equal(result.patches.some((row) => row.id === moduleId('judgement')), false)
  const bundle = Object.values(MODULE_NAMESPACES).map((name) => ({ id: moduleId(name), name: moduleId(name) }))
  const applied = apply(bundle, result.patches)
  assert.deepEqual(applied.find((row) => row.id === moduleId('browser')).config, { enabled: true })
  assert.deepEqual(migratePatch(result.patches), { patches: result.patches, changed: false, migratedModules: [] })
})

test('existing module fields and disabled state win while missing nested values are filled', () => {
  const input = [{ insert: [{ id: 'shell-kit', name: 'dsh-toolkit', disabled: true, config: { browser: { enabled: true, limits: { timeout: 1, retries: 2 }, tools: ['old'] } } }, { id: moduleId('browser'), name: moduleId('browser'), disabled: false, metadata: { title: 'custom' }, config: { enabled: false, limits: { timeout: 9 }, tools: [], custom: null } }] }]
  const result = migratePatch(input)
  const override = last(result.patches, moduleId('browser'))
  assert.deepEqual(override.config, { enabled: false, limits: { timeout: 9, retries: 2 }, tools: [], custom: null })
  const active = apply([], result.patches).find((row) => row.id === moduleId('browser'))
  assert.equal(active.disabled, false)
  assert.equal(active.metadata.title, 'custom')
  assert.equal(last(result.patches, moduleId('mobile')).disabled, true)
  assert.equal(migratePatch(result.patches).changed, false)
})

test('repeated root/module override config uses final whole object rather than earlier values', () => {
  const result = migratePatch([
    { id: 'shell-kit', config: { browser: { discarded: true }, theme: { discarded: true } } },
    { id: 'shell-kit', config: { browser: { keep: true } } },
    { id: moduleId('browser'), disabled: true, config: { discarded: 1 } },
    { id: moduleId('browser'), config: { present: 2 } },
  ])
  assert.deepEqual(last(result.patches, moduleId('browser')).config, { keep: true, present: 2 })
  assert.equal(last(result.patches, moduleId('theme')).config, undefined)
  assert.equal(apply([{ id: moduleId('browser') }], result.patches)[0].disabled, true)
  assert.equal(migratePatch(result.patches).changed, false)
})

test('no root is unchanged; no config creates only explicit module switch overrides', () => {
  assert.deepEqual(migratePatch([]), { patches: [], changed: false, migratedModules: [] })
  const unrelated = [{ id: 'other', config: { x: 1 } }]
  assert.equal(migratePatch(unrelated).changed, false)
  for (const disabled of [false, true]) {
    const result = migratePatch([{ id: 'shell-kit', disabled }])
    assert.equal(result.patches.length, 11)
    for (const row of result.patches.slice(1)) {
      assert.equal(row.disabled, disabled)
      assert.equal('config' in row, false)
      assert.equal('insert' in row, false)
    }
    assert.equal(migratePatch(result.patches).changed, false)
  }
})

test('nested inserted groups and group-targeted insert patches preserve structure', () => {
  const input = [{ insert: [{ id: 'group', group: true, config: [{ id: 'nested', group: true, config: [{ id: 'shell-kit', config: { notification: { volume: 0.4 } } }] }] }] }, { id: 'group', insert: [{ id: moduleId('notification'), disabled: true, config: { volume: 0.8 } }] }]
  const result = migratePatch(input)
  assert.equal(result.patches[0].insert[0].config[0].config[0].disabled, true)
  assert.deepEqual(result.patches[1], input[1])
  assert.equal(migratePatch(result.patches).changed, false)
})

test('unsafe shapes and ambiguous legacy roots fail explicitly', () => {
  for (const input of [null, {}, [null], [{ insert: {} }], [{ id: 'shell-kit', config: [] }], [{ id: 'shell-kit', config: { browser: false } }], [{ id: 'shell-kit', disabled: 'false' }], [{ id: 'shell-kit', config: { browser: { __jsExpr: 'env.x' } } }], [{ id: 'group', group: true, config: [] }], [{ insert: [{ id: 'group', group: true, disabled: true, config: [{ id: 'shell-kit' }] }] }], [{ id: 'shell-kit', config: { browser: { x: 1 } } }, { id: 'dsh-toolkit', config: { browser: { x: 2 } } }]]) {
    assert.throws(() => migratePatch(input), /expected|safely|expressions|conflicting|manual migration/)
  }
  assert.throws(() => migrateYaml('- id: shell-kit\n  config: !!js process.env\n'), /Unsafe YAML/)
  assert.throws(() => migrateYaml('- id: shell-kit\n  id: duplicate\n'), /Unsafe YAML/)
})

test('YAML comments, unrelated metadata and source on repeat are retained', () => {
  const source = '# profile note\n- id: shell-kit # root note\n  config:\n    browser: { enabled: false } # browser note\n    shell: { custom: keep }\n  customMeta: value\n- id: untouched\n  config: { keep: true }\n'
  const result = migrateYaml(source)
  for (const comment of ['# profile note', '# root note', '# browser note']) assert.ok(result.text.includes(comment))
  assert.equal(parse(result.text)[0].customMeta, 'value')
  assert.equal(migrateYaml(result.text).text, result.text)
  assert.equal(migrateYaml(result.text).changed, false)
})

test('CLI preview leaves bytes unchanged; --write retains exact exclusive backup and is idempotent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-config-migration-'))
  const path = join(directory, 'patch.yml')
  const source = '# keep original bytes\n- id: shell-kit\n  config:\n    browser: { enabled: false }\n'
  await writeFile(path, source)
  await main([path])
  assert.equal(await readFile(path, 'utf8'), source)
  assert.deepEqual(await readdir(directory), ['patch.yml'])
  const written = await main([path, '--write'])
  assert.equal(await readFile(written.backup, 'utf8'), source)
  assert.equal((await lstat(written.backup)).isFile(), true)
  const output = await readFile(path, 'utf8')
  assert.equal(parse(output)[0].disabled, true)
  assert.equal((await main([path, '--write'])).changed, false)
  assert.equal(await readFile(path, 'utf8'), output)
  assert.equal((await readdir(directory)).length, 2)
  await assert.rejects(() => main([]), /Usage/)
  await assert.rejects(() => main([path, '--bad']), /Usage/)
  await assert.rejects(() => main([directory]), /existing .yml/)
})
