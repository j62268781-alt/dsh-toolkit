/**
 * 把 hooks.json 接到宿主的五个扩展点上。
 *
 * 事件映射与 Claude Code 桥一致（那套语义已经被大量现成 hooks 依赖）：
 *   agent/created          → SessionStart
 *   agent/pre-step         → UserPromptSubmit
 *   tools/pre-execute      → PreToolUse
 *   tools/post-execute     → PostToolUse
 *   agent/turn-stopping    → Stop
 *
 * 关键约定：**没有配置就什么都不做**。每个监听器先问 store 要命中的 hook，空数组直接
 * 交给下一个监听器——不解析、不起进程，空配置下零开销。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ContextFormed } from '@deepseek-ai/dsh-llm'
// 类型副作用导入：拿到 agent/* 与 tools/* 事件声明，否则 ctx.on 的名字只是字符串。
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type { HookHistory } from './history.js'
import type { HookStore, HookView } from './files.js'
import type { HookRunRequest, HookRunResult, MergedHookOutcome } from './exec.js'
import { mergeHookOutcomes, runHookCommand } from './exec.js'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-toolkit-hooks': { kind: 'dsh-toolkit-hooks' } & ContextFormed
  }
}

const CONTEXT_SOURCE = { kind: 'dsh-toolkit-hooks' } as const

/** Stop hook 连续拒绝的上限：钩子写错时不能让会话永远停不下来。 */
const MAX_STOP_CONTINUATIONS = 3

export interface HookRuntimeOptions {
  store: HookStore
  history: HookHistory
  enabled: () => boolean
  /** hook 进程的工作目录与 `cwd` 载荷字段（固定目录的旧接口，测试与无会话场景用）。 */
  cwd?: () => string
  /**
   * 按会话解析项目目录。桌面端 DSH 的 `process.cwd()` 是安装目录，项目级 hooks 必须
   * 跟着会话的 working directory 走，所以每个事件都按自己的 agent 求值一次。
   */
  directory?: (agent?: any) => string
  env?: () => NodeJS.ProcessEnv
  logger?: { warn(message: string): void }
  /** 默认走真子进程；测试里换掉它就能只验证事件映射与决策转换。 */
  execute?: (request: HookRunRequest) => Promise<HookRunResult>
}

interface RunOutcome {
  merged: MergedHookOutcome
  ran: number
}

const IDLE: RunOutcome = { merged: { decision: 'allow', reason: '', additionalContext: [] }, ran: 0 }

function blocksToText(content: readonly unknown[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => {
      const candidate = block as { type?: unknown; text?: unknown }
      return candidate?.type === 'text' && typeof candidate.text === 'string'
    })
    .map((block) => block.text)
    .join('')
}

