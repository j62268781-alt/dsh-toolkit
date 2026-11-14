/**
 * hooks 配置文件的三来源读取、合并与静态诊断。
 *
 * 三份文件是同一个格式（Claude Code 的 `hooks` 段），按「用户级 → 项目级 → 本机」顺序
 * 合并；同一个事件上的多个分组**拼接**而不是覆盖，与 Qoder / Claude Code 一致。
 *
 * 每次事件都重新 stat 一次（几微秒），文件改完下一轮对话就生效——不做「进程启动读一次」
 * 那种设计，否则用户改完配置必须重启，和面板上的「刷新」按钮也对不上。
 */
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import {
  DEFAULT_HOOK_TIMEOUT_MS,
  HOOK_EVENTS,
  HOOK_EVENT_IDS,
  MAX_COMMAND_LENGTH,
  MAX_CONFIG_BYTES,
  MAX_HOOK_TIMEOUT_MS,
  hookEventDefinition,
} from '../constants.js'
import { checkMatcher } from './matcher.js'

export type HookFileId = 'user' | 'project' | 'local'
export type HookFileState = 'ok' | 'missing' | 'invalid' | 'unreadable'

export interface HookSourceFile {
  id: HookFileId
  label: string
  path: string
  state: HookFileState
  /** 读/解析失败的一句话原因（`missing` 时为空）。 */
  error: string
  /** 该文件贡献了多少条 hook。 */
  hooks: number
}

export interface HookView {
  id: string
  event: string
  matcher: string
  command: string
  timeoutMs: number
  source: HookFileId
  sourcePath: string
  supported: boolean
}

export interface HookIssue {
  id: string
  severity: 'error' | 'warning'
  code: string
  message: string
  path: string
  event: string
  hookId: string
}

export interface HookEventView {
  id: string
  label: string
  hint: string
  matcher: 'tool' | 'source' | 'none'
  supported: boolean
  count: number
}

export interface HooksSnapshot {
  readAt: number
  enabled: boolean
  projectDir: string
  files: HookSourceFile[]
  hooks: HookView[]
  issues: HookIssue[]
  events: HookEventView[]
}

export interface HookStoreOptions {
  /** `$DSH_HOME`：`${DSH_HOME}` 占位符与用户级默认路径都按它解析。 */
  home: string
  /**
   * 项目目录：项目级文件位置、hook 进程的 cwd、`${project}` 占位符。
   *
   * 传函数时每次读取都求值——桌面端 DSH 的 `process.cwd()` 是安装目录而不是用户工作区，
   * 只有跟着会话的 working directory 走，项目级 hooks 才会落在用户真正在改的仓库里。
   */
  projectDir: string | (() => string)
  /** 配置里的用户级文件；空串表示 `<home>/hooks.json`。 */
  userFile: string
  includeProject: boolean
  defaultTimeoutMs: number
  /** 模块总开关：关掉后仍能看到配置，但不会执行。 */
  enabled: () => boolean
}

interface ParsedHook {
  event: string
  matcher: string
  command: string
  timeoutMs: number
  supported: boolean
}

interface FileRead {
  file: HookSourceFile
  hooks: ParsedHook[]
  issues: HookIssue[]
}

const FILE_META: Record<HookFileId, { label: string }> = {
  user: { label: '用户级' },
  project: { label: '项目级' },
  local: { label: '本机' },
}

