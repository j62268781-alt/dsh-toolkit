/**
 * 把 hooks.json 接到宿主的九个扩展点上。
 *
 * 事件映射与 Claude Code 桥一致（那套语义已经被大量现成 hooks 依赖）：
 *   agent/created          → SessionStart
 *   agent/pre-step         → UserPromptSubmit
 *   tools/pre-execute      → PreToolUse
 *   tools/post-execute     → PostToolUse（仅成功；失败走 PostToolUseFailure）
 *   agent/turn-stopping    → Stop
 *   agent/disposed         → SessionEnd（子代理会话的释放留给 SubagentStop）
 *   subagent/start         → SubagentStart
 *   subagent/end           → SubagentStop
 *   tools/result           → PostToolUseFailure
 *
 * 后四个是**只读**事件：宿主不提供决策通道，钩子的输出只能追加进上下文（或什么都不做）。
 * `tools/result` 是宿主文档指定的「最终结果观察点」，`tools/post-execute` 只用来改写结果，
 * 所以失败检测挂在 tools/result 上，不用去猜 post-execute 的返回值。
 *
 * 关键约定：**没有配置就什么都不做**。每个监听器先问 store 要命中的 hook，空数组直接
 * 交给下一个监听器——不解析、不起进程，空配置下零开销。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { mergeHookOutcomes, runHookCommand } from './exec.js';
const CONTEXT_SOURCE = { kind: 'dsh-toolkit-hooks' };
/** Stop hook 连续拒绝的上限：钩子写错时不能让会话永远停不下来。 */
const MAX_STOP_CONTINUATIONS = 3;
const IDLE = { merged: { decision: 'allow', reason: '', additionalContext: [] }, ran: 0 };
function blocksToText(content) {
    return content
        .filter((block) => {
        const candidate = block;
        return candidate?.type === 'text' && typeof candidate.text === 'string';
    })
        .map((block) => block.text)
        .join('');
}
/**
 * 工具失败时载荷里带上错误原文：执行器给的是 `ToolFailure` 对象，
 * 但钩子是外部进程，只给字符串最省事（对象序列化后会多出一堆没人看的字段）。
 */
