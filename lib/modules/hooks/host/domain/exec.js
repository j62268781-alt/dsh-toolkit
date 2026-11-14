/**
 * 跑一条 command hook：拼 stdin 载荷、起子进程、把 stdout 解码成决策。
 *
 * 这里只实现 Claude Code 的**命令钩子子集**（也是 Qoder 面板里唯一真正可写的形态）：
 * - 退出码 2 → 拒绝（stderr 作为理由）；
 * - 退出码 0 + stdout JSON → `decision` / `hookSpecificOutput.permissionDecision`；
 * - 其它退出码、超时、起不来 → 记一条失败，按「不阻塞」处理。
 *
 * 最后一条是刻意的：钩子写崩了不该让用户的每一次工具调用都失败，否则一个笔误就把
 * 会话锁死。面板的「最近执行」会把失败原因摆出来，让人自己去改。
 */
import { runProcess } from '../../../../host/process.js';
import { MAX_OUTPUT_SUMMARY_CHARS } from '../constants.js';
/** 把一条命令交给平台 shell：POSIX 用 `sh -c`，Windows 用 `cmd.exe /d /s /c`。 */
export function shellInvocation(command, platform = process.platform, env = process.env) {
    if (platform === 'win32') {
        return { command: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', command] };
    }
    return { command: '/bin/sh', args: ['-c', command] };
}
function clip(text, limit = MAX_OUTPUT_SUMMARY_CHARS) {
    return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}
function firstLine(text) {
    const line = text.trim().split(/\r?\n/).find((part) => part.trim() !== '');
    return line === undefined ? '' : line.trim();
}
function parseJsonObject(text) {
    const trimmed = text.replace(/^\uFEFF/, '').trim();
    if (trimmed === '')
        return undefined;
    const candidates = [trimmed];
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start)
        candidates.push(trimmed.slice(start, end + 1));
    for (const candidate of candidates) {
        try {
            const value = JSON.parse(candidate);
            if (typeof value === 'object' && value !== null && !Array.isArray(value))
                return value;
        }
        catch {
            // 继续试下一个候选（有些 hook 会在 JSON 前后打印日志）。
        }
    }
    return undefined;
}
function textOf(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value))
        return value.filter((item) => typeof item === 'string').join('\n');
    return '';
}
function decisionOf(value) {
    if (value === 'allow' || value === 'approve')
        return 'allow';
    if (value === 'deny' || value === 'block')
        return 'deny';
    if (value === 'ask')
        return 'ask';
    return undefined;
}
/**
 * 解码一次运行结果。`event` 只影响提示文案（Stop 的 `block` 读作「继续」）。
 */
export function decodeHookRun(event, run) {
    if (run.spawnError !== undefined) {
        return { decision: 'allow', reason: '', additionalContext: [], error: `启动失败：${run.spawnError.message}` };
    }
    if (run.timedOut) {
        return { decision: 'allow', reason: '', additionalContext: [], error: '超时，已按不阻塞处理' };
    }
    if (run.code === 2) {
        const reason = firstLine(run.stderr) || `${event} hook 拒绝了这次操作`;
        return { decision: 'deny', reason, additionalContext: [], error: '' };
    }
    if (run.code !== 0) {
        const detail = firstLine(run.stderr) || firstLine(run.stdout);
        return {
            decision: 'allow',
            reason: '',
            additionalContext: [],
            error: `退出码 ${run.code ?? 'null'}${detail === '' ? '' : `：${detail}`}`,
        };
    }
    const parsed = parseJsonObject(run.stdout);
    if (parsed === undefined) {
        // 纯文本输出 = 追加给模型的上下文（CC 对 SessionStart / UserPromptSubmit 的约定）。
        const text = run.stdout.trim();
        return { decision: 'allow', reason: '', additionalContext: text === '' ? [] : [clip(text)], error: '' };
    }
    const specific = typeof parsed.hookSpecificOutput === 'object' && parsed.hookSpecificOutput !== null
        ? parsed.hookSpecificOutput
        : {};
    const decision = decisionOf(specific.permissionDecision) ?? decisionOf(parsed.decision) ?? 'allow';
    const reason = textOf(specific.permissionDecisionReason) || textOf(parsed.reason);
    const context = [
        ...(textOf(parsed.additionalContext) === '' ? [] : [clip(textOf(parsed.additionalContext))]),
        ...(textOf(specific.additionalContext) === '' ? [] : [clip(textOf(specific.additionalContext))]),
    ];
    return { decision, reason, additionalContext: context, error: '' };
}
export async function runHookCommand(request) {
    const now = request.now ?? Date.now;
    const startedAt = now();
    const invocation = shellInvocation(request.command, request.platform, request.env);
    const stdin = `${JSON.stringify(request.payload)}\n`;
    const result = await runProcess(invocation.command, invocation.args, {
        cwd: request.cwd,
        ...(request.env === undefined ? {} : { env: request.env }),
        stdin,
        timeoutMs: request.timeoutMs,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        maxOutputBytes: 1_024 * 1_024,
    });
    const decoded = decodeHookRun(request.event, {
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        timedOut: result.timedOut,
        ...(result.spawnError === undefined ? {} : { spawnError: result.spawnError }),
    });
    return {
        ...decoded,
        code: result.code,
        timedOut: result.timedOut,
        durationMs: Math.max(0, now() - startedAt),
        stdout: clip(result.stdout),
        stderr: clip(result.stderr),
    };
}
/** 多条 hook 的决策合并：拒绝 > 询问 > 放行，上下文按顺序拼接。 */
export function mergeHookOutcomes(runs) {
    const decision = runs.some((run) => run.decision === 'deny')
        ? 'deny'
        : runs.some((run) => run.decision === 'ask') ? 'ask' : 'allow';
    const reason = runs.find((run) => run.reason !== '')?.reason ?? '';
    return { decision, reason, additionalContext: runs.flatMap((run) => run.additionalContext) };
}
//# sourceMappingURL=exec.js.map