/** `${...}` 占位符：DSH_HOME / project。取不到的变量原样保留，让人一眼看出写错了。 */
export function substitutePlaceholders(text: string, vars: Record<string, string>): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    const value = vars[name]
    return value === undefined ? whole : value
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errnoOf(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code
  return typeof code === 'string' ? code : ''
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 一条命令是否可用：非空、不过长、没有换行截断。 */
function normalizeCommand(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const command = value.trim()
  if (command === '' || command.length > MAX_COMMAND_LENGTH) return undefined
  return command
}

function normalizeTimeout(value: unknown, fallback: number, ms: boolean): number {
  const raw = typeof value === 'string' ? Number(value) : value
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return fallback
  const requested = ms ? raw : raw * 1_000
  return Math.min(MAX_HOOK_TIMEOUT_MS, Math.max(1_000, Math.round(requested)))
}

/**
 * 把一份已解析的 JSON 转成 hook 列表 + 诊断。
 *
 * 容错原则：**能看懂的都收下**（字符串简写、单条 hook 直接挂在分组上），看不懂的记一条
 * 诊断后跳过——绝不因为一条写错就整份作废（那样用户根本不知道是哪条错了）。
 */
export function parseHookDocument(
  raw: unknown,
  file: { id: HookFileId; path: string },
  defaultTimeoutMs: number,
): { hooks: ParsedHook[]; issues: HookIssue[] } {
  const hooks: ParsedHook[] = []
  const issues: HookIssue[] = []
  let seq = 0
  const issue = (severity: HookIssue['severity'], code: string, message: string, event: string): void => {
    issues.push({ id: `${file.id}:issue:${++seq}`, severity, code, message, path: file.path, event, hookId: '' })
  }

  let table: unknown = raw
  if (isRecord(raw) && isRecord(raw.hooks)) table = raw.hooks
  if (!isRecord(table)) {
    issue('error', 'bad-document', 'hooks 配置必须是一个对象：{"hooks": {"PreToolUse": [...]}}', '')
    return { hooks, issues }
  }

  for (const [eventName, groups] of Object.entries(table)) {
    const definition = hookEventDefinition(eventName)
    if (definition === undefined) {
      issue('warning', 'unknown-event', `未知事件名 "${eventName}"，已忽略`, eventName)
      continue
    }
    if (!Array.isArray(groups)) {
      issue('error', 'bad-event-value', `事件 ${eventName} 的值必须是数组`, eventName)
      continue
    }
    if (!definition.supported) {
      issue('warning', 'unsupported-event', `${eventName} 暂未接线，配置会保留但不会执行`, eventName)
    }
    for (const [groupIndex, group] of groups.entries()) {
      const where = `${eventName}[${groupIndex}]`
      let matcher = ''
      let entries: unknown[] = []
      if (typeof group === 'string') {
        entries = [group]
      } else if (isRecord(group)) {
        matcher = typeof group.matcher === 'string' ? group.matcher.trim() : ''
        if (Array.isArray(group.hooks)) entries = group.hooks
        else if (group.command !== undefined) entries = [group]
        else {
          issue('error', 'bad-group', `${where} 缺少 hooks 数组`, eventName)
          continue
        }
      } else {
        issue('error', 'bad-group', `${where} 不是对象`, eventName)
        continue
      }

      const matcherError = checkMatcher(matcher, '').error
      if (matcherError !== undefined) issue('warning', 'bad-matcher', `${where}：${matcherError}`, eventName)

      for (const [hookIndex, entry] of entries.entries()) {
        const at = `${where}.hooks[${hookIndex}]`
        let command: string | undefined
        let timeout = defaultTimeoutMs
        if (typeof entry === 'string') {
          command = normalizeCommand(entry)
        } else if (isRecord(entry)) {
          const type = typeof entry.type === 'string' ? entry.type : 'command'
          if (type !== 'command') {
            issue('warning', 'unsupported-type', `${at} 的 type "${type}" 暂不支持（只跑 command）`, eventName)
            continue
          }
          command = normalizeCommand(entry.command)
          timeout = normalizeTimeout(entry.timeout, timeout, false)
          timeout = normalizeTimeout(entry.timeoutMs, timeout, true)
        }
        if (command === undefined) {
          issue('error', 'bad-command', `${at} 缺少可执行的 command`, eventName)
          continue
        }
        hooks.push({ event: eventName, matcher, command, timeoutMs: timeout, supported: definition.supported })
      }
    }
  }
  return { hooks, issues }
}

export function resolveHookFiles(options: {
  home: string
  projectDir: string
  userFile: string
  includeProject: boolean
}): Array<{ id: HookFileId; label: string; path: string }> {
  const userFile = options.userFile === ''
    ? join(options.home, 'hooks.json')
    : isAbsolute(options.userFile) ? options.userFile : resolve(options.projectDir, options.userFile)
  const files: Array<{ id: HookFileId; label: string; path: string }> = [
    { id: 'user', label: FILE_META.user.label, path: userFile },
  ]
  if (options.includeProject) {
    files.push(
      { id: 'project', label: FILE_META.project.label, path: join(options.projectDir, '.dsh', 'hooks.json') },
      { id: 'local', label: FILE_META.local.label, path: join(options.projectDir, '.dsh', 'hooks.local.json') },
    )
  }
  return files
}

export interface HookStore {
  snapshot(): Promise<HooksSnapshot>
  /** 命中的 hook（已按 matcher 过滤，且只含已接线的事件）。 */
  hooksFor(event: string, subject: string): Promise<HookView[]>
  /** 找出面板上某条 hook 当前对应的条目（试跑用；配置改了会返回 undefined）。 */
  find(hookId: string): Promise<HookView | undefined>
  invalidate(): void
  files(): Array<{ id: HookFileId; label: string; path: string }>
}

export function createHookStore(options: HookStoreOptions): HookStore {
  const cache = new Map<string, { key: string; hooks: ParsedHook[]; issues: HookIssue[] }>()
  /** 上一次解析时用的项目目录：会话换了工作区就丢掉旧缓存，避免读到别的仓库的条目。 */
  let lastProjectDir = ''

  function projectDir(): string {
    return typeof options.projectDir === 'function' ? options.projectDir() : options.projectDir
  }

  function currentFiles(): Array<{ id: HookFileId; label: string; path: string }> {
    const dir = projectDir()
    if (dir !== lastProjectDir) {
      cache.clear()
      lastProjectDir = dir
    }
    return resolveHookFiles({
      home: options.home,
      projectDir: dir,
      userFile: options.userFile,
      includeProject: options.includeProject,
    })
  }

  async function readOne(entry: { id: HookFileId; label: string; path: string }): Promise<FileRead> {
    const view: HookSourceFile = { id: entry.id, label: entry.label, path: entry.path, state: 'ok', error: '', hooks: 0 }
    let key: string
    try {
      const info = await stat(entry.path)
      if (!info.isFile()) {
        view.state = 'unreadable'
        view.error = '不是普通文件'
        return { file: view, hooks: [], issues: [] }
      }
      if (info.size > MAX_CONFIG_BYTES) {
        view.state = 'invalid'
        view.error = `文件超过 ${Math.round(MAX_CONFIG_BYTES / 1024)} KiB`
        return { file: view, hooks: [], issues: [] }
      }
      key = `${info.mtimeMs}:${info.size}`
    } catch (error) {
      view.state = errnoOf(error) === 'ENOENT' ? 'missing' : 'unreadable'
      if (view.state === 'unreadable') view.error = messageOf(error)
      return { file: view, hooks: [], issues: [] }
    }

    const cached = cache.get(entry.path)
    if (cached !== undefined && cached.key === key) {
      view.hooks = cached.hooks.length
      return { file: view, hooks: cached.hooks, issues: cached.issues }
    }

    let parsed: { hooks: ParsedHook[]; issues: HookIssue[] }
    try {
      const text = await readFile(entry.path, 'utf8')
      const data: unknown = JSON.parse(text)
      parsed = parseHookDocument(data, { id: entry.id, path: entry.path }, options.defaultTimeoutMs)
    } catch (error) {
      view.state = errnoOf(error) === 'EACCES' || errnoOf(error) === 'EPERM' ? 'unreadable' : 'invalid'
      view.error = messageOf(error)
      cache.delete(entry.path)
      return { file: view, hooks: [], issues: [] }
    }

    const map = { DSH_HOME: options.home, project: projectDir() }
    parsed.hooks = parsed.hooks.map((hook) => ({ ...hook, command: substitutePlaceholders(hook.command, map) }))
    cache.set(entry.path, { key, ...parsed })
    view.hooks = parsed.hooks.length
    return { file: view, hooks: parsed.hooks, issues: parsed.issues }
  }

  async function snapshot(): Promise<HooksSnapshot> {
    const files = currentFiles()
    const reads = await Promise.all(files.map((entry) => readOne(entry)))
    const hooks: HookView[] = []
    const issues: HookIssue[] = []
    for (const [index, read] of reads.entries()) {
      const entry = files[index] as { id: HookFileId; path: string }
      issues.push(...read.issues)
      read.hooks.forEach((hook, hookIndex) => {
        hooks.push({
          id: `${entry.id}:${hook.event}:${hookIndex}`,
          event: hook.event,
          matcher: hook.matcher,
          command: hook.command,
          timeoutMs: hook.timeoutMs,
          source: entry.id,
          sourcePath: entry.path,
          supported: hook.supported,
        })
      })
    }
    const counts = new Map<string, number>()
    for (const hook of hooks) counts.set(hook.event, (counts.get(hook.event) ?? 0) + 1)
    const events: HookEventView[] = HOOK_EVENTS.map((event) => ({
      id: event.id,
      label: event.label,
      hint: event.hint,
      matcher: event.matcher,
      supported: event.supported,
      count: counts.get(event.id) ?? 0,
    }))
    return {
      readAt: Date.now(),
      enabled: options.enabled(),
      projectDir: projectDir(),
      files: reads.map((read) => read.file),
      hooks,
      issues,
      events,
    }
  }

  function select(snapshotValue: HooksSnapshot, event: string, subject: string): HookView[] {
    if (!HOOK_EVENT_IDS.has(event)) return []
    return snapshotValue.hooks
      .filter((hook) => hook.event === event && hook.supported)
      .filter((hook) => checkMatcher(hook.matcher, subject).matches)
  }

  return {
    snapshot,
    async hooksFor(event, subject) {
      return select(await snapshot(), event, subject)
    },
    async find(hookId) {
      return (await snapshot()).hooks.find((hook) => hook.id === hookId)
    },
    invalidate() {
      cache.clear()
    },
    files() {
      return currentFiles()
    },
  }
}
