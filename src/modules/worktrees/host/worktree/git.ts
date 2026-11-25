import { isAbsolute } from 'node:path'
import type { SandboxPolicy } from '@deepseek-ai/dsh-sandbox'

interface GitOptions {
  allowedCodes?: number[]
}

const MAX_OUTPUT = 1024 * 1024
const TERMINATION_GRACE_MS = 250

// All callers use plumbing without worktree conversion, checkout, or network access.
const gitOptions = [
  '--no-optional-locks', '--no-lazy-fetch', '--no-replace-objects',
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
  '-c', 'gc.auto=0', '-c', 'maintenance.auto=false', '-c', 'core.quotePath=false',
]

export async function makeWorktreeGit(ctx: any, policy: SandboxPolicy, signal: AbortSignal) {
  const subprocess = ctx.get?.('subprocess')
  const sandbox = ctx.get?.('sandbox')
  if (typeof subprocess?.resolveExecutable !== 'function' || typeof subprocess?.spawn !== 'function'
    || typeof sandbox?.confine !== 'function') throw new Error('native Git process boundary unavailable')
  const executable = await subprocess.resolveExecutable('git', undefined, signal)
  if (typeof executable !== 'string' || !isAbsolute(executable)) throw new Error('Git executable not resolved')
  const env: NodeJS.ProcessEnv = {}
  for (const key of Object.keys(process.env)) {
    if (/^(GIT_|LD_|DYLD_)/i.test(key)) env[key] = undefined
  }
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0', GIT_ALLOW_PROTOCOL: '', LC_ALL: 'C',
  })
  return async (cwd: string, args: string[], { allowedCodes = [0] }: GitOptions = {}): Promise<{ text: string; code: number }> => {
    signal.throwIfAborted()
    const wrapped = await sandbox.confine([executable, ...gitOptions, ...args], policy, signal)
    signal.throwIfAborted()
    if (wrapped?.enforcement !== 'full' || !wrapped.argv?.length) throw new Error('complete Git confinement unavailable')
    const child = subprocess.spawn({
      argv: wrapped.argv, cwd, env, signal, graceMs: TERMINATION_GRACE_MS,
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT }, stderr: { maxBytes: 4096 } },
    })
    const done = child.done
    try {
      const outcome = await done
      signal.throwIfAborted()
      const stdout = child.collected.stdout?.readFrom(0)
      const stderr = child.collected.stderr?.readFrom(0)
      const code = outcome.exitCode
      if (code === null || !allowedCodes.includes(code) || outcome.signal !== null || !stdout || !stderr
        || stdout.lossy || stderr.lossy || stderr.text
        || stdout.text.includes('\ufffd')) throw new Error('Git result inconclusive')
      return { text: stdout.text, code }
    } finally {
      child.terminate()
      if (!await child.waitForExit(AbortSignal.timeout(2 * TERMINATION_GRACE_MS))) throw new Error('Git exit unconfirmed')
    }
  }
}
