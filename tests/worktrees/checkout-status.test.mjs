import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readCheckoutStatuses } from '../../src/modules/worktrees/host/worktree/checkout-status.js'

test('reports current directory presence without turning other filesystem results into missing worktrees', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-worktrees-status-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const exists = join(root, 'exists')
  const missing = join(root, 'missing')
  const file = join(root, 'file')
  const invalid = join(file, 'not-a-directory')
  const relative = 'relative/checkout'
  await mkdir(exists)
  await writeFile(file, '')

  const entries = [exists, missing, file, invalid, relative].map(path => ({ path }))
  const signal = new AbortController().signal
  assert.deepEqual(await readCheckoutStatuses(entries, signal), new Map([
    [exists, 'present'], [missing, 'missing'], [file, 'unknown'], [invalid, 'unknown'], [relative, 'unknown'],
  ]))
  await mkdir(missing)
  assert.equal((await readCheckoutStatuses(entries, signal)).get(missing), 'present')
  await assert.rejects(readCheckoutStatuses(entries, AbortSignal.abort()), { name: 'AbortError' })
})
