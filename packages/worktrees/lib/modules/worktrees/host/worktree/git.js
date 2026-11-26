import { isAbsolute } from 'node:path';
async function* transactionLines(stdout) {
    let pending = '';
    let bytes = 0;
    for await (const chunk of stdout) {
        bytes += chunk.length;
        if (bytes > 256)
            throw new Error('unexpected ref transaction output');
        pending += chunk.toString('utf8');
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
            yield pending.slice(0, newline);
            pending = pending.slice(newline + 1);
        }
    }
    if (pending)
        throw new Error('incomplete ref transaction output');
}
async function runPreparedWrite(stdin, stdout, prepared, signal) {
    const lines = transactionLines(stdout);
    const expect = async (text) => {
        if ((await lines.next()).value !== text)
            throw new Error('unconfirmed ref transaction phase');
    };
    // A process exit can close stdin while a command is queued. The stdout phase
    // acknowledgement and the provider's outcome, not the write callback, are proof.
    stdin.on('error', () => { });
    try {
        stdin.write(`start\n${prepared.commands}prepare\n`);
        await expect('start: ok');
        await expect('prepare: ok');
        await prepared.verify();
        signal.throwIfAborted();
        stdin.end('commit\n');
        await expect('commit: ok');
        if (!(await lines.next()).done)
            throw new Error('unexpected ref transaction output');
    }
    catch (error) {
        if (!stdin.writableEnded)
            stdin.end();
        throw error;
    }
}
const MAX_OUTPUT = 1024 * 1024;
const TERMINATION_GRACE_MS = 250;
// All callers use plumbing without worktree conversion, checkout, or network access.
const gitOptions = [
    '--no-optional-locks', '--no-lazy-fetch', '--no-replace-objects',
    '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.quotePath=false',
];
export async function makeWorktreeGit(ctx, policy, signal) {
    const subprocess = ctx.get?.('subprocess');
    const sandbox = ctx.get?.('sandbox');
    if (typeof subprocess?.resolveExecutable !== 'function' || typeof subprocess?.spawn !== 'function'
        || typeof sandbox?.confine !== 'function')
        throw new Error('native Git process boundary unavailable');
    const executable = await subprocess.resolveExecutable('git', undefined, signal);
    if (typeof executable !== 'string' || !isAbsolute(executable))
        throw new Error('Git executable not resolved');
    const env = {};
    for (const key of Object.keys(process.env)) {
        if (/^(GIT_|LD_|DYLD_)/i.test(key))
            env[key] = undefined;
    }
    Object.assign(env, {
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0', GIT_ALLOW_PROTOCOL: '', LC_ALL: 'C',
    });
    return async (cwd, args, { allowedCodes = [0], allowStderr, stdin = 'ignore', prepared } = {}) => {
        signal.throwIfAborted();
        const wrapped = await sandbox.confine([executable, ...gitOptions, ...args], policy, signal);
        signal.throwIfAborted();
        if (wrapped?.enforcement !== 'full' || !wrapped.argv?.length)
            throw new Error('complete Git confinement unavailable');
        const child = subprocess.spawn({
            argv: wrapped.argv, cwd, env, signal, graceMs: TERMINATION_GRACE_MS,
            stdio: { stdin: prepared ? 'pipe' : stdin, stdout: prepared ? 'pipe' : { maxBytes: MAX_OUTPUT }, stderr: { maxBytes: 4096 } },
        });
        const done = child.done;
        try {
            if (prepared) {
                void done.catch(() => { }); // May reject before the phase reader sees EOF.
                await runPreparedWrite(child.stdin, child.stdout, prepared, signal);
            }
            const outcome = await done;
            signal.throwIfAborted();
            const stdout = prepared ? { text: '', lossy: false } : child.collected.stdout?.readFrom(0);
            const stderr = child.collected.stderr?.readFrom(0);
            const code = outcome.exitCode;
            if (code === null || !allowedCodes.includes(code) || outcome.signal !== null || !stdout || !stderr
                || stdout.lossy || stderr.lossy || (stderr.text && !(allowStderr && allowStderr.code === code && allowStderr.text === stderr.text))
                || stdout.text.includes('\ufffd'))
                throw new Error('Git result inconclusive');
            return { text: stdout.text, code };
        }
        finally {
            child.terminate();
            if (!await child.waitForExit(AbortSignal.timeout(2 * TERMINATION_GRACE_MS)))
                throw new Error('Git exit unconfirmed');
        }
    };
}
