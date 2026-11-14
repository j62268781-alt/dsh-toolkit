/** hooks 的配置层：matcher 语义、文件解析容错、三来源合并与缓存失效。 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkMatcher } from '../../lib/modules/hooks/host/domain/matcher.js'
import {
  createHookStore,
  parseHookDocument,
  substitutePlaceholders,
} from '../../lib/modules/hooks/host/domain/files.js'

const FILE = { id: 'user', path: 'C:/tmp/hooks.json' }

function parse(raw, defaultTimeoutMs = 60_000) {
  return parseHookDocument(raw, FILE, defaultTimeoutMs)
}

/* ─────────────────────────── matcher ─────────────────────────── */

test('matcher：空串与 `*` 匹配全部，其余按逗号拆正则且不区分大小写', () => {
  assert.equal(checkMatcher('', 'bash').matches, true)
  assert.equal(checkMatcher('*', 'anything').matches, true)
  // 从 Claude Code 抄来的 `Bash` 必须命中宿主的 `bash`，否则配置静默失效。
  assert.equal(checkMatcher('Bash', 'bash').matches, true)
  assert.equal(checkMatcher('Edit|Write', 'edit_file').matches, true)
  assert.equal(checkMatcher('edit_file, write_file', 'write_file').matches, true)
  assert.equal(checkMatcher('Bash', 'read_file').matches, false)
})

test('matcher：非法正则返回 error 而不是抛异常（配置写错不该让页面炸）', () => {
  const broken = checkMatcher('([', 'bash')
  assert.equal(broken.matches, false)
  assert.ok(broken.error)
})

/* ─────────────────────────── 解析 ─────────────────────────── */

test('解析：带 hooks 键与直接事件表两种根形状都认', () => {
  const wrapped = parse({ hooks: { Stop: [{ hooks: [{ command: 'echo a' }] }] } })
  assert.equal(wrapped.hooks.length, 1)
  assert.equal(wrapped.hooks[0].event, 'Stop')
  assert.deepEqual(wrapped.issues, [])

  const bare = parse({ PreToolUse: [{ hooks: [{ command: 'echo b' }] }] })
  assert.equal(bare.hooks.length, 1)
  assert.equal(bare.hooks[0].command, 'echo b')
})

test('解析：字符串简写与「单条 hook 直挂分组」都收下', () => {
  const result = parse({
    PreToolUse: [
      'echo shorthand',
      { command: 'echo inline', timeout: 3 },
      { matcher: 'bash', hooks: ['echo grouped'] },
    ],
  })
  assert.deepEqual(result.hooks.map((hook) => hook.command), ['echo shorthand', 'echo inline', 'echo grouped'])
  assert.equal(result.hooks[1].timeoutMs, 3_000, 'timeout 以秒计')
  assert.equal(result.hooks[2].matcher, 'bash')
  assert.deepEqual(result.issues, [])
})

test('解析：未知事件与未接线事件都记诊断，后者保留配置但标成不支持', () => {
  const result = parse({
    NoSuchEvent: [{ hooks: [{ command: 'echo x' }] }],
    SessionEnd: [{ hooks: [{ command: 'echo y' }] }],
  })
  const codes = result.issues.map((issue) => issue.code)
  assert.ok(codes.includes('unknown-event'))
  assert.ok(codes.includes('unsupported-event'))
  assert.equal(result.hooks.length, 1)
  assert.equal(result.hooks[0].event, 'SessionEnd')
  assert.equal(result.hooks[0].supported, false, '写了但没接线，必须显式标出来')
})

test('解析：坏分组、坏类型、坏命令逐条记诊断，其余条目照常收下', () => {
  const result = parse({
    PreToolUse: [
      { matcher: 'bash' },
      { hooks: [{ type: 'http', url: 'https://example.com' }, { command: '   ' }, { command: 'echo good' }] },
    ],
  })
  const codes = result.issues.map((issue) => issue.code)
  assert.ok(codes.includes('bad-group'), '缺少 hooks 数组')
  assert.ok(codes.includes('unsupported-type'), 'http 类型暂不支持')
  assert.ok(codes.includes('bad-command'), '空命令')
  assert.deepEqual(result.hooks.map((hook) => hook.command), ['echo good'])
})

