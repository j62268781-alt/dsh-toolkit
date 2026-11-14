import { spawn } from 'node:child_process';
import { createOperation } from './operation.js';
import { resolveSpawnTarget } from './executable.js';
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 1000;
/** Run a child with one deadline, bounded combined output, and close-confirmed cancellation. */
export function runProcess(command, args = [], options = {}) {
    const { cwd, env = process.env, stdin, signal, timeoutMs, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES, killSignal = 'SIGTERM', killGraceMs = DEFAULT_KILL_GRACE_MS, } = options;
    return new Promise((resolve) => {
        const operation = createOperation({ timeoutMs, signal });
        if (operation.signal.aborted) {
            resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: operation.timedOut, aborted: operation.aborted, outputLimitExceeded: false });
            operation.dispose();
            return;
        }
        const stdout = [];
        const stderr = [];
        const outputLimit = Math.max(0, maxOutputBytes);
        let outputBytes = 0;
        let outputLimitExceeded = false;
        let spawnError;
        let child;
        let killTimer;
        let settled = false;
        const finish = (code, closeSignal) => {
            if (settled)
                return;
            settled = true;
            if (killTimer !== undefined)
                clearTimeout(killTimer);
            operation.signal.removeEventListener('abort', terminate);
            resolve({
                code,
                signal: closeSignal,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
                timedOut: operation.timedOut,
                aborted: operation.aborted,
                outputLimitExceeded,
                ...(spawnError === undefined ? {} : { spawnError }),
            });
            operation.dispose();
        };
        const closePipes = () => {
            child?.stdout?.destroy();
            child?.stderr?.destroy();
            child?.stdin?.destroy();
        };
        const terminate = () => {
            if (child === undefined)
                return;
            if (child.exitCode === null && child.signalCode === null) {
                try {
                    child.kill(killSignal);
                }
                catch { /* The child may already be exiting. */ }
                if (killSignal !== 'SIGKILL' && killGraceMs >= 0 && killTimer === undefined) {
                    killTimer = setTimeout(() => {
                        if (child !== undefined && child.exitCode === null && child.signalCode === null) {
                            try {
                                child.kill('SIGKILL');
                            }
                            catch { /* The child may already be exiting. */ }
                        }
                        closePipes();
                    }, killGraceMs);
                }
            }
            // Descendants may inherit these descriptors after the direct child exits.
            closePipes();
        };
        const capture = (target, chunk) => {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            const remaining = Math.max(0, outputLimit - outputBytes);
            const kept = Math.min(remaining, buffer.length);
            if (kept > 0)
                target.push(buffer.subarray(0, kept));
            outputBytes += kept;
            if (kept < buffer.length && !outputLimitExceeded) {
                outputLimitExceeded = true;
                terminate();
            }
        };
        try {
            // Windows 上 `.cmd` / `.bat`（npm 装的 CLI 都是这种）不能被 CreateProcess 直接
            // 执行，得经 cmd.exe；`resolveSpawnTarget` 只对这两种后缀动手，其余原样传。
            const target = resolveSpawnTarget(command, args, process.platform, env ?? process.env);
            child = spawn(target.command, target.args, {
                cwd,
                env,
                stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
                windowsHide: true,
                ...(target.windowsVerbatimArguments === undefined ? {} : { windowsVerbatimArguments: target.windowsVerbatimArguments }),
            });
        }
        catch (error) {
            spawnError = error instanceof Error ? error : new Error(String(error));
            operation.dispose();
            resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: operation.timedOut, aborted: operation.aborted, outputLimitExceeded, spawnError });
            return;
        }
        child.stdout?.on('data', (chunk) => capture(stdout, chunk));
        child.stderr?.on('data', (chunk) => capture(stderr, chunk));
        child.stdin?.on('error', () => { });
        child.on('error', (error) => { spawnError = error; });
        child.on('close', (code, closeSignal) => finish(code, closeSignal));
        operation.signal.addEventListener('abort', terminate, { once: true });
        if (operation.signal.aborted)
            terminate();
        if (stdin !== undefined && child.stdin !== null)
            child.stdin.end(stdin);
    });
}
//# sourceMappingURL=process.js.map