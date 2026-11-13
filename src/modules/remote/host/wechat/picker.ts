/**
 * 未绑定会话时的「选择器」：欢迎语、选择卡、序号回复。
 *
 * 交互顺序（尽量短，微信里打字少）：
 *   1. 先给工作区卡：只显示目录名，最后一项是「不选，用默认工作区」；
 *   2. 选完工作区再给会话卡：第 1 项永远是「新建」，其余是本工作区的全部会话（只显示标题）；
 *   3. 会话卡里的 0 是回到工作区卡。
 *
 * 设计约束：
 *   · 微信里只能发纯文本，所以选择靠「回复数字」；
 *   · 命令永远放行（/help /start /sessions /use /new …），选择器只管普通消息和纯数字；
 *   · 待选状态只活 10 分钟且一次消费，避免把 Agent 的追问答案（比如「2」）误当成选择。
 */

import { basename } from 'node:path'

import { loadWorkspaces, sessionsOfWorkspace } from './inspect.js'

export const CHOICE_TTL_MS = 10 * 60 * 1000
/** 同一用户两次欢迎语的最小间隔：超过这个时间没聊过才重新打招呼。 */
export const GREET_INTERVAL_MS = 24 * 60 * 60 * 1000
/** 会话卡里最多列多少条（正常够用；超过时在卡尾说明总数）。 */
export const SESSION_LIST_LIMIT = 100

/** 会话卡的第一项：在这个工作区新建一条会话。 */
export const NEW_SESSION_OPTION = 1
/** 会话卡的 0：回到工作区卡。 */
export const BACK_TO_WORKSPACES = 0

export const WELCOME_TEXT = [
  '你好！我是你的 AI 助手，有什么可以帮你的吗？',
  '比如：查资料、写代码、改文件、跑脚本、操作网页或手机 App、整理文档表格等等，直接把需求告诉我就行。',
].join('\n')

const HELP_HINT = '/help 看全部命令。'

/** 工作区在卡上只显示最后一段目录名；家目录显示成 `~`。 */
export function workspaceLabel(path: any, home: any) {
  if (typeof path !== 'string' || path === '') return '默认工作区'
  if (home !== undefined && path === home) return '~'
  const name = basename(path)
  return name === '' || name === '.' || name === '/' ? path : name
}

/**
 * 工作区卡：1..N 选工作区，最后一项是「不选，用默认工作区」。
 */
export function workspaceCardText({ workspaces, currentPath, defaultPath, home }: any) {
  const lines = ['先选工作区（回复序号）', '']
  workspaces.forEach((workspace: any, index: any) => {
    const mark = workspace.path === currentPath ? '（当前）' : ''
    lines.push(`${index + 1}. ${workspaceLabel(workspace.path, home)}${mark}`)
  })
  const skip = workspaces.length + 1
  lines.push(`${skip}. 不选，用默认工作区${defaultPath === undefined ? '' : `（${workspaceLabel(defaultPath, home)}）`}`)
  lines.push('')
  lines.push(`回复数字即可；${HELP_HINT}`)
  return lines.join('\n')
}

/**
 * 会话卡：1 = 新建，2..N+1 = 本工作区的会话（只显示标题），0 = 换工作区。
 */
export function sessionCardText({ workspacePath, sessions, total, home }: any) {
  const label = workspaceLabel(workspacePath, home)
  const lines = ['请选择会话（回复序号）', `工作区：${label}`, '']
  lines.push(`${NEW_SESSION_OPTION}. 新建一条会话`)
  sessions.forEach((session: any, index: any) => {
    lines.push(`${index + NEW_SESSION_OPTION + 1}. ${session.title ?? '（未命名）'}`)
  })
  if (sessions.length === 0) lines.push('（这个工作区还没有会话，回复 1 直接新建）')
  lines.push(`${BACK_TO_WORKSPACES}. 换个工作区`)
  lines.push('')
  if (total > sessions.length) {
    lines.push(`共 ${total} 条，这里列了最近 ${sessions.length} 条，用 /sessions 看剩下的。`)
  }
  lines.push(`回复数字即可；${HELP_HINT}`)
  return lines.join('\n')
}

/** 纯数字回复才算选择；其它一律当普通消息。 */
export function parseChoice(text: any) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!/^\d{1,3}$/.test(value)) return undefined
  return Number(value)
}

/**
 * 选择器状态机（每个用户一份，只在内存里；重启后重新发一次 /start 即可）。
 * @param options.ctx 宿主 ctx
 * @param options.conversations 会话管理器
 * @param options.workspaceCwd 桥的默认工作区
 * @param options.home 家目录（卡上把它显示成 `~`）
 */
