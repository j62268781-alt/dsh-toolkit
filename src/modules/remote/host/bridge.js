/**
 * 微信 ↔ DSH 双向桥。
 *
 * 数据流：
 *   monitor（唯一 getupdates 消费者）→ bridge.handleMessage(raw)
 *     → 过滤 Bot 自己的消息 / 白名单 / 去重
 *     → 斜杠命令或审批回答（不进入 Agent）
 *     → 其余交给 conversation.js 跑一轮，再把回复发回微信
 *
 * 这里只做「编排」：状态、策略、去重、typing、错误兜底。
 * 协议细节在 api.js，会话生命周期在 conversation.js，入站转换在 inbound.js。
 */

import { homedir } from 'node:os'

import { createIlinkApi } from './api.js'
import { createApprovals } from './approvals.js'
import { helpText } from './commands.js'
import { createConversations } from './conversation.js'
import { parseCommand } from './commands.js'
import { buildInboundContent, messageKey } from './inbound.js'
import {
  describeAllSessions,
  describeCurrent,
  describeWorkspaceSessions,
  describeWorkspaces,
  isAllRef,
  loadWorkspaces,
  resolveWorkspace,
  sessionsByPrefix,
  sessionsOfWorkspace,
} from './inspect.js'
import { maskId, extractMessageText } from './ilink.js'
import { prepareOutboundText } from './markdown.js'
import { GREET_INTERVAL_MS, createPicker, parseChoice, WELCOME_TEXT } from './picker.js'
import { bridgeStatePath, createBridgeStore } from './store.js'

const TYPING_REFRESH_MS = 15_000
const COMMAND_TEXT_LIMIT = 4_000
const MAX_OUTBOUND_IMAGES = 4

function homeWorkspace() {
  return typeof process.env.HOME === 'string' && process.env.HOME !== '' ? process.env.HOME : homedir()
}

/** 只取文字部分，供命令解析使用（不触发任何下载）。 */
function commandTextOf(message) {
  return extractMessageText(message).slice(0, COMMAND_TEXT_LIMIT).trim()
}

/**
 * 创建桥接器。
 * @param options.ctx       宿主 ctx
 * @param options.settings  readConfig 的结果（含 bridge* 字段）
 * @param options.getCredential () => Promise<credential|undefined>
 * @param options.logger
 */
