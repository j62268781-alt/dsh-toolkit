/**
 * 会话快照 → 通知所需的「本轮事实」投影（纯函数，无 DOM、无 ctx）。
 *
 * 通知要在会话结束时回答两个问题：本轮是完成还是失败？最后一条回复说了什么？
 * 这两个答案分散在两个快照里：
 *   - 会话快照（`ctx.sessions.binding(id).session.getSnapshot()`）：`lastAgentError`；
 *   - 对话快照（`ctx.uiConversation.binding(...).target('chat').getSnapshot()`）：
 *     `assistant-step` 节点的文本、`turn-error` 节点、人类 `user` 节点。
 *
 * 对话快照只为「打开过」的会话物化，缺失时本函数仍然返回可用结果（除 lastAgentError
 * 外全是空），绝不抛错——分类逻辑必须能在信息不全时降级，而不是让整条链路失败。
 */

/** 对话节点里可能出现的文本块形状。 */
function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block !== null && typeof block === 'object' && block.kind === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/** 直接挂在 data 上的文本（不同 assembler 版本可能已把文本摊平）。 */
function textOfData(data) {
  if (data === null || typeof data !== 'object') return ''
  const blocks = textOfBlocks(data.blocks)
  if (blocks !== '') return blocks
  return typeof data.text === 'string' ? data.text : ''
}

/** 用户消息的正文：content 块数组或已摊平的 text。 */
function textOfUserNode(data) {
  if (data === null || typeof data !== 'object') return ''
  if (Array.isArray(data.content)) {
    return data.content
      .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
  }
  return typeof data.text === 'string' ? data.text : ''
}

/**
 * 遍历对话快照里的节点；兼容 `{ nodes: { values() } }`、`{ nodes: Map }` 与节点数组。
 * @param chat - 对话快照（形状随宿主版本变化，全部按结构读）。
 */
function nodeValues(chat) {
  const nodes = chat?.nodes
  if (nodes === undefined || nodes === null) return []
  if (typeof nodes.values === 'function') {
    try {
      return [...nodes.values()]
    } catch {
      return []
    }
  }
  if (nodes instanceof Map) return [...nodes.values()]
  if (Array.isArray(nodes)) return nodes
  return []
}

/**
 * 把一轮会话的两个快照投影成通知事实。
 * @param session - 会话快照（可能只有 `lastAgentError` 等生命周期字段）。
 * @param chat - 该会话的对话快照；未物化时传 undefined。
 * @returns {{maxTurnErrorSeq: number, failureMessage: string|null, lastAgentError: string|null,
 *   finalText: string, lastUserText: string, lastAssistantText: string}}
 */
export function sessionDetailOf(session, chat) {
  let maxTurnErrorSeq = 0
  let failureMessage = null
  let finalText = ''
  let lastUserText = ''
  for (const node of nodeValues(chat)) {
    if (node === null || typeof node !== 'object') continue
    if (node.kind === 'turn-error') {
      const data = node.data ?? {}
      const seq = Number(data.seq) || 0
      if (seq >= maxTurnErrorSeq && seq > 0) {
        maxTurnErrorSeq = seq
        failureMessage = typeof data.message === 'string' ? data.message : failureMessage
      }
    } else if (node.kind === 'assistant-step') {
      const text = textOfData(node.data)
      if (text.trim() !== '') finalText = text
    } else if (node.kind === 'user') {
      const data = node.data ?? {}
      // 只认人类用户消息：goal 轮次、steering 等宿主提示共用 user 角色，但不是「用户说的话」。
      if (data.source?.kind !== 'user') continue
      const text = textOfUserNode(data)
      if (text.trim() !== '') lastUserText = text
    }
  }
  return {
    maxTurnErrorSeq,
    failureMessage,
    lastAgentError: typeof session?.lastAgentError === 'string' ? session.lastAgentError : null,
    finalText,
    lastUserText,
    lastAssistantText: finalText,
  }
}

/**
 * 会话标题：优先用户在会话里设置的显示标题，其次目录名/id（宿主已算好 displayTitle）。
 * @param summary - 会话列表快照里的一行。
 * @param sessionId - 会话 id（兜底）。
 * @param t - 文案函数，用于「无标题会话」。
 */
export function displayTitleOf(summary, sessionId, t) {
  const title = summary?.displayTitle
  if (typeof title === 'string' && title.trim() !== '') return title.trim()
  return t('untitled')
}
