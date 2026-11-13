import { spawn, type ChildProcess } from 'node:child_process'
import { createOperation } from './operation.js'

const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_KILL_GRACE_MS = 1000

export interface ProcessOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  stdin?: string | Uint8Array
  signal?: AbortSignal
  timeoutMs?: number
  /** Combined stdout+stderr byte limit, default 8 MiB. */
  maxOutputBytes?: number
  killSignal?: NodeJS.Signals
  /** Time before SIGKILL escalation after another signal, default 1000 ms. */
  killGraceMs?: number
}

export interface ProcessResult {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly aborted: boolean
  readonly outputLimitExceeded: boolean
  readonly spawnError?: Error
}

/** Run a child with one deadline, bounded combined output, and close-confirmed cancellation. */
export function runProcess(command: string, args: readonly string[] = [], options: ProcessOptions = {}): Promise<ProcessResult> {
  const {
    cwd,
    env = process.env,
    stdin,
    signal,
    timeoutMs,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    killSignal = 'SIGTERM',
    killGraceMs = DEFAULT_KILL_GRACE_MS,
  } = options

  return new Promise((resolve) => {
    const operation = createOperation({ timeoutMs, signal })
    if (operation.signal.aborted) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: operation.timedOut, aborted: operation.aborted, outputLimitExceeded: false })
      operation.dispose()
      return
    }
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const outputLimit = Math.max(0, maxOutputBytes)
    let outputBytes = 0
    let outputLimitExceeded = false
    let spawnError: Error | undefined
    let child: ChildProcess | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let settled = false

    const finish = (code: number | null, closeSignal: NodeJS.Signals | null): void => {
      if (settled) return
      settled = true
      if (killTimer !== undefined) clearTimeout(killTimer)
      operation.signal.removeEventListener('abort', terminate)
      resolve({
        code,
        signal: closeSignal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut: operation.timedOut,
        aborted: operation.aborted,
        outputLimitExceeded,
        ...(spawnError === undefined ? {} : { spawnError }),
      })
      operation.dispose()
    }

    const closePipes = (): void => {
      child?.stdout?.destroy()
      child?.stderr?.destroy()
      child?.stdin?.destroy()
    }

    const terminate = (): void => {
      if (child === undefined) return
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill(killSignal) } catch { /* The child may already be exiting. */ }
        if (killSignal !== 'SIGKILL' && killGraceMs >= 0 && killTimer === undefined) {
          killTimer = setTimeout(() => {
            if (child !== undefined && child.exitCode === null && child.signalCode === null) {
              try { child.kill('SIGKILL') } catch { /* The child may already be exiting. */ }
            }
            closePipes()
          }, killGraceMs)
        }
      }
      // Descendants may inherit these descriptors after the direct child exits.
      closePipes()
    }

    const capture = (target: Buffer[], chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      const remaining = Math.max(0, outputLimit - outputBytes)
      const kept = Math.min(remaining, buffer.length)
      if (kept > 0) target.push(buffer.subarray(0, kept))
      outputBytes += kept
      if (kept < buffer.length && !outputLimitExceeded) {
        outputLimitExceeded = true
        terminate()
      }
    }

    try {
      child = spawn(command, [...args], {
        cwd,
        env,
        stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      spawnError = error instanceof Error ? error : new Error(String(error))
      operation.dispose()
      resolve({ code: null, signal: null, stdout: '', stderr: '', timedOut: operation.timedOut, aborted: operation.aborted, outputLimitExceeded, spawnError })
      return
    }

    child.stdout?.on('data', (chunk: Buffer | string) => capture(stdout, chunk))
    child.stderr?.on('data', (chunk: Buffer | string) => capture(stderr, chunk))
    child.stdin?.on('error', () => {})
    child.on('error', (error) => { spawnError = error })
    child.on('close', (code, closeSignal) => finish(code, closeSignal))
    operation.signal.addEventListener('abort', terminate, { once: true })
    if (operation.signal.aborted) terminate()
    if (stdin !== undefined && child.stdin !== null) child.stdin.end(stdin)
  })
}
