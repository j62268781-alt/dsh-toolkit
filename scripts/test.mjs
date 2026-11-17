/** Run the retained upstream suites and the integration tests without real devices. */
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const run = (args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Test process ${signal ?? `exited ${code}`}: ${args.join(' ')}`)))
})

const testFiles = []
for (const group of ['judgment', 'hooks', 'git', 'skills-mcp', 'notification', 'pet', 'remote', 'integration']) {
  for (const name of (await readdir(join(root, 'tests', group))).sort()) {
    if (name.endsWith('.test.mjs')) testFiles.push(`tests/${group}/${name}`)
  }
}
// 渲染端与 helper 内核的用例没有 .test 后缀（同目录还有需要真 Electron 的 smoke 脚本），显式加入。
if (!testFiles.includes('tests/pet/runtime.mjs')) testFiles.push('tests/pet/runtime.mjs')

// node --test 默认按 CPU 数并发：每个测试文件一个进程，jsdom 用例单进程峰值可达 350MB，
// 11 核机器上同时 12 个进程实测约 2.3GB。默认压到 4 路（峰值约 1GB，全量耗时多 3s 以内），
// 并给每个测试进程加堆上限，让泄漏的用例自己 OOM 退出，而不是把整机拖进 swap。
const cpus = availableParallelism()
const concurrency = Number.parseInt(process.env.DSH_TEST_CONCURRENCY ?? '', 10) || Math.min(4, cpus)
const heapMb = Number.parseInt(process.env.DSH_TEST_HEAP_MB ?? '', 10) || 1024
// --test-concurrency 自 Node 21 起才有，且不允许出现在 NODE_OPTIONS 里。
const concurrencyFlag = Number(process.versions.node.split('.')[0]) >= 21 ? [`--test-concurrency=${concurrency}`] : []
const inherited = process.env.NODE_OPTIONS ?? ''
const nodeOptions = /--max-old-space-size/.test(inherited) ? inherited : `${inherited} --max-old-space-size=${heapMb}`.trim()
const testEnv = { ...process.env, NODE_OPTIONS: nodeOptions }
console.log(`[test] 并发 ${concurrency}/${cpus}，单进程堆上限 ${heapMb}MB（DSH_TEST_CONCURRENCY / DSH_TEST_HEAP_MB 可调）`)

await run(['--import', './scripts/jsx-register.mjs', '--test', '--test-reporter=spec', ...concurrencyFlag, ...testFiles], testEnv)

// Isolate the optional local CLI checks from the user's DSH/mobilecli state.
// macOS's per-user TMPDIR can exceed Unix socket path limits in the RPC tests.
// --import jsx-register：harness 直接 import 的源码入口是 .ts，靠 resolve 钩子把 .js 说明符映射过去。
const temporaryRoot = await realpath(process.platform === 'darwin' ? '/tmp' : tmpdir())
const home = await mkdtemp(join(temporaryRoot, 'dsh-toolkit-tests-'))
try {
  await run(['--import', './scripts/jsx-register.mjs', 'tests/mobile/test-harness.mjs'], {
    ...testEnv,
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
