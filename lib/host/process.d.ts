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

export declare function runProcess(
  command: string,
  args?: readonly string[],
  options?: ProcessOptions,
): Promise<ProcessResult>