export function createHookRuntime(ctx: any, options: HookRuntimeOptions) {
  const log = options.logger ?? ctx?.logger
  const directory = (agent?: any): string => {
    if (options.directory !== undefined) return options.directory(agent)
    return options.cwd?.() ?? process.cwd()
  }
  const env = (dir: string): NodeJS.ProcessEnv => {
    const base = options.env?.() ?? process.env
    return { ...base, DSH_PROJECT_DIR: dir, CLAUDE_PROJECT_DIR: dir }
  }

  const execute = options.execute ?? runHookCommand

  /** Stop 的连击计数：按 session 记，正常结束一轮就清掉。 */
  const stopStreak = new Map<string, number>()

  async function runEvent(
    event: string,
    subject: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
    dir: string = directory(),
  ): Promise<RunOutcome> {
    if (!options.enabled()) return IDLE
    let hooks: HookView[]
    try {
      hooks = await options.store.hooksFor(event, subject)
    } catch (error) {
      log?.warn(`hooks: 读取配置失败：${String(error)}`)
      return IDLE
    }
    if (hooks.length === 0) return IDLE
    const runs: HookRunResult[] = []
    for (const hook of hooks) {
      try {
        const result = await execute({
          event,
          command: hook.command,
          timeoutMs: hook.timeoutMs,
          payload: { ...payload, cwd: dir },
          cwd: dir,
          env: env(dir),
          ...(signal === undefined ? {} : { signal }),
        })
        runs.push(result)
        options.history.push({
          event,
          command: hook.command,
          source: hook.source,
          decision: result.decision,
          durationMs: result.durationMs,
          code: result.code,
          timedOut: result.timedOut,
          reason: result.reason,
          error: result.error,
        })
      } catch (error) {
        log?.warn(`hooks: ${event} 的 hook 执行异常：${String(error)}`)
      }
    }
    return { merged: mergeHookOutcomes(runs), ran: hooks.length }
  }

  function contextMessage(texts: string[]) {
    if (texts.length === 0) return undefined
    const content: ContentBlock[] = texts.map((text) => ({ type: 'text', text }))
    return createUserMessage({ content, source: CONTEXT_SOURCE })
  }

  function base(agent: any, event: string): Record<string, unknown> {
    return {
      session_id: agent?.session?.header?.id ?? '',
      transcript_path: '',
      hook_event_name: event,
    }
  }

  /** 只有在会话来源匹配时才会跑：matcher 的对象是 SessionStart 的 source。 */
  ctx.on('agent/created', async ({ agent, source }: any) => {
    const outcome = await runEvent('SessionStart', String(source ?? ''), { ...base(agent, 'SessionStart'), source }, undefined, directory(agent))
    const message = contextMessage(outcome.merged.additionalContext)
    if (message !== undefined) agent.inject(message)
  })

  ctx.on('agent/pre-step', async ({ agent, messages, signal }: any, next: () => Promise<any>) => {
    const content = (messages as Array<{ content: unknown[] }>).flatMap((message) => message.content)
    const outcome = await runEvent('UserPromptSubmit', '', {
      ...base(agent, 'UserPromptSubmit'),
      prompt: blocksToText(content),
    }, signal, directory(agent))
    if (outcome.merged.decision === 'deny') return { kind: 'reject' }
    const downstream = await next()
    const message = contextMessage(outcome.merged.additionalContext)
    if (message === undefined || downstream?.kind !== 'enter') return downstream
    return { ...downstream, messages: [...downstream.messages, message] }
  })

  ctx.on('tools/pre-execute', async (exec: any, next: () => Promise<any>) => {
    const outcome = await runEvent('PreToolUse', exec.name, {
      ...base(exec.agent, 'PreToolUse'),
      tool_name: exec.name,
      tool_input: exec.arguments,
      tool_use_id: exec.callId,
    }, exec.signal, directory(exec.agent))
    if (outcome.merged.decision === 'deny') {
      return { kind: 'deny', reason: outcome.merged.reason || '被 PreToolUse 钩子拒绝' }
    }
    if (outcome.merged.decision === 'ask') {
      return { kind: 'ask', ...(outcome.merged.reason === '' ? {} : { reason: outcome.merged.reason }) }
    }
    return next()
  })

  ctx.on('tools/post-execute', async (exec: any, result: any, next: () => Promise<any>) => {
    const outcome = await runEvent('PostToolUse', exec.name, {
      ...base(exec.agent, 'PostToolUse'),
      tool_name: exec.name,
      tool_input: exec.arguments,
      tool_use_id: exec.callId,
      tool_response: blocksToText(result?.content ?? []),
    }, exec.signal, directory(exec.agent))
    const message = contextMessage(outcome.merged.additionalContext)
    if (outcome.merged.decision === 'deny') {
      return {
        kind: 'block',
        feedback: [{ type: 'text', text: outcome.merged.reason || '被 PostToolUse 钩子拦截' }],
        ...(message === undefined ? {} : { additionalContexts: [message] }),
      }
    }
    const downstream = await next()
    if (message === undefined) return downstream
    return { ...downstream, additionalContexts: [message, ...(downstream?.additionalContexts ?? [])] }
  })

  ctx.on('agent/turn-stopping', async ({ agent, turn }: any) => {
    const sessionId = agent?.session?.header?.id ?? ''
    const outcome = await runEvent('Stop', '', { ...base(agent, 'Stop'), stop_hook_active: false }, undefined, directory(agent))
    if (outcome.merged.decision !== 'deny') {
      stopStreak.delete(sessionId)
      return
    }
    const streak = (stopStreak.get(sessionId) ?? 0) + 1
    stopStreak.set(sessionId, streak)
    if (streak > MAX_STOP_CONTINUATIONS) {
      log?.warn(`hooks: Stop 钩子已连续拒绝 ${MAX_STOP_CONTINUATIONS} 次（第 ${turn} 轮），本次放行`)
      stopStreak.delete(sessionId)
      return
    }
    const message = contextMessage([outcome.merged.reason || '继续：Stop 钩子要求再走一步'])
    if (message !== undefined) agent.steer(message)
  })

  return {
    /** 面板的「试跑」：按当前配置里的条目跑一次，不参与决策。 */
    async runTest(hook: HookView, payload: Record<string, unknown>) {
      const dir = directory()
      const result = await execute({
        event: hook.event,
        command: hook.command,
        timeoutMs: hook.timeoutMs,
        payload: { ...payload, cwd: dir },
        cwd: dir,
        env: env(dir),
      })
      options.history.push({
        event: hook.event,
        command: hook.command,
        source: hook.source,
        decision: result.decision,
        durationMs: result.durationMs,
        code: result.code,
        timedOut: result.timedOut,
        reason: result.reason,
        error: result.error,
      })
      return result
    },
  }
}
