import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { resolveElectron, helperEnvironment, type ResolveElectronOptions } from './electron.js'
import { readElectronPath, type PetSettings } from './config.js'
import type { HelperBridge } from './bridge.js'

/** 与 `spawn` 的三参数重载同形；测试用假实现替换它（见 tests/pet/host.helper.test.mjs）。 */
type Launch = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/**
 * helper 进程入口的绝对路径，分隔符统一成 `/`。
 *
 * spawn 在 Windows 上同样接受 `/`；统一成一种形状，日志、测试断言和跨端排查就不用各自兼容。
 */
function runtimeEntry(): string {
  return fileURLToPath(new URL('./runtime/main.cjs', import.meta.url)).replace(/\\/g, '/')
}

/** 客户端只看 `status` 决定画什么；`error` 是给人看的诊断文本，会原样进 /state。 */
export interface HelperState {
  status: 'stopped' | 'starting' | 'running' | 'error'
  available: boolean
  error?: string | undefined
}

export interface HelperManagerOptions {
  onChange: () => void
  bridge: HelperBridge
  resolve?: (options: ResolveElectronOptions) => Promise<string | undefined>
  launch?: Launch
}

export class HelperManager {
  onChange: () => void
  bridge: HelperBridge
  resolve: (options: ResolveElectronOptions) => Promise<string | undefined>
  launch: Launch
  state: HelperState
  child: ChildProcess | undefined
  generation: number
  enabled: boolean
  disposed: boolean
  failures: number
  pending: Promise<void> | undefined
  config: any
  restart: ReturnType<typeof setTimeout> | undefined

  constructor({ onChange, bridge, resolve = resolveElectron, launch = spawn }: HelperManagerOptions) {
    this.onChange = onChange
    this.bridge = bridge
    this.resolve = resolve
    this.launch = launch
    this.state = { status: 'stopped', available: false }
    this.child = undefined
    this.generation = 0
    this.enabled = false
    this.disposed = false
    this.failures = 0
  }
  update(patch: Partial<HelperState>): void {
    // patch 只由本类的调用点给出，取值都在 HelperState 的合法域内。
    this.state = { ...this.state, ...patch } as HelperState
    this.onChange()
  }
  async prepare(config: any, start = false): Promise<void> {
    if (this.disposed) return
    if (this.pending) return this.pending
    const generation = this.generation
    this.update({ status: 'starting', error: undefined })
    this.pending = (async () => {
      try {
        const binary = await this.resolve({ electronPath: readElectronPath(config), download: true })
        if (this.disposed || generation !== this.generation) return
        this.update({ available: true, status: 'stopped' })
        if (this.enabled) this.start(binary)
      } catch (error: any) {
        if (!this.disposed && generation === this.generation) this.update({ status: 'error', error: error.message })
      }
    })().finally(() => { this.pending = undefined })
    return this.pending
  }
  async configure(config: any, settings: PetSettings): Promise<void> {
    this.config = config
    this.enabled = settings.petEnabled || settings.islandEnabled
    if (!this.enabled) { await this.stop(); return }
    await this.pending
    if (this.enabled && !this.child && this.state.status !== 'error') await this.prepare(this.config, true)
  }
  start(binary: string | undefined): void {
    if (this.child || this.disposed || !this.enabled) return
    this.update({ status: 'starting', error: undefined })
    let child: ChildProcess
    try {
      // binary 可能是 undefined（下载未启用或找不到）：spawn 会立刻抛错，由下面的 catch 转成 error 状态。
      child = this.launch(binary as string, [runtimeEntry()], {
        cwd: tmpdir(), env: helperEnvironment(this.bridge.url, this.bridge.token), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      })
    } catch (error: any) { this.update({ status: 'error', error: error.message }); return }
    this.child = child
    let buffer = '', diagnostics = ''
    const started = Date.now()
    const timeout = setTimeout(() => {
      if (this.child === child && this.state.status === 'starting') {
        this.update({ status: 'error', error: 'Desktop helper did not become ready' })
        child.kill()
      }
    }, 20000)
    timeout.unref?.()
    child.stdout?.on('data', (chunk: any) => {
      buffer = (buffer + chunk.toString()).slice(-8192)
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        try { if (JSON.parse(line).type === 'ready' && this.child === child) { clearTimeout(timeout); this.update({ status: 'running', error: undefined }) } } catch { /* Nonprotocol output is ignored. */ }
      }
    })
    child.stderr?.on('data', (chunk: any) => { diagnostics = (diagnostics + chunk.toString()).slice(-2000) })
    child.on('error', (error: Error) => { diagnostics = error.message })
    const finished = (): void => {
      clearTimeout(timeout)
      if (this.child !== child) return
      this.child = undefined
      if (!this.enabled || this.disposed) { this.update({ status: 'stopped' }); return }
      if (Date.now() - started > 180000) this.failures = 0
      this.failures += 1
      this.update({ status: 'error', error: diagnostics.trim() || 'Desktop helper exited unexpectedly' })
      if (this.failures <= 3) {
        this.restart = setTimeout(() => { this.restart = undefined; if (this.enabled && !this.disposed) void this.prepare(this.config, true) }, 750 * 2 ** (this.failures - 1))
        this.restart.unref?.()
      }
    }
    child.once('exit', finished)
    child.once('error', finished)
  }
  async retry(config: any): Promise<void> {
    clearTimeout(this.restart)
    this.failures = 0
    await this.stop()
    await this.pending
    return this.prepare(config, this.enabled)
  }
  async stop(): Promise<void> {
    this.generation += 1
    clearTimeout(this.restart)
    const child = this.child
    this.child = undefined
    if (child) await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const done = (): void => { clearTimeout(timer); resolve() }
      child.once('exit', done)
      child.kill('SIGTERM')
      timer = setTimeout(() => { child.kill('SIGKILL'); done() }, 3000)
      timer.unref?.()
    })
    this.update({ status: 'stopped', error: undefined })
  }
  async dispose(): Promise<void> { this.disposed = true; this.enabled = false; await this.stop() }
}
