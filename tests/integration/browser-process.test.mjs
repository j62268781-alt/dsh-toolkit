import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'

await mkdir('node_modules/.cache', { recursive: true })
for (const name of ['cli', 'env']) {
  await build({ entryPoints: [`src/modules/browser/host/${name}.ts`], bundle: true, platform: 'node', format: 'esm',
    target: 'node20', outfile: `node_modules/.cache/browser-${name}.mjs`, logLevel: 'silent' })
}
const { AgentBrowser } = await import('../../node_modules/.cache/browser-cli.mjs')
const { runCommand } = await import('../../node_modules/.cache/browser-env.mjs')
const browser = source => new AgentBrowser({ command: process.execPath, globalArgs: ['-e', source], timeoutMs: 5000 })

test('Browser process adapter keeps stdin, diagnostics and typed failure outcomes', async () => {
  assert.equal(await browser("process.stdin.on('data', b => process.stdout.write(b))").run([], { stdin: 'hello browser' }), 'hello browser')
  await assert.rejects(browser("process.stderr.write('expected failure');process.exitCode=7").run([]), error => error.code === 'cli-failed' && /expected failure/.test(error.message))
  await assert.rejects(browser('setInterval(()=>{},1000)').run([], { timeoutMs: 30 }), error => error.code === 'timeout')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(browser("throw Error('must not start')").run([], { signal: controller.signal }), error => error.code === 'aborted')
  await assert.rejects(browser("process.stdout.write(Buffer.alloc(9*1024*1024))").run([]), error => error.code === 'bad-output' && /8 MiB/.test(error.message))
})

test('Browser installer adapter bounds output and reports spawn failures without fake success', async () => {
  const normal = await runCommand(process.execPath, ['-e', "process.stdout.write('installed')"], 5000)
  assert.deepEqual(normal, { code: 0, stdout: 'installed', stderr: '', timedOut: false })
  const timed = await runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], 30)
  assert.equal(timed.timedOut, true)
  assert.equal(timed.code, null)
  const failed = await runCommand('/nonexistent/dsh-toolkit-installer', [], 5000)
  assert.equal(failed.code, null)
  assert.match(failed.stderr, /ENOENT/)
  const output = await runCommand(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(9*1024*1024))'], 5000)
  assert.equal(output.code, null)
  assert.ok(Buffer.byteLength(output.stdout) <= 8*1024*1024)
  assert.match(output.stderr, /8 MiB/)
})

test('Browser locator refresh sees a newly installed executable and preserves explicit paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-browser-locator-'))
  const previous = process.env.PATH
  try {
    process.env.PATH = directory
    const instance = new AgentBrowser({ command: 'agent-browser', globalArgs: [], timeoutMs: 5000 })
    assert.equal(instance.commandKind, 'name')
    const executable = join(directory, process.platform === 'win32' ? 'agent-browser.exe' : 'agent-browser')
    await writeFile(executable, '', { mode: 0o755 })
    assert.equal(instance.commandKind, 'name', 'cached absence lasts until explicit installation refresh')
    assert.equal(instance.refresh(), true)
    assert.equal(instance.command, await realpath(executable))
    assert.equal(instance.commandKind, 'native')
    const explicit = new AgentBrowser({ command: executable, globalArgs: [], timeoutMs: 5000 })
    assert.equal(explicit.refresh(), false)
    assert.equal(explicit.commandKind, 'configured')
  } finally {
    if (previous === undefined) delete process.env.PATH
    else process.env.PATH = previous
    await rm(directory, { recursive: true, force: true })
  }
})
