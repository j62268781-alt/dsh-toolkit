import { httpFailure } from '../../../../host/routes.js';
import { HOOK_REASON, REFRESH_BODY_LIMIT, HOOKS_REFRESH_PATH, HOOKS_SNAPSHOT_PATH, HOOKS_TEST_PATH, TEST_BODY_LIMIT } from '../constants.js';
/** 试跑载荷：字段名沿用 Claude Code 的 hook 输入，让现成脚本不改就能测。 */
export function syntheticPayload(event) {
    const base = { session_id: 'panel-test', transcript_path: '', hook_event_name: event };
    switch (event) {
        case 'SessionStart':
            return { ...base, source: 'panel-test' };
        case 'UserPromptSubmit':
            return { ...base, prompt: '这是一条来自设置面板的测试提示词。' };
        case 'PreToolUse':
        case 'PostToolUse':
            return { ...base, tool_name: 'bash', tool_input: { command: 'echo hello' }, tool_use_id: 'panel-test' };
        case 'Stop':
            return { ...base, stop_hook_active: false };
        default:
            return base;
    }
}
export function createHookRoutes(deps) {
    return [
        {
            path: HOOKS_SNAPSHOT_PATH,
            method: 'GET',
            run: async () => {
                const snapshot = await deps.store.snapshot();
                return [200, { ok: true, ...snapshot, history: deps.history.list() }];
            },
        },
        {
            path: HOOKS_REFRESH_PATH,
            limit: REFRESH_BODY_LIMIT,
            run: async () => {
                deps.store.invalidate();
                const snapshot = await deps.store.snapshot();
                return [200, {
                        ok: true,
                        readAt: snapshot.readAt,
                        files: snapshot.files,
                        hooks: snapshot.hooks.length,
                        issues: snapshot.issues.length,
                    }];
            },
        },
        {
            path: HOOKS_TEST_PATH,
            limit: TEST_BODY_LIMIT,
            pick: (body) => body?.hookId,
            check: (hookId) => typeof hookId === 'string' && hookId !== '' && hookId.length <= 400,
            reason: HOOK_REASON.badHookId,
            run: async (_ctx, hookId) => {
                const hook = await deps.store.find(String(hookId));
                if (hook === undefined)
                    throw httpFailure(404, HOOK_REASON.notFound);
                if (!hook.supported)
                    throw httpFailure(400, HOOK_REASON.unsupportedEvent);
                return [200, { ok: true, result: await deps.runTest(hook.id) }];
            },
        },
    ];
}
//# sourceMappingURL=hooks.js.map