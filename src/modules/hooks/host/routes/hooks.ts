/**
 * 三条只读/低风险路由：读快照、重读配置、试跑一条 hook。
 *
 * 快照把「文件状态 + 合并后的条目 + 静态诊断 + 最近执行」一次给全，面板不需要再拼接口；
 * 试跑是给用户自己验证命令用的——面板上验证一条 hook 能不能跑，比去翻日志快得多。
 */
import type { JsonRouteSpec } from '../../../../host/routes.js'
import { httpFailure } from '../../../../host/routes.js'
import { HOOK_REASON, REFRESH_BODY_LIMIT, HOOKS_REFRESH_PATH, HOOKS_SNAPSHOT_PATH, HOOKS_TEST_PATH, TEST_BODY_LIMIT } from '../constants.js'
import type { HookHistory } from '../domain/history.js'
import type { HookStore } from '../domain/files.js'

export interface HookRouteDeps {
  store: HookStore
  history: HookHistory
  /** 试跑一条 hook（由 runtime 提供：同一套 cwd/env/超时）。 */
  runTest: (hookId: string) => Promise<unknown>
  /** 试跑时给 hook 的合成载荷（按事件挑字段，见 `syntheticPayload`）。 */
  testPayload?: (event: string) => Record<string, unknown>
}

/** 试跑载荷：字段名沿用 Claude Code 的 hook 输入，让现成脚本不改就能测。 */
export function syntheticPayload(event: string): Record<string, unknown> {
  const base = { session_id: 'panel-test', transcript_path: '', hook_event_name: event }
  switch (event) {
    case 'SessionStart':
      return { ...base, source: 'panel-test' }
    case 'UserPromptSubmit':
      return { ...base, prompt: '这是一条来自设置面板的测试提示词。' }
    case 'PreToolUse':
    case 'PostToolUse':
      return { ...base, tool_name: 'bash', tool_input: { command: 'echo hello' }, tool_use_id: 'panel-test' }
    case 'Stop':
      return { ...base, stop_hook_active: false }
    default:
      return base
  }
}

export function createHookRoutes(deps: HookRouteDeps): JsonRouteSpec[] {
  return [
    {
      path: HOOKS_SNAPSHOT_PATH,
      method: 'GET',
      run: async () => {
        const snapshot = await deps.store.snapshot()
        return [200, { ok: true, ...snapshot, history: deps.history.list() }]
      },
    },
    {
      path: HOOKS_REFRESH_PATH,
      limit: REFRESH_BODY_LIMIT,
      run: async () => {
        deps.store.invalidate()
        const snapshot = await deps.store.snapshot()
        return [200, {
          ok: true,
          readAt: snapshot.readAt,
          files: snapshot.files,
          hooks: snapshot.hooks.length,
          issues: snapshot.issues.length,
        }]
      },
    },
    {
      path: HOOKS_TEST_PATH,
      limit: TEST_BODY_LIMIT,
      pick: (body) => body?.hookId,
      check: (hookId) => typeof hookId === 'string' && hookId !== '' && hookId.length <= 400,
      reason: HOOK_REASON.badHookId,
      run: async (_ctx, hookId) => {
        const hook = await deps.store.find(String(hookId))
        if (hook === undefined) throw httpFailure(404, HOOK_REASON.notFound)
        if (!hook.supported) throw httpFailure(400, HOOK_REASON.unsupportedEvent)
        return [200, { ok: true, result: await deps.runTest(hook.id) }]
      },
    },
  ]
}