test('解析：根不是对象时给一条 bad-document，不抛异常', () => {
  for (const raw of [[], 'text', 42, null]) {
    const result = parse(raw)
    assert.deepEqual(result.hooks, [])
    assert.equal(result.issues[0].code, 'bad-document')
  }
})

test('解析：超时秒/毫秒两种写法都接受，并夹到 1s..600s', () => {
  const result = parse({
    Stop: [{ hooks: [
      { command: 'a', timeout: 0.2 },
      { command: 'b', timeout: 9_999 },
      { command: 'c', timeoutMs: 2_500 },
    ] }],
  })
  assert.deepEqual(result.hooks.map((hook) => hook.timeoutMs), [1_000, 600_000, 2_500])
})

test('占位符：已知变量替换，未知变量原样保留', () => {
  assert.equal(
    substitutePlaceholders('${DSH_HOME}/hooks/a.sh ${project}/b.sh ${unknown}', { DSH_HOME: 'D:/home', project: 'D:/p' }),
    'D:/home/hooks/a.sh D:/p/b.sh ${unknown}',
  )
})

/* ─────────────────────────── store ─────────────────────────── */

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-hooks-'))
  const home = join(root, 'home')
  const projectDir = join(root, 'project')
  await mkdir(home, { recursive: true })
  await mkdir(join(projectDir, '.dsh'), { recursive: true })
  const store = createHookStore({
    home,
    projectDir,
    userFile: '',
    includeProject: true,
    defaultTimeoutMs: 60_000,
    enabled: () => true,
  })
  try {
    await run({ store, home, projectDir })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('store：用户级 → 项目级 → 本机 三个来源按顺序合并，id 带来源前缀', async () => {
  await withStore(async ({ store, home, projectDir }) => {
    await writeFile(join(home, 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'echo user' }] }] } }))
    await writeFile(join(projectDir, '.dsh', 'hooks.json'), JSON.stringify({ PreToolUse: [{ matcher: 'bash', hooks: [{ command: 'echo project' }] }] }))
    await writeFile(join(projectDir, '.dsh', 'hooks.local.json'), JSON.stringify({ PreToolUse: [{ hooks: [{ command: 'echo local' }] }] }))

    const snapshot = await store.snapshot()
    assert.deepEqual(snapshot.files.map((file) => file.id), ['user', 'project', 'local'])
    assert.deepEqual(snapshot.files.map((file) => file.state), ['ok', 'ok', 'ok'])
    assert.deepEqual(snapshot.hooks.map((hook) => hook.command), ['echo user', 'echo project', 'echo local'])
    assert.deepEqual(snapshot.hooks.map((hook) => hook.id), ['user:Stop:0', 'project:PreToolUse:0', 'local:PreToolUse:0'])
    assert.equal(snapshot.enabled, true)
  })
})

test('store：缺失的文件标 missing，坏 JSON 标 invalid 且不炸掉其它来源', async () => {
  await withStore(async ({ store, home, projectDir }) => {
    await writeFile(join(home, 'hooks.json'), '{ not json')
    const snapshot = await store.snapshot()
    assert.equal(snapshot.files[0].state, 'invalid')
    assert.equal(snapshot.files[1].state, 'missing')
    assert.equal(snapshot.files[2].state, 'missing')
    assert.equal(snapshot.hooks.length, 0)
  })
})

test('store：改文件后 mtime 变化触发重读，invalidate() 强制重读', async () => {
  await withStore(async ({ store, home }) => {
    const path = join(home, 'hooks.json')
    await writeFile(path, JSON.stringify({ Stop: [{ hooks: [{ command: 'echo one' }] }] }))
    assert.equal((await store.snapshot()).hooks[0].command, 'echo one')

    await writeFile(path, JSON.stringify({ Stop: [{ hooks: [{ command: 'echo two-two' }] }] }))
    assert.equal((await store.snapshot()).hooks[0].command, 'echo two-two', 'mtime/size 变了就该重读')

    await writeFile(path, JSON.stringify({ Stop: [{ hooks: [{ command: 'echo three!!!' }] }] }))
    store.invalidate()
    assert.equal((await store.snapshot()).hooks[0].command, 'echo three!!!')
  })
})

