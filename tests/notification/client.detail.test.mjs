/**
 * 会话事实投影测试：从会话快照 + 对话快照里取出「本轮最终回复 / 错误 / 最后用户消息」。
 *
 * 重点是结构容错：对话快照只为打开过的会话物化，缺失时不能抛错；
 * 节点集合可能是 Map、store（有 values()）或数组；用户消息的文本块用 type 而不是 kind。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayTitleOf, sessionDetailOf } from '../../src/modules/notification/client/detail.js'

/** store 形状的对话快照（宿主 ui-chat 的形状）。 */
function chatStore(nodes) {
  return { nodes: { values: () => nodes.values() } }
}

test('sessionDetailOf：取最后一条非空 assistant 文本作为最终回复', () => {
  const chat = chatStore([
    { kind: 'assistant-step', data: { blocks: [{ kind: 'reasoning', text: '想一想' }, { kind: 'text', text: '第一段' }] } },
    { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: '最后的回复' }] } },
    // 空文本的 step 不能覆盖上一条非空回复。
    { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: '   ' }] } },
  ])
  const detail = sessionDetailOf({ lastAgentError: null }, chat)
  assert.equal(detail.finalText, '最后的回复')
  assert.equal(detail.lastAssistantText, '最后的回复')
  assert.equal(detail.maxTurnErrorSeq, 0)
  assert.equal(detail.failureMessage, null)
})

test('sessionDetailOf：turn-error 取最大 seq 的 message；lastAgentError 来自会话快照', () => {
  const chat = chatStore([
    { kind: 'turn-error', data: { seq: 2, message: '第一次失败' } },
    { kind: 'turn-error', data: { seq: 7, message: '最后的失败' } },
    { kind: 'turn-error', data: { seq: 5, message: '中间失败' } },
  ])
  const detail = sessionDetailOf({ lastAgentError: 'agent 崩了' }, chat)
  assert.equal(detail.maxTurnErrorSeq, 7)
  assert.equal(detail.failureMessage, '最后的失败')
  assert.equal(detail.lastAgentError, 'agent 崩了')
})

test('sessionDetailOf：只把人类 user 消息当作最后用户消息', () => {
  const chat = chatStore([
    { kind: 'user', data: { content: [{ type: 'text', text: '我自己说的话' }], source: { kind: 'user' } } },
    { kind: 'user', data: { content: [{ type: 'text', text: 'goal 轮次的提示' }], source: { kind: 'goal' } } },
    { kind: 'user', data: { content: [{ type: 'text', text: 'steering 不是用户输入' }], source: { kind: 'steering' } } },
  ])
  const detail = sessionDetailOf({}, chat)
  assert.equal(detail.lastUserText, '我自己说的话')
})

test('sessionDetailOf：缺少对话快照时降级为空事实，但仍读 lastAgentError', () => {
  const detail = sessionDetailOf({ lastAgentError: 'provider 超时' }, undefined)
  assert.equal(detail.finalText, '')
  assert.equal(detail.lastUserText, '')
  assert.equal(detail.maxTurnErrorSeq, 0)
  assert.equal(detail.lastAgentError, 'provider 超时')
})

test('sessionDetailOf：兼容 Map / 数组 / data.text 摊平三种节点容器', () => {
  const mapChat = { nodes: new Map([['k', { kind: 'assistant-step', data: { text: '摊平文本' } }]]) }
  assert.equal(sessionDetailOf({}, mapChat).finalText, '摊平文本')
  const arrayChat = { nodes: [{ kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: '数组文本' }] } }] }
  assert.equal(sessionDetailOf({}, arrayChat).finalText, '数组文本')
  // 坏节点不抛错。
  assert.equal(sessionDetailOf({}, { nodes: { values: () => [null, 42, {}] } }).finalText, '')
})

test('displayTitleOf：优先会话显示标题，缺失时用「无标题会话」', () => {
  const t = (key) => (key === 'untitled' ? '无标题会话' : key)
  assert.equal(displayTitleOf({ displayTitle: '  修登录  ' }, 's1', t), '修登录')
  assert.equal(displayTitleOf({ displayTitle: '' }, 's1', t), '无标题会话')
  assert.equal(displayTitleOf(undefined, 's1', t), '无标题会话')
})