export function createBridge({
  ctx,
  settings,
  getCredential,
  logger,
  // 三个工厂只为单测留缝：生产路径全部用真实实现。
  createApi = createIlinkApi,
  createStore = createBridgeStore,
  createConversationManager = createConversations,
} = {}) {
  let disposed = false
  let ready
  let api
  let store
  let conversations
  /** 未绑定会话时的选择器（卡片 + 序号回复），随 conversations 一起创建。 */
  let picker
  let accountId
  const counters = { received: 0, replied: 0, skipped: 0, failed: 0 }
  const typingTickets = new Map()
  /** 最近一次 /sessions 给出的列表，供 /use <序号> 直接复用（不必再敲一遍 id）。 */
  const lastListings = new Map()
  let lastUserId
  let lastReplyAt
  let lastError
  let lastTypingError
  /** 桥接还没就绪时（store 未加载）拿到的游标，就绪后补写。 */
  let pendingCursor

  const workspaceCwd = settings.bridgeWorkspace !== '' ? settings.bridgeWorkspace : homeWorkspace()

  const approvals = createApprovals({
    logger,
    timeoutMs: settings.bridgeApprovalTimeoutMs,
    onSettled: (userId, outcome) => {
      logger?.info?.(`remote: 审批结论 ${outcome}（用户 ${maskId(userId)}）`)
    },
    notify: (userId, text) => sendText(userId, text),
  })

  /** 发一条文本（整形 + 截断 + 记录状态）。 */
  async function sendText(userId, text) {
    if (api === undefined) throw new Error('微信通道尚未就绪')
    const body = prepareOutboundText(text)
    if (body === '') return
    const contextToken = store?.getContextToken(userId)
    await api.sendText(userId, body, contextToken)
    counters.replied += 1
    lastReplyAt = Date.now()
  }

  /** 桥接开关：面板里改过的值优先于配置。 */
  function isEnabled() {
    const stored = store?.getEnabled()
    return typeof stored === 'boolean' ? stored : settings.bridgeEnabled === true
  }

  function policy() {
    const stored = store?.getPolicy()
    return stored === 'open' || stored === 'allowlist' ? stored : settings.bridgeAccessPolicy
  }

  function allowFrom() {
    const stored = store?.getAllowFrom()
    return stored !== undefined && stored.length > 0 ? stored : settings.bridgeAllowFrom
  }

  function isAllowed(userId) {
    if (!isEnabled()) return false
    if (policy() === 'open') return true
    const list = allowFrom()
    if (list.includes(userId)) {
      // 本人说过话了：从此白名单固定，不再接受「第一个人就是主人」的兜底。
      store?.pinOwner?.()
      return true
    }
    /**
     * 登录拿到的 `ilink_user_id`（扫码者）与消息里的 `from_user_id` 不保证同一个命名空间，
     * 所以播种的白名单可能一个都对不上。为了不把真正的本人挡在门外：在本人还没成功说过话之前，
     * 把第一个说话的人认作本人并锁定；锁定之后其他人一律拒绝。
     */
    if (store !== undefined && store.isOwnerPinned?.() !== true && list.length <= 1) {
      store.setAllowFrom([userId])
      store.pinOwner()
      logger?.info?.('remote: 已把第一个说话的用户认作本人，白名单锁定到该账号')
      return true
    }
    return false
  }

  /** typing 状态：开始一次，15s 刷新一次，结束时取消。失败一律忽略。 */
  function startTyping(userId) {
    let stopped = false
    const ping = async (status) => {
      try {
        let ticket = typingTickets.get(userId)
        if (ticket === undefined) {
          ticket = await api.getTypingTicket(userId, store?.getContextToken(userId))
          typingTickets.set(userId, ticket)
        }
        await api.sendTyping(userId, ticket, status)
      } catch (error) {
        // 输入状态是锦上添花：失败只在 status 里留痕，不影响回复。
        typingTickets.delete(userId)
        lastTypingError = String(error?.message ?? error)
      }
    }
    void ping(1)
    const timer = setInterval(() => {
      if (!stopped) void ping(1)
    }, TYPING_REFRESH_MS)
    timer.unref?.()
    return {
      stop() {
        if (stopped) return
        stopped = true
        clearInterval(timer)
        void ping(2)
      },
    }
  }

  /** 延迟创建（凭据可能还没配置；换账号后需要重建）。 */
  function ensureReady() {
    if (ready !== undefined) return ready
    ready = (async () => {
      const credential = await getCredential()
      if (credential === undefined) throw new Error('未找到微信凭据，请先连接微信')
      accountId = credential.accountId
      api = createApi({
        baseUrl: credential.baseUrl,
        token: credential.token,
        timeoutMs: settings.bridgeRequestTimeoutMs,
      })
      store = createStore({ filePath: bridgeStatePath(accountId), logger })
      await store.load()
      /**
       * 连接成功即启用桥接，且默认只对自己开放（面板不再提供开关/策略）。
       * 落盘里可能是旧版本留下的 false / open，这里统一纠正。
       */
      if (store.getEnabled() !== true) store.setEnabled(true)
      if (store.getPolicy() !== 'allowlist') store.setPolicy('allowlist')
      if (store.getAllowFrom().length === 0) {
        // 「本人」= 扫码登录的这个微信号；只作初始播种，真正认人看第一条消息（见 isAllowed）。
        const owner = typeof credential.userId === 'string' ? credential.userId.trim() : ''
        if (owner !== '') store.setAllowFrom([owner])
      }
      if (typeof pendingCursor === 'string' && pendingCursor !== '') {
        store.setCursor(pendingCursor)
        pendingCursor = undefined
      }
      conversations = createConversationManager({
        ctx,
        settings: {
          accountId,
          agentPreset: settings.bridgeAgentPreset,
          permissionPreset: settings.bridgePermissionPreset,
        },
        workspaceCwd,
        logger,
        generations: {
          get: (userId) => store.getGeneration(userId),
          set: (userId, generation) => store.setGeneration(userId, generation),
        },
        bindings: {
          get: (userId) => store.getBinding(userId),
          set: (userId, sessionId) => store.setBinding(userId, sessionId),
          clear: (userId) => store.clearBinding(userId),
        },
        onApproval: (userId) => (request, next) => {
          if (disposed || !isAllowed(userId)) return next()
          // 带上会话 id：审批提示里必须能看出是哪条会话在等。
          return approvals.request(userId, request, { sessionId: conversations?.sessionIdOf?.(userId) ?? '' })
        },
      })
      picker = createPicker({ ctx, conversations, workspaceCwd, home: homeWorkspace(), logger })
      logger?.info?.(`remote: 桥接就绪（账号 ${maskId(accountId)}，工作区 ${workspaceCwd}）`)
    })()
    ready.catch((error) => {
      ready = undefined
      api = undefined
      store = undefined
      lastError = String(error?.message ?? error)
    })
    return ready
  }

  /** 换账号/退出登录时重建。 */
  function reset() {
    picker = undefined
    conversations?.dispose()
    conversations = undefined
    approvals.dispose()
    api = undefined
    store = undefined
    accountId = undefined
    typingTickets.clear()
    lastListings.clear()
    ready = undefined
  }

  /** /sessions [序号|路径|all]：不带参数时用当前工作区。 */
  async function sendSessions(userId, args) {
    const ref = typeof args === 'string' ? args.trim() : ''
    const currentSessionId = conversations.sessionIdOf(userId)
    if (isAllRef(ref)) {
      await sendText(userId, await describeAllSessions({ ctx, currentSessionId }))
      return
    }
    const workspaces = await loadWorkspaces(ctx)
    const workspace = ref === '' ? workspaces.find((item) => item.path === workspaceCwd) : resolveWorkspace(workspaces, ref)
    if (workspace === undefined) {
      await sendText(
        userId,
        ref === ''
          ? `当前工作区（${workspaceCwd}）还没有登记，历史里也没有它的会话。\n用 /workspaces 看现有工作区。`
          : `找不到工作区「${ref}」。先用 /workspaces 看序号或路径。`,
      )
      return
    }
    const listing = await sessionsOfWorkspace(ctx, workspace.path)
    lastListings.set(userId, listing.sessions)
    await sendText(userId, await describeWorkspaceSessions({ ctx, workspace, currentSessionId, listing }))
  }

  /**
   * /use <序号|id前缀>：把微信这条会话切到 DSH 里已经存在的某条会话上。
   * 序号取最近一次 /sessions 的列表；id 前缀可跨工作区，要求唯一。
   */
  async function useSession(userId, args) {
    const ref = typeof args === 'string' ? args.trim() : ''
    const current = conversations.sessionIdOf(userId)
    if (ref === '') {
      await sendText(userId, [
        `当前会话：${current}`,
        '',
        '用法：/use <序号>（最近一次 /sessions 里的序号）或 /use <id前缀>（可跨工作区）。',
        '先发 /sessions 看列表，/new 则另外开一条新会话。',
      ].join('\n'))
      return
    }

    let target
    if (/^\d+$/.test(ref)) {
      const listing = lastListings.get(userId) ?? (await sessionsOfWorkspace(ctx, workspaceCwd)).sessions
      target = listing[Number(ref) - 1]
      if (target === undefined) {
        await sendText(userId, `序号 ${ref} 超出范围（列表里只有 ${listing.length} 条）。先发 /sessions 看一遍。`)
        return
      }
    } else {
      const matches = await sessionsByPrefix(ctx, ref)
      if (matches.length === 0) {
        await sendText(userId, `没找到 id 以「${ref}」开头的会话。用 /sessions 看看有哪些。`)
        return
      }
      if (matches.length > 1) {
        const lines = [`「${ref}」匹配到 ${matches.length} 条，请再补几位 id：`]
        for (const match of matches) lines.push(`· ${match.title ?? '（未命名）'} · ${match.id}`)
        await sendText(userId, lines.join('\n'))
        return
      }
      target = matches[0]
    }

    if (target.id === current) {
      await sendText(userId, `已经在这条会话上了：${target.id}`)
      return
    }

    if (conversations.isBusy?.(userId) === true) {
      await sendText(userId, '这条会话还在回答中，先发 /cancel 中止，再切换。')
      return
    }
    conversations.switchTo(userId, target.id)
    const live = typeof ctx.agents?.get === 'function' ? ctx.agents.get(target.id) : undefined
    await sendText(userId, [
      `已切到会话：${target.title ?? '（未命名）'}`,
      `session_id：${target.id}`,
      live === undefined
        ? '（已从历史恢复；下一条消息在这个会话里继续，之前的上下文都在）'
        : '（这条会话正在 DSH 里开着，直接接管，不会重开）',
    ].join('\n'))
  }

  async function runCommand(userId, command) {
    // 命令会改变「可选项」，旧的序号映射作废（/start 会在下面重新发一张卡）。
    picker?.clearChoice?.(userId)
    switch (command.name) {
      case 'start': {
        await promptForSession(userId)
        return true
      }
      case 'help':
        await sendText(userId, helpText())
        return true
      case 'status': {
        const status = statusSnapshot()
        await sendText(userId, [
          `微信桥接：${status.enabled ? '已开启' : '已关闭'}`,
          `策略：${status.accessPolicy}${status.accessPolicy === 'allowlist' ? `（${status.allowCount} 人）` : ''}`,
          `会话：${status.conversation ?? '尚未创建'}`,
          `待审批：${status.pendingApprovals}`,
          `已收 ${status.received} 条 / 已回 ${status.replied} 条`,
        ].join('\n'))
        return true
      }
      case 'new':
      case 'reset': {
        const sessionId = conversations.rotate(userId)
        await sendText(userId, `已开启新会话（${sessionId}）。\n想回到旧会话可以用 /sessions 找到它，再 /use <序号>。`)
        await replaySuspended(userId)
        return true
      }
      case 'stop':
      case 'cancel': {
        const cancelled = await conversations.cancel(userId)
        await sendText(userId, cancelled ? '已中止当前回答。' : '当前没有正在进行的回答。')
        return true
      }
      case 'where':
      case 'info': {
        const sessionId = conversations.sessionIdOf(userId)
        const lines = [await describeCurrent({ ctx, sessionId, workspaceCwd })]
        const source = conversations.sourceOf?.(userId) ?? 'auto'
        lines.push(source === 'picked'
          ? '会话来源：手动选择（/use 或选择卡）'
          : source === 'created'
            ? '会话来源：/new 新建'
            : '会话来源：自动派生（发 /start 可以自己选一条）')
        if (typeof ctx.agents?.get === 'function' && ctx.agents.get(sessionId) !== undefined) {
          lines.push('运行状态：正在 DSH 里运行（接管中）')
        }
        await sendText(userId, lines.join('\n'))
        return true
      }
      case 'workspaces':
      case 'ws': {
        await sendText(userId, await describeWorkspaces(ctx))
        return true
      }
      case 'sessions':
        await sendSessions(userId, command.args)
        return true
      case 'ls':
        await sendSessions(userId, command.args)
        return true
      case 'use':
      case 'switch':
      case 'bind':
        await useSession(userId, command.args)
        await replaySuspended(userId)
        return true
      case 'approve':
      case 'reject':
        await sendText(userId, '当前没有待审批的请求。')
        return true
      default:
        await sendText(userId, `未知命令 /${command.name}。\n\n${helpText()}`)
        return true
    }
  }

  /** 跑一轮对话并回复。 */
  async function processMessage(userId, message) {
    let typing
    try {
      const inbound = await buildInboundContent({
        message,
        api,
        attachments: ctx.attachments,
        workspaceCwd,
        logger,
        includeImages: settings.bridgeIncludeImages,
      })
      typing = startTyping(userId)
      const reply = await conversations.process(userId, inbound.content)
      await sendText(userId, reply.text)
      for (const attachment of reply.images.slice(-MAX_OUTBOUND_IMAGES)) {
        try {
          const { data } = await ctx.attachments.readImage(attachment)
          await api.sendImage(userId, Buffer.from(data), store?.getContextToken(userId))
        } catch (error) {
          logger?.warn?.(`remote: 回发图片失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } catch (error) {
      if (error?.code === 'SESSION_MISSING') {
        // 绑定过的会话被删了：解除绑定并重新发卡，别让它一直失败。
        conversations.unbind?.(userId)
        lastError = String(error.message ?? error)
        logger?.warn?.(`[remote] 绑定的会话已不存在：${lastError}`)
        try {
          const card = await picker.showWorkspaces(userId)
          await sendText(userId, [`你选的会话已经找不到了（${error.sessionId}）。`, '已经从绑定里移除，重新选一条：', '', card].join('\n'))
        } catch {
          // 连卡片都发不出去时只能记日志。
        }
        return
      }
      counters.failed += 1
      lastError = String(error?.message ?? error)
      logger?.warn?.(`[remote] 处理微信消息失败：${lastError}`)
      try {
        await sendText(userId, `处理失败：${lastError}`)
      } catch {
        // 连错误都发不出去时只能记日志。
      }
    } finally {
      typing?.stop()
    }
  }

  /** 这个用户是否该补一句欢迎语（首次接触，或隔了一天没说话）。 */
  function needsGreeting(userId) {
    const last = store?.getGreetedAt?.(userId)
    return last === undefined || Date.now() - last >= GREET_INTERVAL_MS
  }

  /** 发选择卡（先工作区、再会话）；欢迎语只在首次或隔天时补在前面，避免每条消息都寒暄。 */
  async function promptForSession(userId) {
    const card = await picker.showWorkspaces(userId)
    if (needsGreeting(userId)) {
      store?.setGreetedAt?.(userId, Date.now())
      await sendText(userId, `${WELCOME_TEXT}\n\n${card}`)
      return
    }
    await sendText(userId, card)
  }

  /** 选完会话后，把刚才挂起的那条问题补跑掉。 */
  async function replaySuspended(userId) {
    const suspended = picker?.takePending?.(userId)
    if (suspended === undefined) return
    try {
      await sendText(userId, '接着回你刚才那条：')
    } catch {
      // 提示发不出去不影响补跑。
    }
    await processMessage(userId, suspended)
  }

  /** 正在等选择时，把纯数字回复当选项消费掉。 */
  async function handleChoice(userId, text) {
    if (picker === undefined) return false
    const number = parseChoice(text)
    if (number === undefined) return false
    if (!picker.isAwaiting(userId)) return false
    const result = await picker.choose(userId, number)
    if (result === undefined) return false
    for (const line of result.texts) await sendText(userId, line)
    if (result.bound !== undefined) await replaySuspended(userId)
    return true
  }

  /**
   * monitor 收到的原始消息入口（不要 await：监听循环必须继续）。
   * @param message iLink 原始消息
   */
  function handleMessage(message) {
    if (disposed) return Promise.resolve()
    if (Number(message?.message_type) !== 1) return Promise.resolve()
    const userId = typeof message?.from_user_id === 'string' ? message.from_user_id.trim() : ''
    if (userId === '') return Promise.resolve()
    return (async () => {
      try {
        /**
         * 必须先加载状态：开关/策略/白名单都存在桥状态文件里。
         * 如果先判 isEnabled()，重启后面板里开过的开关还没读进来，
         * 消息会在第一行被静默丢弃（曾经的线上问题）。
         */
        await ensureReady()
      } catch (error) {
        lastError = String(error?.message ?? error)
        return
      }
      if (!isEnabled()) return
      counters.received += 1
      // 先记下最近联系人：面板要靠它把「允许此人」加进白名单。
      lastUserId = userId
      if (!isAllowed(userId)) {
        counters.skipped += 1
        logger?.info?.(`remote: 忽略未授权用户 ${maskId(userId)} 的消息`)
        return
      }
      const key = messageKey(message)
      if (store.hasSeen(key)) return
      store.markSeen(key)
      const contextToken = typeof message?.context_token === 'string' ? message.context_token : ''
      if (contextToken !== '') store.setContextToken(userId, contextToken)
      const text = commandTextOf(message)

      if (approvals.hasPending(userId)) {
        if (approvals.answer(userId, text)) return
        const pendingSession = approvals.pendingSessionOf?.(userId)
        await sendText(
          userId,
          `有工具调用正在等待审批${pendingSession === undefined || pendingSession === '' ? '' : `（会话 ${pendingSession}）`}：回复 /approve 或 /reject。`,
        ).catch(() => {})
        return
      }

      const command = parseCommand(text)
      if (command !== undefined) {
        // 命令永远放行：基础命令不能被「还没选会话」拦住。
        await runCommand(userId, command).catch((error) => {
          logger?.warn?.(`[remote] 执行命令失败：${error instanceof Error ? error.message : String(error)}`)
        })
        return
      }

      // 正在等选择时，纯数字就是选项。
      if (await handleChoice(userId, text)) return

      // 还没选会话：不进 Agent，先挂起这条消息再发选择卡（选完自动补跑）。
      if (conversations.bindingOf?.(userId) === undefined) {
        picker?.suspend?.(userId, message)
        await promptForSession(userId).catch((error) => {
          logger?.warn?.(`[remote] 发送选择卡失败：${error instanceof Error ? error.message : String(error)}`)
        })
        return
      }

      // 不在这里 await 的是调用方（monitor）：监听循环必须继续。
      // 这里返回 promise，方便单测等这一轮处理完。
      return processMessage(userId, message)
    })()
  }

  function statusSnapshot() {
    return {
      enabled: isEnabled(),
      ready: ready !== undefined && api !== undefined,
      accessPolicy: policy(),
      allowCount: allowFrom().length,
      allowFrom: allowFrom().map((id) => maskId(id)),
      received: counters.received,
      replied: counters.replied,
      skipped: counters.skipped,
      failed: counters.failed,
      pendingApprovals: approvals.size(),
      conversation: conversations?.sessionIdOf(lastUserId),
      sessionBound: lastUserId === undefined ? undefined : conversations?.bindingOf?.(lastUserId) !== undefined,
      sessionSource: lastUserId === undefined ? undefined : conversations?.sourceOf?.(lastUserId),
      awaitingChoice: lastUserId === undefined ? false : picker?.isAwaiting?.(lastUserId) === true,
      lastUserId: lastUserId === undefined ? undefined : maskId(lastUserId),
      canAllowRecent: lastUserId !== undefined && !allowFrom().includes(lastUserId),
      store: store?.summary() ?? {},
      lastReplyAt,
      lastError,
      lastTypingError,
      workspace: workspaceCwd,
    }
  }

  return {
    handleMessage,
    status: statusSnapshot,

    /**
     * 启动时预热：把落盘状态读进来，让面板上的开关/策略一启动就正确。
     * 没有凭据时静默失败（等登录成功后再调一次）。
     */
    async warmup() {
      try {
        await ensureReady()
      } catch {
        // 未登录属正常情况，等 onConnected 再预热。
      }
    },

    /** 面板上的「发送测试消息」：默认发给最近一次给自己发消息的用户。 */
    async sendTest(userId, text = '这是一条来自 DSH 桌面端的测试消息。') {
      await ensureReady()
      const target = userId !== undefined && userId !== '' ? String(userId) : lastUserId
      if (target === undefined) throw new Error('还没有收到过微信消息，无法确定测试接收人')
      await sendText(target, text)
      return statusSnapshot()
    },

    /** 运行时切换访问策略（同时落盘到桥状态文件）。 */
    async setAccess(patch = {}) {
      await ensureReady()
      if (typeof patch.enabled === 'boolean') store.setEnabled(patch.enabled)
      if (patch.policy === 'open' || patch.policy === 'allowlist') store.setPolicy(patch.policy)
      if (Array.isArray(patch.allowFrom)) store.setAllowFrom(patch.allowFrom)
      /**
       * allowRecent：把最近一位给自己发过消息的人加进白名单。
       * 前端只能看到脱敏 id，所以「允许此人」必须由 host 用真实 id 补全。
       */
      if (patch.allowRecent === true && lastUserId !== undefined) {
        store.setAllowFrom([...store.getAllowFrom(), lastUserId])
      }
      return statusSnapshot()
    },

    /** 登录状态变化时调用：断开重连后重建 api（账号可能已经换了）。 */
    reset,
    async dispose() {
      disposed = true
      approvals.dispose()
      conversations?.dispose()
      await store?.flush().catch(() => {})
    },
    get ready() {
      return api !== undefined
    },
    get cursor() {
      return {
        get: () => store?.getCursor() ?? pendingCursor ?? '',
        set: (value) => {
          pendingCursor = typeof value === 'string' ? value : ''
          store?.setCursor(pendingCursor)
        },
      }
    },
  }
}