test('store：hooksFor 只返回命中 matcher 且已接线的条目', async () => {
  await withStore(async ({ store, home }) => {
    await writeFile(join(home, 'hooks.json'), JSON.stringify({
      PreToolUse: [
        { matcher: 'bash', hooks: [{ command: 'echo bash' }] },
        { matcher: 'read_file', hooks: [{ command: 'echo read' }] },
      ],
      SessionEnd: [{ hooks: [{ command: 'echo end' }] }],
    }))
    assert.deepEqual((await store.hooksFor('PreToolUse', 'bash')).map((hook) => hook.command), ['echo bash'])
    assert.deepEqual((await store.hooksFor('PreToolUse', 'write_file')), [])
    assert.deepEqual((await store.hooksFor('SessionEnd', '')), [], '没有触发点的事件不参与运行')
    assert.deepEqual((await store.hooksFor('NoSuchEvent', 'x')), [])

    const found = await store.find('user:PreToolUse:1')
    assert.equal(found?.command, 'echo read')
    assert.equal(await store.find('user:PreToolUse:9'), undefined)
  })
})

test('store：占位符在读取时替换成真实路径', async () => {
  await withStore(async ({ store, home, projectDir }) => {
    await writeFile(join(home, 'hooks.json'), JSON.stringify({
      Stop: [{ hooks: [{ command: '${DSH_HOME}/check.sh ${project}/x.sh' }] }],
    }))
    const snapshot = await store.snapshot()
    assert.equal(snapshot.hooks[0].command, `${home}/check.sh ${projectDir}/x.sh`)
  })
})

test('store：项目目录是函数时跟着它走，切目录后旧缓存不再生效', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-hooks-dir-'))
  const home = join(root, 'home')
  const first = join(root, 'repo-a')
  const second = join(root, 'repo-b')
  await mkdir(home, { recursive: true })
  for (const dir of [first, second]) await mkdir(join(dir, '.dsh'), { recursive: true })
  let current = first
  const store = createHookStore({
    home,
    projectDir: () => current,
    userFile: '',
    includeProject: true,
    defaultTimeoutMs: 60_000,
    enabled: () => true,
  })
  try {
    await writeFile(join(first, '.dsh', 'hooks.json'), JSON.stringify({ Stop: [{ hooks: [{ command: 'echo from-a' }] }] }))
    await writeFile(join(second, '.dsh', 'hooks.json'), JSON.stringify({ Stop: [{ hooks: [{ command: 'echo from-b' }] }] }))
    await writeFile(join(second, '.dsh', 'hooks.local.json'), JSON.stringify({ Stop: [{ hooks: [{ command: 'echo local-b' }] }] }))

    assert.deepEqual((await store.hooksFor('Stop', '')).map((hook) => hook.command), ['echo from-a'])
    assert.equal((await store.snapshot()).projectDir, first)

    current = second
    const moved = await store.snapshot()
    assert.equal(moved.projectDir, second)
    assert.deepEqual(moved.hooks.map((hook) => hook.command), ['echo from-b', 'echo local-b'], '换了仓库就读新仓库的配置')
    assert.equal(moved.files.find((file) => file.id === 'project')?.path, join(second, '.dsh', 'hooks.json'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store：占位符里的 ${project} 也按当前目录求值', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-hooks-ph-'))
  const home = join(root, 'home')
  let current = join(root, 'one')
  await mkdir(home, { recursive: true })
  await mkdir(join(current, '.dsh'), { recursive: true })
  const store = createHookStore({
    home,
    projectDir: () => current,
    userFile: '',
    includeProject: true,
    defaultTimeoutMs: 60_000,
    enabled: () => true,
  })
  try {
    await writeFile(join(current, '.dsh', 'hooks.json'), JSON.stringify({ Stop: [{ hooks: [{ command: '${project}/run.sh' }] }] }))
    assert.equal((await store.snapshot()).hooks[0].command, `${current}/run.sh`)
    current = join(root, 'two')
    await mkdir(join(current, '.dsh'), { recursive: true })
    await writeFile(join(current, '.dsh', 'hooks.json'), JSON.stringify({ Stop: [{ hooks: [{ command: '${project}/run.sh' }] }] }))
    assert.equal((await store.snapshot()).hooks[0].command, `${current}/run.sh`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
