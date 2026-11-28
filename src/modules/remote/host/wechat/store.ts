/**
 * 微信桥的持久化状态：get_updates_buf 游标、每个用户的 context_token、已处理消息去重表。
 *
 * 为什么必须落盘：
 *   · getupdates 是「消费型」接口，游标丢失会让重启后的第一轮把历史消息再收一遍；
 *   · context_token 只随入站消息下发，丢了就没法再主动回复该用户（必须等他再说一句）。
 *
 * 文件位于 `~/.dsh/toolkit/wechat-bridge/<sha256(accountId) 前 16 位>.json`，权限 0600；
 * 里面只有标识符与令牌，不含任何消息正文。
 */

import { createHash } from 'node:crypto'
import { linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHome } from '../../../../host/dsh-home.js'

const STATE_VERSION = 1
const MAX_SEEN_KEYS = 500
const SAVE_DEBOUNCE_MS = 400

/** 状态文件路径：按 accountId 分文件，换账号不会串味。 */
export function bridgeStatePath(accountId: any, { homeDir = dshHome() }: any = {}) {
  const digest = createHash('sha256').update(String(accountId)).digest('hex').slice(0, 16)
  return join(homeDir, 'toolkit', 'wechat-bridge', `${digest}.json`)
}

/** 必须先于 ds-harness-remote 启动：它把整个旧 remote 目录视为待迁移的配对数据。 */
export function migrateLegacyBridgeState(homeDir = dshHome()): void {
  const legacy = join(homeDir, 'remote')
  const toolkit = join(homeDir, 'toolkit')
  const destination = join(toolkit, 'wechat-bridge')
  if (!lstatSync(legacy, { throwIfNoEntry: false })?.isDirectory()) return
  if (lstatSync(join(homeDir, '.ds-harness-remote-migration', 'legacy-root.json'), { throwIfNoEntry: false })
    && !lstatSync(join(homeDir, 'ds-harness-remote'), { throwIfNoEntry: false })?.isDirectory()) return
  for (const entry of readdirSync(legacy, { withFileTypes: true })) {
    if (!entry.isFile() || !/^[a-f0-9]{16}\.json$/.test(entry.name)) continue
    const from = join(legacy, entry.name)
    const metadata = lstatSync(from, { throwIfNoEntry: false })
    if (!metadata?.isFile() || metadata.size > 16 * 1024 * 1024) continue
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) continue
    let state
    try {
      state = JSON.parse(readFileSync(from, 'utf8'))
    } catch (error) {
      if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (state?.version !== STATE_VERSION || typeof state.cursor !== 'string'
      || state.contexts === null || typeof state.contexts !== 'object' || Array.isArray(state.contexts)
      || !Array.isArray(state.seen)) continue

    for (const directory of [toolkit, destination]) {
      const current = lstatSync(directory, { throwIfNoEntry: false })
      if (current === undefined) mkdirSync(directory, { recursive: true, mode: 0o700 })
      if (!lstatSync(directory).isDirectory()) throw new Error('微信桥状态目标必须是真实目录')
    }
    const to = join(destination, entry.name)
    try {
      // link 不覆盖目标；若上次只完成了 link，用 inode 确认后再清理旧路径。
      linkSync(from, to)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      if (code !== 'EEXIST') throw error
      const existing = lstatSync(to, { throwIfNoEntry: false })
      if (!existing?.isFile() || existing.dev !== metadata.dev || existing.ino !== metadata.ino) continue
    }
    const remaining = lstatSync(from, { throwIfNoEntry: false })
    if (remaining?.dev !== metadata.dev || remaining.ino !== metadata.ino) continue
    try {
      unlinkSync(from)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  try {
    rmdirSync(legacy)
  } catch (error) {
    // 目录里可能还有真正的配对记录，交给 ds-harness-remote 自己处理。
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
  }
}

function emptyState(): any {
  return { version: STATE_VERSION, cursor: '', contexts: {}, generations: {}, bindings: {}, greeted: {}, seen: [], enabled: undefined, policy: undefined, allowFrom: [], ownerPinned: false, updatedAt: 0 }
}

/**
 * 创建一个状态仓库。
 * @param options.filePath 状态文件绝对路径（由 bridge 用 bridgeStatePath 算好）
 * @param options.logger   cordis logger（可选）
 */
export function createBridgeStore({ filePath, logger }: any = {}) {
  let state = emptyState()
  let loaded = false
  let timer: any
  let writing = Promise.resolve()

  async function persist() {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
    const temp = `${filePath}.${process.pid}.tmp`
    state.updatedAt = Date.now()
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, filePath)
  }

  function scheduleSave() {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      writing = writing.then(() => persist()).catch((error) => {
        logger?.warn?.(`remote: 保存桥状态失败：${error instanceof Error ? error.message : String(error)}`)
      })
    }, SAVE_DEBOUNCE_MS)
    timer.unref?.()
  }

  return {
    /** 读一次磁盘状态；文件不存在或损坏时回退到空状态（不阻塞桥启动）。 */
    async load() {
      if (loaded) return
      loaded = true
      try {
        const text = await readFile(filePath, 'utf8')
        const parsed = JSON.parse(text)
        if (parsed !== null && typeof parsed === 'object') {
          state = {
            version: STATE_VERSION,
            cursor: typeof parsed.cursor === 'string' ? parsed.cursor : '',
            contexts: parsed.contexts !== null && typeof parsed.contexts === 'object' ? { ...parsed.contexts } : {},
            generations: parsed.generations !== null && typeof parsed.generations === 'object'
              ? Object.fromEntries(Object.entries(parsed.generations)
                .map(([key, value]: any) => [key, Number(value)]).filter(([, value]: any) => Number.isInteger(value) && value >= 1))
              : {},
            bindings: parsed.bindings !== null && typeof parsed.bindings === 'object'
              ? Object.fromEntries(Object.entries(parsed.bindings).filter(([, value]: any) => typeof value === 'string' && value !== ''))
              : {},
            greeted: parsed.greeted !== null && typeof parsed.greeted === 'object'
              ? Object.fromEntries(Object.entries(parsed.greeted)
                .map(([key, value]: any) => [key, Number(value)]).filter(([, value]: any) => Number.isFinite(value) && value > 0))
              : {},
            seen: Array.isArray(parsed.seen) ? parsed.seen.filter((key: any) => typeof key === 'string').slice(-MAX_SEEN_KEYS) : [],
            enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : undefined,
            policy: typeof parsed.policy === 'string' ? parsed.policy : undefined,
            allowFrom: Array.isArray(parsed.allowFrom) ? parsed.allowFrom.filter((id: any) => typeof id === 'string') : [],
            ownerPinned: parsed.ownerPinned === true,
            updatedAt: Number(parsed.updatedAt) || 0,
          }
        }
      } catch (error: any) {
        if (error?.code !== 'ENOENT') {
          logger?.warn?.(`remote: 读取桥状态失败，按空状态继续：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    },

    getCursor() {
      return state.cursor
    },

    setCursor(cursor: any) {
      const value = typeof cursor === 'string' ? cursor : ''
      if (value === state.cursor) return
      state.cursor = value
      scheduleSave()
    },

    getContextToken(userId: any) {
      const value = state.contexts[String(userId)]
      return typeof value === 'string' && value !== '' ? value : undefined
    },

    setContextToken(userId: any, contextToken: any) {
      const key = String(userId)
      const value = typeof contextToken === 'string' ? contextToken : ''
      if (value === '') return
      if (state.contexts[key] === value) return
      state.contexts[key] = value
      scheduleSave()
    },

    /**
     * 该用户当前的会话代号（1 = 首个会话，/new 之后递增）。
     * 必须落盘：否则重启后 /new 的记忆丢失，会跳回旧会话继续聊。
     */
    getGeneration(userId: any) {
      const value = state.generations[String(userId)]
      return Number.isInteger(value) && value >= 1 ? value : undefined
    },

    setGeneration(userId: any, generation: any) {
      const key = String(userId)
      const value = Number(generation)
      if (!Number.isInteger(value) || value < 1) return
      if (state.generations[key] === value) return
      state.generations[key] = value
      scheduleSave()
    },

    /**
     * 该用户手动绑定到哪条会话（/use 选的）。undefined 表示还没选过，用自动派生的 id。
     * 必须落盘：否则重启后又跳回自动派生的那条会话。
     */
    getBinding(userId: any) {
      const value = state.bindings[String(userId)]
      return typeof value === 'string' && value !== '' ? value : undefined
    },

    setBinding(userId: any, sessionId: any) {
      const key = String(userId)
      const value = typeof sessionId === 'string' ? sessionId.trim() : ''
      if (value === '') return
      if (state.bindings[key] === value) return
      state.bindings[key] = value
      scheduleSave()
    },

    clearBinding(userId: any) {
      const key = String(userId)
      if (state.bindings[key] === undefined) return
      delete state.bindings[key]
      scheduleSave()
    },

    /**
     * 上次发欢迎语的时间戳（毫秒）。用来实现「首次接触或隔了一天没说话才再打招呼」。
     * 必须落盘：否则每次重启都重新播一遍欢迎语。
     */
    getGreetedAt(userId: any) {
      const value = state.greeted[String(userId)]
      return Number.isFinite(value) && value > 0 ? value : undefined
    },

    setGreetedAt(userId: any, at = Date.now()) {
      const key = String(userId)
      const value = Number(at)
      if (!Number.isFinite(value) || value <= 0) return
      state.greeted[key] = value
      scheduleSave()
    },

    hasSeen(key: any) {
      return state.seen.includes(key)
    },

    markSeen(key: any) {
      if (typeof key !== 'string' || key === '' || state.seen.includes(key)) return
      state.seen.push(key)
      if (state.seen.length > MAX_SEEN_KEYS) state.seen = state.seen.slice(-MAX_SEEN_KEYS)
      scheduleSave()
    },

    /** 给状态接口用的摘要（有意不含 token 明文）。 */
    summary() {
      return {
        cursor: state.cursor === '' ? 'empty' : 'saved',
        contexts: Object.keys(state.contexts).length,
        generations: Object.keys(state.generations).length,
        bindings: Object.keys(state.bindings).length,
        greeted: Object.keys(state.greeted).length,
        seen: state.seen.length,
        updatedAt: state.updatedAt,
      }
    },

    /** 桥接开关；undefined 表示还没在面板里改过（用配置默认值）。 */
    getEnabled() {
      return state.enabled
    },

    setEnabled(enabled: any) {
      if (typeof enabled !== 'boolean' || state.enabled === enabled) return
      state.enabled = enabled
      scheduleSave()
    },

    /** 访问策略：'open' | 'allowlist'；undefined 表示还没设置过（用配置默认值）。 */
    getPolicy() {
      return state.policy
    },

    setPolicy(policy: any) {
      if (policy !== 'open' && policy !== 'allowlist') return
      if (state.policy === policy) return
      state.policy = policy
      scheduleSave()
    },

    /** 白名单（原始用户 id，仅在 host 内存里与状态文件中使用，不回前端明文）。 */
    getAllowFrom() {
      return [...state.allowFrom]
    },

    setAllowFrom(list: any) {
      const next = [...new Set((Array.isArray(list) ? list : []).map((id) => String(id).trim()).filter((id) => id !== ''))]
      state.allowFrom = next
      scheduleSave()
      return [...next]
    },

    /**
     * 「本人」是否已经确认过。
     *
     * 登录拿到的是扫码用户的 `ilink_user_id`，消息里是 `from_user_id`，两者不保证同一个命名空间；
     * 所以在本人真正说过一句话之前不锁定，第一个说话的人会被认作本人（之后陌生人一律拒绝）。
     */
    isOwnerPinned() {
      return state.ownerPinned === true
    },

    pinOwner() {
      if (state.ownerPinned === true) return
      state.ownerPinned = true
      scheduleSave()
    },

    /** 立即落盘（停止监听/退出时调用）。 */
    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      writing = writing.then(() => persist())
      await writing
    },
  }
}
