#!/usr/bin/env node
/** Explicit offline migration: preview by default, timestamped backup with --write. */
import { lstat, readFile, realpath, copyFile, open, rename, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parseDocument } from 'yaml'
import { migratePatch, ROOT_IDS } from '../src/host/migration.js'

export function migrateYaml(source) {
  const document = parseDocument(source, { uniqueKeys: true, schema: 'core' })
  if (document.errors.length || document.warnings.length) throw new Error(`Unsafe YAML: ${[...document.errors, ...document.warnings].map((issue) => issue.message).join('; ')}`)
  const input = document.toJS({ maxAliasCount: 100 })
  const result = migratePatch(input)
  if (!result.changed) return { ...result, text: source }
  const disableRoots = (rows, path = []) => rows.forEach((row, index) => {
    const at = [...path, index]
    if (Array.isArray(row.insert)) disableRoots(row.insert, [...at, 'insert'])
    else if (row.group && Array.isArray(row.config)) disableRoots(row.config, [...at, 'config'])
    else if (ROOT_IDS.includes(row.id)) document.setIn([...at, 'disabled'], true)
  })
  disableRoots(input)
  for (const row of result.patches.slice(input.length)) document.contents.add(document.createNode(row))
  return { ...result, text: document.toString() }
}

export async function main(args = process.argv.slice(2)) {
  const files = args.filter((arg) => arg !== '--write')
  if (files.length !== 1 || args.filter((arg) => arg === '--write').length > 1 || files[0].startsWith('--')) throw new Error('Usage: node scripts/migrate-config.mjs <patch.yml> [--write]')
  const requested = resolve(files[0])
  if (!['.yml', '.yaml'].includes(extname(requested).toLowerCase())) throw new Error('Expected an existing .yml or .yaml patch file')
  const stat = await lstat(requested)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Refusing to write a symlink or non-regular patch file')
  const target = await realpath(requested)
  const source = await readFile(target, 'utf8')
  const result = migrateYaml(source)
  if (!args.includes('--write')) {
    console.error(`Preview only: ${target}\nInstall the new module bundle before applying these overrides. Legacy root rows remain as disabled records and may produce entry-not-found warnings.\n${result.changed ? 'Changes available; use --write to back up and save.' : 'Already migrated; no changes.'}`)
    process.stdout.write(result.text)
    return result
  }
  if (!result.changed) {
    console.log(`Already migrated; no changes: ${target}`)
    return result
  }
  // Validate the exact absolute target before any replacement, and retain the
  // original bytes in an exclusive backup. Never migrate the active profile implicitly.
  if (await realpath(requested) !== target || !(await lstat(requested)).isFile() || (await lstat(requested)).isSymbolicLink()) throw new Error('Patch path changed during migration; no files written')
  if (await readFile(target, 'utf8') !== source) throw new Error('Patch changed during migration; no files written')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = `${target}.bak-${stamp}-${randomUUID()}`
  await copyFile(target, backup, constants.COPYFILE_EXCL)
  if (await readFile(backup, 'utf8') !== source) throw new Error(`Patch changed while backing up; original retained at ${backup}; target not overwritten`)
  const temporary = `${target}.migration-${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temporary, 'wx', stat.mode)
    await handle.writeFile(result.text, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    if (await realpath(requested) !== target || (await lstat(requested)).isSymbolicLink() || await readFile(target, 'utf8') !== source) throw new Error('Patch changed before replacement; target not overwritten')
    if (dirname(temporary) !== dirname(target)) throw new Error('Unexpected temporary path; refusing replacement')
    await rename(temporary, target)
  } finally {
    await handle?.close()
    if (dirname(temporary) === dirname(target) && temporary.startsWith(`${target}.migration-`)) await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error })
  }
  console.log(`Migrated: ${target}\nBackup: ${backup}\nInstall/enable the new module bundle, then restart DSH. Retained legacy root overrides may produce entry-not-found warnings.`)
  return { ...result, backup }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Migration failed: ${error.message}`); process.exitCode = 1 })
}