export function createPicker({ ctx, conversations, workspaceCwd, home, logger, ttlMs = CHOICE_TTL_MS }: any) {
  /** userId → { kind: 'workspaces' | 'sessions', ... , at } */
  const choices = new Map()
  /** userId → { message, at }：选会话前先挂起的问题（单槽，10 分钟）。 */
  const pending = new Map()

  function clear(userId: any) {
    choices.delete(userId)
    pending.delete(userId)
  }

  function clearChoice(userId: any) {
    choices.delete(userId)
  }

  function current(userId: any) {
    const entry = choices.get(userId)
    if (entry === undefined) return undefined
    if (Date.now() - entry.at > ttlMs) {
      choices.delete(userId)
      return undefined
    }
    return entry
  }

  /** 挂起这条消息，等选完会话后补跑。 */
  function suspend(userId: any, message: any) {
    pending.set(userId, { message, at: Date.now() })
  }

  /** 取走挂起的问题（一次性）；超时不补跑。 */
  function takePending(userId: any) {
    const entry = pending.get(userId)
    pending.delete(userId)
    if (entry === undefined) return undefined
    if (Date.now() - entry.at > ttlMs) return undefined
    return entry.message
  }

  /** 会话卡：读这个工作区的会话（默认全列），再渲染。 */
  async function showSessions(userId: any, workspacePath: any) {
    const path = workspacePath ?? workspaceCwd
    const listing = await sessionsOfWorkspace(ctx, path, { limit: SESSION_LIST_LIMIT })
    choices.set(userId, {
      kind: 'sessions',
      workspacePath: path,
      sessions: listing.sessions,
      at: Date.now(),
    })
    return sessionCardText({ workspacePath: path, sessions: listing.sessions, total: listing.total, home })
  }

  /** 工作区卡（入口）；一个工作区都没登记时直接给默认工作区的会话卡。 */
  async function showWorkspaces(userId: any) {
    const workspaces = await loadWorkspaces(ctx)
    if (workspaces.length === 0) return showSessions(userId, workspaceCwd)
    const currentPath = conversations.workspaceOf?.(userId) ?? workspaceCwd
    choices.set(userId, { kind: 'workspaces', workspaces, defaultPath: workspaceCwd, at: Date.now() })
    return workspaceCardText({ workspaces, currentPath, defaultPath: workspaceCwd, home })
  }

  /**
   * 处理一个纯数字回复。
   * @returns {Promise<{ texts: string[], bound?: { sessionId: string, workspacePath: string } } | undefined>}
   *          不在待选状态时返回 undefined（调用方按普通消息处理）。
   */
  async function choose(userId: any, number: any) {
    const entry = current(userId)
    if (entry === undefined) return undefined

    if (entry.kind === 'workspaces') {
      const skip = entry.workspaces.length + 1
      if (number === skip) return { texts: [await showSessions(userId, entry.defaultPath)] }
      const workspace = entry.workspaces[number - 1]
      if (workspace === undefined) {
        return { texts: [`没有「${number}」这个选项：回复 1-${skip}。`] }
      }
      return { texts: [await showSessions(userId, workspace.path)] }
    }

    // 会话卡
    if (number === BACK_TO_WORKSPACES) {
      return { texts: [await showWorkspaces(userId)] }
    }
    if (number === NEW_SESSION_OPTION) {
      const sessionId = conversations.rotate(userId, entry.workspacePath)
      // 只清「待选项」，别把挂起的消息一起清了（选完要补跑）。
      clearChoice(userId)
      logger?.info?.(`remote: 用户选定「在该工作区新建」→ ${sessionId}`)
      return {
        texts: [`已新建会话（工作区：${workspaceLabel(entry.workspacePath, home)}）。`],
        bound: { sessionId, workspacePath: entry.workspacePath },
      }
    }
    const session = entry.sessions?.[number - NEW_SESSION_OPTION - 1]
    if (session === undefined) {
      const upper = entry.sessions.length + NEW_SESSION_OPTION
      return { texts: [`没有「${number}」这个选项：回复 1-${upper} 选会话，0 换工作区。`] }
    }
    conversations.switchTo(userId, session.id, entry.workspacePath)
    clearChoice(userId)
    logger?.info?.(`remote: 用户选定已有会话 ${session.id}`)
    return {
      texts: [`已切到「${session.title ?? '（未命名）'}」（工作区：${workspaceLabel(entry.workspacePath, home)}）。`],
      bound: { sessionId: session.id, workspacePath: entry.workspacePath },
    }
  }

  return {
    clear,
    clearChoice,
    suspend,
    takePending,
    showSessions,
    showWorkspaces,
    choose,
    isAwaiting(userId: any) {
      return current(userId) !== undefined
    },
  }
}
