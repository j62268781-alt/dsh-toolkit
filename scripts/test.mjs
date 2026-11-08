/** Run the retained upstream suites and the integration tests without real devices. */
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const run = (args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Test process ${signal ?? `exited ${code}`}: ${args.join(' ')}`)))
})

const testFiles = []
for (const group of ['browser', 'judgment', 'skills-mcp', 'notification', 'pet', 'weixin-clawbot', 'integration']) {
  for (const name of (await readdir(join(root, 'tests', group))).sort()) {
    if (name.endsWith('.test.mjs')) testFiles.push(`tests/${group}/${name}`)
  }
}

await run(['--import', './scripts/jsx-register.mjs', '--test', '--test-reporter=spec', ...testFiles])

// Isolate the optional local CLI checks from the user's DSH/mobilecli state.
// macOS's per-user TMPDIR can exceed Unix socket path limits in the RPC tests.
const temporaryRoot = await realpath(process.platform === 'darwin' ? '/tmp' : tmpdir())
const home = await mkdtemp(join(temporaryRoot, 'dsh-toolkit-tests-'))
try {
  await run(['tests/mobile/test-harness.mjs'], {
    ...process.env,
    TMPDIR: temporaryRoot,
    DSH_HOME: join(home, 'dsh'),
    MOBILECLI_HOME: home,
    MOBILECLI_TEST_HOME: home,
    MOBILECLI_TEST_SKIP_DEVICES: '1',
  })
} finally {
  const actual = await realpath(home)
  if (dirname(actual) !== temporaryRoot || !actual.startsWith(join(temporaryRoot, 'dsh-toolkit-tests-'))) {
    throw new Error(`Refusing to remove unexpected test home: ${actual}`)
  }
  await rm(actual, { recursive: true })
}
