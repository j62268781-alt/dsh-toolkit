/**
 * shell 守卫：识别「裸 --force 推送」并在开关打开时 deny。
 *
 * 只用纯函数 + 一个假 ctx，不启动任何服务：守卫的价值全在判定那几行，
 * 判错了比不装更糟——它会把正确的 `--force-with-lease` 也拦下来。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bareForcePush, commandText, installGitGuard } from '../../src/modules/git/host/guard.js'

const ON = { branchPrefix: '', alwaysForcePush: true, commitInstructions: '' }
const OFF = { ...ON, alwaysForcePush: false }

test('识别裸 --force 推送', () => {
  for (const command of [
    'git push --force',
    'git push -f origin main',
    'git push origin main -f',
    'git push -uf origin main',
    'git push --force=true origin main',
    'git push origin +main',
    'cd repo && git push --force',
    '/usr/bin/git push -f',
    'git push \\\n  --force origin main',
  ]) {
    assert.notEqual(bareForcePush(command), '', command)
  }
})

test('放过带 lease 的、以及根本不是强推的', () => {
  for (const command of [
    'git push --force-with-lease origin main',
    'git push --force-with-lease=main:abc origin main',
    'git push origin main',
    'git push -u origin HEAD',
    'git commit -m "git push --force"',
    'echo git && git status',
  ]) {
    assert.equal(bareForcePush(command), '', command)
  }
})

test('参数文本兼容 command / argv 两种形状', () => {
  assert.equal(commandText({ command: 'git push -f' }), 'git push -f')
  assert.equal(commandText({ argv: ['git', 'push', '-f'] }), 'git push -f')
  assert.equal(commandText({}), '')
  assert.equal(commandText(undefined), '')
})

test('守卫：开关打开时拦裸 --force，交给模型的 reason 里要有正确写法', async () => {
  const handlers = new Map()
  installGitGuard({ on: (event, handler) => handlers.set(event, handler) }, () => ON)
  const guard = handlers.get('tools/pre-execute')
  assert.equal(typeof guard, 'function')

  const next = async () => ({ kind: 'next' })
  const decision = await guard({ name: 'bash', arguments: { command: 'git push --force origin main' } }, next)
  assert.equal(decision.kind, 'deny')
  assert.match(decision.reason, /--force-with-lease/)
  assert.match(decision.reason, /git push --force origin main/)
})

test('守卫：别的工具、带 lease 的命令、开关关闭时一律放行', async () => {
  const make = (settings) => {
    const handlers = new Map()
    installGitGuard({ on: (event, handler) => handlers.set(event, handler) }, () => settings)
    return handlers.get('tools/pre-execute')
  }
  const next = async () => ({ kind: 'next' })

  assert.equal((await make(ON)({ name: 'git_push', arguments: {} }, next)).kind, 'next')
  assert.equal((await make(ON)({ name: 'read_file', arguments: {} }, next)).kind, 'next')
  assert.equal((await make(ON)({ name: 'bash', arguments: { command: 'git push --force-with-lease' } }, next)).kind, 'next')
  assert.equal((await make(OFF)({ name: 'bash', arguments: { command: 'git push --force' } }, next)).kind, 'next')
  assert.equal((await make(ON)({ name: 'bash', arguments: {} }, next)).kind, 'next')
})
