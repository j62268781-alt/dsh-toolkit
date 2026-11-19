/**
 * Run the retained upstream suites and the integration tests without real devices.
 *
 * 每个测试文件单独一个进程、由本脚本排队执行：`node --test` 的并发在 Node 20 上
 * 不可配置（--test-concurrency 自 21 起才有），默认会按 CPU 数拉起十几个进程，
 * 每个进程都带 jsdom + React + esbuild，16GB 的机器会直接被拖进 swap。
 * 这里默认串行，并给每个子进程一个 RSS 上限：哪个文件泄漏，就只杀它。
 */
import { spawn, execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const run = (args, env = process.env, stdio = 'inherit') => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio })
  child.once('error', reject)
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Test process ${signal ?? `exited ${code}`}: ${args.join(' ')}`)))
})

const testFiles = []
const uiFiles = []
for (const group of ['judgment', 'hooks', 'git', 'skills-mcp', 'notification', 'pet', 'remote', 'task-monitor', 'integration']) {
  for (const name of (await readdir(join(root, 'tests', group))).sort()) {
    if (!name.endsWith('.test.mjs')) continue
    const file = `tests/${group}/${name}`
    testFiles.push(file)
    // jsdom 用例按真实浏览器跑（见 README「UI 验证」）：一个文件就要几百 MB，
    // 归档页那个用例还能涨到 6GB。脚本默认不碰它们。
    if (/from 'jsdom'|from "jsdom"/.test(await readFile(join(root, file), 'utf8'))) uiFiles.push(file)
  }
}
// 渲染端与 helper 内核的用例没有 .test 后缀（同目录还有需要真 Electron 的 smoke 脚本），显式加入。
if (!testFiles.includes('tests/pet/runtime.mjs')) testFiles.push('tests/pet/runtime.mjs')

const argv = process.argv.slice(2)
const mode = argv.includes('--only-ui') || process.env.DSH_TEST_MODE === 'ui'
  ? 'ui'
  : argv.includes('--ui') || process.env.DSH_TEST_UI === '1' ? 'all' : 'unit'
const selected = mode === 'ui' ? uiFiles : mode === 'all' ? testFiles : testFiles.filter((file) => !uiFiles.includes(file))

// 默认串行。并发只在明确要求时开启：DSH_TEST_CONCURRENCY=2。串行全量的耗时由
// DSH_TEST_FILE_TIMEOUT_MS 之外的慢文件决定，末尾会打印最慢的五个，便于收窄。
const cpus = availableParallelism()
const concurrency = Math.max(1, Number.parseInt(process.env.DSH_TEST_CONCURRENCY ?? '', 10) || 1)
const heapMb = Number.parseInt(process.env.DSH_TEST_HEAP_MB ?? '', 10) || 1024
// 单个测试文件的 RSS 上限：jsdom 用例正常在 200–350MB，超过这个数基本就是泄漏。
// 0 表示不限制。父进程轮询子进程的 RSS，超限直接 SIGKILL 并标记失败。
const rssMb = Number.parseInt(process.env.DSH_TEST_RSS_MB ?? '', 10) || 1536
const inherited = process.env.NODE_OPTIONS ?? ''
const nodeOptions = /--max-old-space-size/.test(inherited) ? inherited : `${inherited} --max-old-space-size=${heapMb}`.trim()
const testEnv = { ...process.env, NODE_OPTIONS: nodeOptions }
console.log(`[test] ${selected.length} 个文件（${mode === 'ui' ? '仅 jsdom/UI' : mode === 'all' ? '含 jsdom/UI' : `跳过 ${uiFiles.length} 个 jsdom/UI`}），并发 ${concurrency}/${cpus}，单进程堆上限 ${heapMb}MB，单文件 RSS 上限 ${rssMb}MB`)
console.log('[test] DSH_TEST_CONCURRENCY / DSH_TEST_HEAP_MB / DSH_TEST_RSS_MB 可调；UI 用例走 `pnpm test:ui` 或真实浏览器')

/** 跑一条只读的系统命令并把 stdout 交给 parse；命令不存在 / 被沙箱拒绝 / 超时一律返回 0。 */
const probe = (command, args, parse) => new Promise((resolve) => {
  let settled = false
  const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
  let child
  try {
    child = execFile(command, args, { timeout: 2000, windowsHide: true }, (error, stdout) => {
      if (error) return finish(0)
      try { finish(parse(String(stdout))) } catch { finish(0) }
    })
  } catch {
    return finish(0)
  }
  // 沙箱里 spawn 会以 EPERM 走 'error' 事件；没有监听器就是未捕获异常，会直接把整个测试进程打掉。
  child.on('error', () => finish(0))
})

/** 子进程常驻内存（字节）；拿不到就返回 0，让本轮跳过判断。 */
const childRss = (pid) => {
  if (rssMb <= 0) return Promise.resolve(0)
  if (process.platform === 'linux') {
    return probe('cat', [`/proc/${pid}/status`], (stdout) => {
      const match = /VmRSS:\s+(\d+) kB/.exec(stdout)
      return match ? Number(match[1]) * 1024 : 0
    })
  }
  if (process.platform === 'darwin') {
    return probe('ps', ['-o', 'rss=', '-p', String(pid)], (stdout) => {
      const kb = Number.parseInt(stdout.trim(), 10)
      return Number.isFinite(kb) ? kb * 1024 : 0
    })
  }
  return probe('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], (stdout) => {
    // "node.exe","1234","Console","1","1,234,567 K"
    const cells = stdout.trim().split('","')
    const kb = Number.parseInt((cells[cells.length - 1] ?? '').replace(/[^\d]/g, ''), 10)
    return Number.isFinite(kb) ? kb * 1024 : 0
  })
}

const runFile = (file) => new Promise((resolve) => {
  const started = Date.now()
  // 直接执行文件、不要加 `--test`：`node --test file` 会再 fork 一个子进程跑用例，
  // 被监视的 pid 只是那个空的 runner，RSS 看门狗永远看不到真正的泄漏。这里已经由脚本
  // 自己排队，一个文件一个进程，直接跑即可（node:test 在入口文件里照样会执行）。
  const child = spawn(process.execPath, ['--import', './scripts/jsx-register.mjs', file], {
    cwd: root, env: testEnv, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk })
  child.stderr.on('data', (chunk) => { output += chunk })
  let killed = false
  let misses = 0
  const watchdog = Number.isFinite(child.pid) ? setInterval(async () => {
    if (killed) return
    const rss = await childRss(child.pid)
    if (rss === 0) {
      // 系统命令不可用（沙箱、精简版容器、Windows 上没有 tasklist）：关掉看门狗，
      // 不要每秒再 spawn 一次，也不要假装还在监控。
      if (++misses >= 3) {
        clearInterval(watchdog)
        console.log(`[test] 读不到子进程 RSS，已关闭 ${file} 的内存看门狗（DSH_TEST_RSS_MB=0 可显式关闭）`)
      }
      return
    }
    misses = 0
    if (rss > rssMb * 1048576) {
      killed = true
      clearInterval(watchdog)
      child.kill('SIGKILL')
      output += `\n[test] RSS ${(rss / 1048576).toFixed(0)}MB 超过 ${rssMb}MB 上限，已终止 ${file}\n`
    }
  }, 1000) : undefined
  watchdog?.unref()
  child.once('error', (error) => { clearInterval(watchdog); resolve({ file, code: -1, output: `${output}\n${error}`, ms: Date.now() - started }) })
  child.once('exit', (code, signal) => {
    clearInterval(watchdog)
    resolve({ file, code, signal, output, ms: Date.now() - started })
  })
})

const queue = [...selected]
const failures = []
const timings = []
let done = 0
const pad = (n) => String(n).padStart(String(selected.length).length, ' ')
const worker = async () => {
  for (let file = queue.shift(); file; file = queue.shift()) {
    const result = await runFile(file)
    done += 1
    const seconds = (result.ms / 1000).toFixed(1)
    const ok = result.code === 0
    timings.push(result)
    if (ok) {
      console.log(`[${pad(done)}/${selected.length}] ok   ${seconds}s  ${file}`)
    } else {
      failures.push(result)
      console.log(`[${pad(done)}/${selected.length}] FAIL ${seconds}s  ${file}（${result.signal ?? `exit ${result.code}`}）`)
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, worker))

const slowest = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 5)
console.log(`\n[test] 最慢：${slowest.map((item) => `${item.file} ${(item.ms / 1000).toFixed(1)}s`).join('，')}`)
for (const failure of failures) {
  console.log(`\n===== ${failure.file}（${failure.signal ?? `exit ${failure.code}`}）=====`)
  const lines = failure.output.trimEnd().split('\n')
  console.log(lines.slice(-60).join('\n'))
}
if (failures.length > 0) {
  console.log(`\n[test] ${failures.length}/${selected.length} 个文件失败：${failures.map((item) => item.file).join(', ')}`)
  process.exitCode = 1
} else {
  console.log(`[test] ${selected.length} 个文件全部通过`)
}

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
} catch (error) {
  // 设备 harness 失败要像其他文件一样记成一条失败；不能让它变成 unhandled rejection，
  // 否则 tail 只看到一段栈，分不清是哪个用例挂了。
  console.log(`\n===== tests/mobile/test-harness.mjs =====\n${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  const actual = await realpath(home)
  if (dirname(actual) !== temporaryRoot || !actual.startsWith(join(temporaryRoot, 'dsh-toolkit-tests-'))) {
    throw new Error(`Refusing to remove unexpected test home: ${actual}`)
  }
  await rm(actual, { recursive: true })
}
