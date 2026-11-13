/**
 * 微信会话 ↔ DSH Agent 的映射与生命周期。
 *
 * 每个微信用户对应一个持久 Session（id 由 accountId + 用户 id 派生，跨重启稳定）：
 *   · 首次消息：ctx.agents.create 建会话，挂载预设、设置权限、注入身份提示；
 *   · 重启后：ctx.agents.get 拿不到实例时用 ctx.agents.resume 恢复历史；
 *   · 同一用户的多次消息串行处理（同一 Agent 同时只跑一个 turn）。
 *
 * 这里只负责「跑一轮并把回复取出来」，发哪条消息、怎么发由 bridge.js 决定。
 */

import { createHash } from 'node:crypto'

import { createUserMessage } from '@deepseek-ai/dsh-llm'

import { prepareOutboundText } from './markdown.js'

/**
 * 把本插件的 source.kind 注册进宿主的消息来源表。
 *
 * `MessageSourceMap` 是「合并扩展」的接口：每个 producer 在自己的模块里声明自己的 kind，
 * 宿主没有（也明确不要）共享的 catch-all `plugin` kind。不在这里声明，`createUserMessage`
 * 会在类型层拒绝 `plugin:toolkit-remote` —— 而运行时它是合法的（见下方 INSTRUCTIONS_SOURCE）。
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'plugin:toolkit-remote': { kind: 'plugin:toolkit-remote'; form: 'instructions' }
  }
}

const REPLY_TIMEOUT_MS = 180_000
/**
 * 注入身份提示时用的来源标记。
 *
 * DSH 会话格式 v4 只接受「producer-owned」的 source.kind：写成 `{ kind: 'plugin', plugin }`
 * 会被会话写入端直接拒绝（`format v4 message requires a producer-owned source kind`），
 * 而且这个错误发生在写入历史时，首条消息可能正常、下一条才炸。插件来源的规范写法是
 * `plugin:<插件名>`（与运行时写入的 `plugin:claude-mem` 一致）。
 */
export const INSTRUCTIONS_SOURCE = Object.freeze({ kind: 'plugin:toolkit-remote', form: 'instructions' })
const SYSTEM_PROMPT = [
  '你正在通过微信私聊与用户对话，你的回复会被直接发送到微信。',
  '请用简洁的纯文本回答（不要用 Markdown 标题/加粗/图片语法，微信不渲染）。',
  '需要发长内容时先给结论，再补充必要细节；需要发文件时说明文件路径。',
  '如果用户的问题需要较长时间处理，先回复一句已收到，再在完成后发送结果。',
].join('\n')

function digestOf(value: any) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
}

/** 会话 id：稳定、可读前缀、不含敏感原文。 */
export function sessionIdFor(accountId: any, userId: any, generation = 1) {
  const base = `remote-${digestOf(`${accountId}:${userId}`)}`
  return generation <= 1 ? base : `${base}-r${generation}`
}

/** 会话标题（展示在 DSH 会话列表里）。 */
export function sessionTitleFor(userId: any) {
  const text = String(userId)
  const tail = text.length > 6 ? `…${text.slice(-4)}` : text
  return `微信 · ${tail}`
}

/** 事件日志长度：新版 Session 是 `seq`，旧版与测试桩是 `events` 数组。 */
export function eventCount(agent: any) {
  const session = agent?.session
  if (typeof session?.seq === 'number') return session.seq
  return Array.isArray(session?.events) ? session.events.length : 0
}

/** 取 start 之后新增的事件（半开区间）。 */
export function eventsSince(agent: any, start: any) {
  const session = agent?.session
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents(start)
  const events = Array.isArray(session?.events) ? session.events : []
  return events.slice(start)
}

/** 从 turn 事件里取出回复文本与图片。 */
export function collectReply(events: any) {
  const texts = []
  const images = []
  let sawError = false
  let errorText
  for (const event of events) {
    if (event?.type === 'assistant/message') {
      const content = Array.isArray(event.data?.message?.content) ? event.data.message.content : []
      if (content.some((block: any) => block?.type === 'tool-call')) continue
      const text = content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text)
        .join('\n\n')
        .trim()
      if (text !== '') texts.push(text)
      for (const block of content) {
        if (block?.type === 'image' && block.attachment !== undefined) images.push(block.attachment)
      }
    }
    // turn/end 的形状是 { turn, reason: { kind, error? } }，不是 { error }。
    if (event?.type === 'turn/end') {
      const reason = event.data?.reason
      if (reason?.kind === 'error') {
        sawError = true
        const message = reason.error?.message
        if (typeof message === 'string' && message !== '') errorText = message
      } else if (event.data?.error !== undefined && event.data?.error !== null) {
        sawError = true
      }
    }
  }
  return { text: texts.join('\n\n').trim(), images, sawError, errorText }
}

