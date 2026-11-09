/**
 * 微信侧斜杠命令的解析与帮助文案。
 *
 * 命令本身很短，但文案要能在微信里读得下去：每行一条、不带 Markdown 标记。
 * 执行逻辑在 bridge.js（这里保持纯函数，方便单测）。
 */

const KNOWN_COMMANDS = [
  'help',
  'status',
  'new',
  'reset',
  'stop',
  'cancel',
  'approve',
  'reject',
  'where',
  'info',
  'workspaces',
  'ws',
  'sessions',
  'ls',
  'use',
  'switch',
  'bind',
  'start',
]

/**
 * 解析一条斜杠命令。
 * @returns {{ name: string, args: string } | undefined} 不以 / 开头时返回 undefined
 */
export function parseCommand(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value.startsWith('/')) return undefined
  const parts = value.split(/\s+/)
  const name = parts[0].slice(1).toLowerCase()
  if (name === '') return undefined
  return { name, args: parts.slice(1).join(' ') }
}

/**
 * 帮助文案：用户明确要求「只告诉支持哪些指令就好」，
 * 所以这里只列命令 + 一句极短的用途，不写用法段落。
 */
export function helpText() {
  return [
    '可用命令：',
    '/help 看这个列表',
    '/start 重新选会话（发一张选择卡）',
    '/sessions（/ls）当前工作区的会话',
    '/use <序号|id前缀>（/switch /bind）切到已有会话',
    '/new（/reset）新建会话',
    '/where（/info）当前工作区、会话名、session_id',
    '/workspaces（/ws）工作区列表',
    '/status 桥接状态',
    '/cancel（/stop）中止当前回答',
    '/approve 允许待审批的操作',
    '/reject 拒绝待审批的操作',
  ].join('\n')
}

/** 是否为已知命令（未知命令统一回帮助）。 */
export function isKnownCommand(name) {
  return KNOWN_COMMANDS.includes(name)
}