function failureText(error) {
    if (error === undefined || error === null)
        return '';
    if (typeof error === 'string')
        return error;
    const message = error.message;
    if (typeof message === 'string')
        return message;
    return String(error);
}
export function createHookRuntime(ctx, options) {
    const log = options.logger ?? ctx?.logger;
    const directory = (agent) => {
        if (options.directory !== undefined)
            return options.directory(agent);
        return options.cwd?.() ?? process.cwd();
    };
    const env = (dir) => {
        const base = options.env?.() ?? process.env;
        return { ...base, DSH_PROJECT_DIR: dir, CLAUDE_PROJECT_DIR: dir };
    };
    const execute = options.execute ?? runHookCommand;
    /** Stop 的连击计数：按 session 记，正常结束一轮就清掉。 */
    const stopStreak = new Map();
    async function runEvent(event, subject, payload, signal, dir = directory()) {
        if (!options.enabled())
            return IDLE;
        let hooks;
        try {
            hooks = await options.store.hooksFor(event, subject);
        }
        catch (error) {
            log?.warn(`hooks: 读取配置失败：${String(error)}`);
            return IDLE;
        }
        if (hooks.length === 0)
            return IDLE;
        const runs = [];
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
                });
                runs.push(result);
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
                });
            }
            catch (error) {
                log?.warn(`hooks: ${event} 的 hook 执行异常：${String(error)}`);
            }
        }
        return { merged: mergeHookOutcomes(runs), ran: hooks.length };
    }
    function contextMessage(texts) {
        if (texts.length === 0)
            return undefined;
        const content = texts.map((text) => ({ type: 'text', text }));
        return createUserMessage({ content, source: CONTEXT_SOURCE });
    }
    function base(agent, event) {
        return {
            session_id: agent?.session?.header?.id ?? '',
            transcript_path: '',
            hook_event_name: event,
        };
    }
    /** 没有 agent 对象的事件（子代理、失败）用会话 id 拼同样的骨架。 */
    function baseOf(sessionId, event) {
        return { session_id: typeof sessionId === 'string' ? sessionId : '', transcript_path: '', hook_event_name: event };
    }
    /** 只有在会话来源匹配时才会跑：matcher 的对象是 SessionStart 的 source。 */
    ctx.on('agent/created', async ({ agent, source }) => {
        const outcome = await runEvent('SessionStart', String(source ?? ''), { ...base(agent, 'SessionStart'), source }, undefined, directory(agent));
        const message = contextMessage(outcome.merged.additionalContext);
        if (message !== undefined)
            agent.inject(message);
    });
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
        const content = messages.flatMap((message) => message.content);
        const outcome = await runEvent('UserPromptSubmit', '', {
            ...base(agent, 'UserPromptSubmit'),
            prompt: blocksToText(content),
        }, signal, directory(agent));
        if (outcome.merged.decision === 'deny')
            return { kind: 'reject' };
        const downstream = await next();
        const message = contextMessage(outcome.merged.additionalContext);
        if (message === undefined || downstream?.kind !== 'enter')
            return downstream;
        return { ...downstream, messages: [...downstream.messages, message] };
    });
    ctx.on('tools/pre-execute', async (exec, next) => {
        const outcome = await runEvent('PreToolUse', exec.name, {
            ...base(exec.agent, 'PreToolUse'),
            tool_name: exec.name,
            tool_input: exec.arguments,
            tool_use_id: exec.callId,
        }, exec.signal, directory(exec.agent));
        if (outcome.merged.decision === 'deny') {
            return { kind: 'deny', reason: outcome.merged.reason || '被 PreToolUse 钩子拒绝' };
        }
        if (outcome.merged.decision === 'ask') {
            return { kind: 'ask', ...(outcome.merged.reason === '' ? {} : { reason: outcome.merged.reason }) };
        }
        return next();
    });
    ctx.on('tools/post-execute', async (exec, result, next) => {
        // 工具报错时不跑 PostToolUse：Claude Code 的 PostToolUse 只对成功结果触发，
        // 失败有独立事件。混在一起会让「成功了才跑」的格式化钩子对着报错结果乱改。
        if (result?.isError === true)
            return next();
        const outcome = await runEvent('PostToolUse', exec.name, {
            ...base(exec.agent, 'PostToolUse'),
            tool_name: exec.name,
            tool_input: exec.arguments,
            tool_use_id: exec.callId,
            tool_response: blocksToText(result?.content ?? []),
        }, exec.signal, directory(exec.agent));
        const message = contextMessage(outcome.merged.additionalContext);
        if (outcome.merged.decision === 'deny') {
            return {
                kind: 'block',
                feedback: [{ type: 'text', text: outcome.merged.reason || '被 PostToolUse 钩子拦截' }],
                ...(message === undefined ? {} : { additionalContexts: [message] }),
            };
        }
        const downstream = await next();
        if (message === undefined)
            return downstream;
        return { ...downstream, additionalContexts: [message, ...(downstream?.additionalContexts ?? [])] };
    });
    ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
        const sessionId = agent?.session?.header?.id ?? '';
        const outcome = await runEvent('Stop', '', { ...base(agent, 'Stop'), stop_hook_active: false }, undefined, directory(agent));
        if (outcome.merged.decision !== 'deny') {
            stopStreak.delete(sessionId);
            return;
        }
        const streak = (stopStreak.get(sessionId) ?? 0) + 1;
        stopStreak.set(sessionId, streak);
        if (streak > MAX_STOP_CONTINUATIONS) {
            log?.warn(`hooks: Stop 钩子已连续拒绝 ${MAX_STOP_CONTINUATIONS} 次（第 ${turn} 轮），本次放行`);
            stopStreak.delete(sessionId);
            return;
        }
        const message = contextMessage([outcome.merged.reason || '继续：Stop 钩子要求再走一步']);
        if (message !== undefined)
            agent.steer(message);
    });
    /**
     * 工具失败：宿主文档指定的观察点是 `tools/result`（`tools/post-execute` 只用来改写结果）。
     * 这里只能观察，所以钩子的 additionalContext 直接注入会话，让模型下一轮看得到。
     */
    ctx.on('tools/result', async (exec, result) => {
        if (result?.isError !== true)
            return;
        const outcome = await runEvent('PostToolUseFailure', exec?.name ?? '', {
            ...base(exec?.agent, 'PostToolUseFailure'),
            tool_name: exec?.name ?? '',
            tool_input: exec?.arguments,
            tool_use_id: exec?.callId,
            error: failureText(result?.error),
        }, exec?.signal, directory(exec?.agent));
        const message = contextMessage(outcome.merged.additionalContext);
        if (message !== undefined)
            exec?.agent?.inject?.(message);
    });
    /**
     * 会话结束：`agent/disposed` 是宿主释放 agent 的时点。子代理释放也会走这里，
     * 但它们有自己的 SubagentStop，所以按 session header 的 parentSession 排掉。
     */
    ctx.on('agent/disposed', async ({ agent }) => {
        if (agent?.session?.header?.parentSession)
            return;
        await runEvent('SessionEnd', 'other', { ...base(agent, 'SessionEnd'), reason: 'other' }, undefined, directory(agent));
    });
    ctx.on('subagent/start', async (info) => {
        await runEvent('SubagentStart', '', {
            ...baseOf(info?.parentSessionId, 'SubagentStart'),
            agent_id: String(info?.id ?? ''),
            agent_type: String(info?.provider ?? ''),
            local: info?.local === true,
        });
    });
    ctx.on('subagent/end', async (info) => {
        await runEvent('SubagentStop', '', {
            ...baseOf(info?.parentSessionId, 'SubagentStop'),
            agent_id: String(info?.id ?? ''),
            agent_type: String(info?.provider ?? ''),
            stop_reason: String(info?.stopReason ?? ''),
            last_assistant_message: blocksToText(info?.lastAssistantMessage ?? []),
        });
    });
    return {
        /** 面板的「试跑」：按当前配置里的条目跑一次，不参与决策。 */
        async runTest(hook, payload) {
            const dir = directory();
            const result = await execute({
                event: hook.event,
                command: hook.command,
                timeoutMs: hook.timeoutMs,
                payload: { ...payload, cwd: dir },
                cwd: dir,
                env: env(dir),
            });
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
            });
            return result;
        },
    };
}