/** 给 whenIdle 之类的等待加超时。 */
async function withTimeout(promise: any, timeoutMs: any, label: any) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}超时（${Math.round(timeoutMs / 1000)}s）`)), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 创建会话管理器。
 *
 * 一个微信用户同一时间只驱动**一条** DSH 会话：
 *   · 默认用从 accountId + userId 派生的 id（重启后仍是同一条）；
 *   · 用户可以用 /use 绑定到任意一条已有会话（含 GUI 里正开着的），也可以 /new 换一条；
 *   · 绑定关系落盘（bindings），重启后继续用同一条。
 *
 * 「接管」与「恢复」的区别很重要：
 *   · 会话在 DSH 里正开着（agents.get 拿得到 agent）→ 直接接管，**不能 dispose**，
 *     否则会把 GUI 里那条会话一起关掉；
 *   · 只有历史会话 → agents.resume，并挂上会话头里记录的 agentPreset；
 *   · 我们自己创建/恢复的 agent 才在切换时 dispose。
 *
 * @param options.ctx         宿主 ctx（agents / agentPresets / permissionPresets / sessionPersistence / llm ...）
 * @param options.settings     模块设置（agentPreset / permissionPreset）
 * @param options.workspaceCwd 新建会话的工作目录
 * @param options.logger       logger
 * @param options.onApproval   审批转发钩子 (userId) => listener|undefined
 * @param options.generations  会话代号持久化 {get(userId):number|undefined, set(userId,generation)}（可选）
 * @param options.bindings     会话绑定持久化 {get(userId):string|undefined, set(userId,sessionId), clear(userId)}（可选）
 */
export function createConversations({ ctx, settings, workspaceCwd, logger, onApproval, generations, bindings }: any = {}) {
  /** userId → { sessionId, generation, bound, source, cwd, owned, handle, queue } */
  const states = new Map()
  const disposers = new Map()

  function stateFor(userId: any) {
    let state = states.get(userId)
    if (state === undefined) {
      const bound = typeof bindings?.get === 'function' ? bindings.get(userId) : undefined
      const stored = Number(generations?.get?.(userId))
      const generation = Number.isInteger(stored) && stored >= 1 ? stored : 1
      const useBound = typeof bound === 'string' && bound !== ''
      state = {
        sessionId: useBound ? bound : sessionIdFor(settings.accountId, userId, generation),
        generation,
        bound: useBound,
        // 会话来源：auto=自动派生（还没选过）、picked=/use 或选择卡选的、created=/new 新建的
        source: useBound ? 'picked' : 'auto',
        // 这个用户新建会话时用的工作区（选择卡里换过工作区就按这个来）
        cwd: undefined,
        owned: false,
        handle: undefined,
        queue: Promise.resolve(),
      }
      states.set(userId, state)
    }
    return state
  }

  /**
   * 挂审批监听；接管来的 agent 没有走过 setup，所以这里单独挂一次。
   * 注意：agent.ctx 是 cordis 的 Context proxy —— 读它没有的属性会抛错而不是返回
   * undefined，?. 兜不住。所以先 try 再判定，别让审批监听把整轮对话带崩。
   */
  function attachApproval(agent: any, userId: any) {
    if (typeof onApproval !== 'function' || disposers.has(userId)) return
    let agentCtx
    try {
      agentCtx = agent?.ctx
    } catch {
      return
    }
    if (typeof agentCtx?.on !== 'function') return
    const listener = onApproval(userId)
    if (typeof listener === 'function') disposers.set(userId, agentCtx.on('approval/request', listener))
  }

  function detachApproval(userId: any) {
    const dispose = disposers.get(userId)
    if (typeof dispose === 'function') dispose()
    disposers.delete(userId)
  }

  /** 解析 preset：给定名字优先，名字为空或解析失败时退回宿主默认。 */
  async function resolvePresetId(name: any) {
    try {
      return (await ctx.agentPresets.resolve(name === '' || name === undefined ? undefined : name)).id
    } catch {
      return (await ctx.agentPresets.resolve(undefined)).id
    }
  }

  /** 恢复或创建一条会话（不处理「已经在跑」的情况）。 */
  async function openAgent(state: any, userId: any) {
    const agentOptions = ctx.agentDefaultModel.currentSelection()
    const persisted = await ctx.sessionPersistence.stat(state.sessionId)
    // 手动选中的会话必须真的存在：历史被删掉时明确报错，别悄悄盖一条同 id 的空会话。
    if (persisted === undefined && state.bound && state.source !== 'created') {
      const error: any = new Error(`会话 ${state.sessionId} 已不存在（可能被删除）`)
      error.code = 'SESSION_MISSING'
      error.sessionId = state.sessionId
      throw error
    }
    const storedPreset = persisted?.header?.agentPreset
    // 别人的会话用会话头里记录的 preset 恢复，别拿我们的默认值去改它的运行环境。
    const presetId = persisted === undefined
      ? await resolvePresetId(settings.agentPreset)
      : await resolvePresetId(storedPreset)
    // setup 收到两个参数：(agentCtx, agent)。审批监听要挂在 agent 上，不能挂 agentCtx ——
    // agentCtx 是 cordis 的 Context proxy，读它没有的 `ctx` 属性会直接抛错（?. 兜不住）。
    const setup = async (agentCtx: any, agent: any) => {
      await ctx.agentPresets.mount(agentCtx, presetId)
      attachApproval(agent, userId)
    }
    const scope = await ctx.agentPresets.acquireScope(presetId)
    let handle
    try {
      handle = persisted === undefined
        ? await ctx.agents.create({
          sessionId: state.sessionId,
          meta: { cwd: state.cwd ?? workspaceCwd, agentPreset: presetId },
          agentOptions,
          setup,
        })
        : await ctx.agents.resume({ resumeSessionId: state.sessionId, agentOptions, setup })
    } finally {
      await scope?.[Symbol.asyncDispose]?.()
    }
    if (persisted === undefined) {
      if (settings.permissionPreset !== '') {
        const permission = await ctx.permissionPresets.resolve(settings.permissionPreset)
        ctx.permissionPresets.set(handle.agent.session, permission.id)
      }
      ctx.sessionTitle?.rename?.(handle.agent.session, sessionTitleFor(userId))
      try {
        handle.agent.inject(createUserMessage({
          content: [{ type: 'text', text: SYSTEM_PROMPT }],
          source: INSTRUCTIONS_SOURCE,
        }))
      } catch (error: any) {
        // 注入只是锦上添花：失败时记日志继续跑，别让整轮对话哑掉。
        logger?.warn?.(`remote: 注入身份提示失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    logger?.info?.(`remote: ${persisted === undefined ? '创建' : '恢复'}微信会话 ${state.sessionId}`)
    state.handle = handle
    state.owned = true
    return handle.agent
  }

  /** 拿到这条会话的 agent：正在跑就接管，历史就恢复，不存在就创建。 */
  async function ensureAgent(state: any, userId: any) {
    const live = ctx.agents.get(state.sessionId)
    if (live !== undefined && live !== null) {
      // 接管：agent 由别处（GUI / 已跑着的会话）持有，切换时绝不能 dispose。
      state.owned = false
      state.handle = undefined
      attachApproval(live, userId)
      return live
    }
    return await openAgent(state, userId)
  }

  /** 放弃当前会话：我们自己创建的才 dispose，接管来的只解绑监听。 */
  function release(userId: any, state: any) {
    detachApproval(userId)
    const handle = state.handle
    state.handle = undefined
    if (state.owned && typeof handle?.dispose === 'function') handle.dispose()
    state.owned = false
  }

  /**
   * 跑一轮对话。
   * @param userId 微信发送者
   * @param content DSH content blocks（由 inbound.js 生成）
   * @returns {{ text: string, images: object[], sessionId: string }}
   */
  async function runTurn(userId: any, content: any) {
    const state = stateFor(userId)
    const agent = await ensureAgent(state, userId)
    if (agent.status !== 'idle') await withTimeout(agent.whenIdle(), REPLY_TIMEOUT_MS, '等待上一个回合')
    /**
     * Session 的事件日志是 `log`（长度看 `seq`），没有 `events` 数组。
     * 用 `seq` + `snapshotEvents(from)` 取本轮新增事件，并兼容旧运行时/测试桩。
     */
    const start = eventCount(agent)
    const message = createUserMessage({ content, source: { kind: 'user' } })
    agent.followup(message)
    try {
      await withTimeout(agent.whenIdle(), REPLY_TIMEOUT_MS, '等待回复')
    } catch (error: any) {
      agent.cancel({ kind: 'user' })
      throw error
    }
    const reply = collectReply(eventsSince(agent, start))
    const text = reply.text !== '' ? prepareOutboundText(reply.text) : ''
    return {
      text: text !== ''
        ? text
        : reply.sawError
          ? (reply.errorText === undefined ? '处理时出错了，请稍后再试一次。' : `处理失败：${reply.errorText}`)
          : '已处理完成，但没有可发送的内容。',
      images: reply.images,
      sessionId: state.sessionId,
    }
  }

  /** 同一用户的消息串行入队，避免并发写同一个 Agent。 */
  function enqueue(userId: any, task: any) {
    const state = stateFor(userId)
    const next = state.queue.then(task, task)
    state.queue = next.catch(() => {})
    return next
  }

  return {
    /** 入队一轮对话。 */
    process(userId: any, content: any) {
      return enqueue(userId, () => runTurn(userId, content))
    },

    /** 取消当前回合。 */
    async cancel(userId: any) {
      const state = states.get(userId)
      if (state === undefined) return false
      const agent = ctx.agents.get(state.sessionId)
      if (agent === undefined || agent === null) return false
      if (agent.status === 'idle') return false
      agent.cancel({ kind: 'user' })
      return true
    },

    /** 开启新会话（旧的保留在历史里，可回看）。 */
    rotate(userId: any, cwd: any) {
      const state = stateFor(userId)
      release(userId, state)
      state.generation += 1
      generations?.set?.(userId, state.generation)
      if (typeof cwd === 'string' && cwd !== '') state.cwd = cwd
      state.sessionId = sessionIdFor(settings.accountId, userId, state.generation)
      // 新建的会话直接绑定：否则下一条消息会被「还没选会话」的门禁拦下来。
      state.bound = true
      state.source = 'created'
      bindings?.set?.(userId, state.sessionId)
      return state.sessionId
    },

    /** 这条会话是否正在跑（切走前要拦一下，否则会把跑到一半的回合掐掉）。 */
    isBusy(userId: any) {
      const state = states.get(userId)
      if (state === undefined) return false
      const agent = ctx.agents.get(state.sessionId)
      return agent !== undefined && agent !== null && agent.status !== 'idle'
    },

    /**
     * 切换到一条已有会话（/use 用）。
     * @returns {string} 切换后的 session id
     */
    switchTo(userId: any, sessionId: any, cwd: any) {
      const state = stateFor(userId)
      const value = typeof sessionId === 'string' ? sessionId.trim() : ''
      if (value === '') return state.sessionId
      if (typeof cwd === 'string' && cwd !== '') state.cwd = cwd
      if (value === state.sessionId && state.bound) return state.sessionId
      release(userId, state)
      state.sessionId = value
      state.bound = true
      state.source = 'picked'
      bindings?.set?.(userId, value)
      return state.sessionId
    },

    /** 解除绑定（会话被删掉、或用户想重新选）。 */
    unbind(userId: any) {
      const state = stateFor(userId)
      bindings?.clear?.(userId)
      state.bound = false
      state.source = 'auto'
    },

    /** 这条会话是自动派生的、/use 选的，还是 /new 新建的。 */
    sourceOf(userId: any) {
      const state = stateFor(userId)
      return state.bound ? state.source : 'auto'
    },

    /** 当前绑定的是哪条会话（不是 /use 选的则 undefined）。 */
    bindingOf(userId: any) {
      const state = stateFor(userId)
      return state.bound ? state.sessionId : undefined
    },

    /** 这个用户新建会话时该用哪个工作区（选择卡里换过就按换过的）。 */
    workspaceOf(userId: any) {
      return stateFor(userId).cwd ?? workspaceCwd
    },

    /** 当前会话 id（含 /use 绑定，未绑定则是自动派生的那条）。 */
    sessionIdOf(userId: any) {
      return stateFor(userId).sessionId
    },

    /** 模块卸载：解绑审批监听，并释放我们自己创建的 agent（接管来的不动）。 */
    dispose() {
      for (const [userId, state] of states) {
        detachApproval(userId)
        const handle = state.handle
        state.handle = undefined
        if (state.owned && typeof handle?.dispose === 'function') handle.dispose()
        state.owned = false
      }
      for (const dispose of disposers.values()) {
        if (typeof dispose === 'function') dispose()
      }
      disposers.clear()
    },

    replyTimeoutMs: REPLY_TIMEOUT_MS,
  }
}
