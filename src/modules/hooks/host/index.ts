/**
 * hooks 模块的装配层：只做「读配置 → 建 store / history / runtime → 挂路由」。
 *
 * 这里没有事情可做时**不报错**：缺 webServer/connection 就只保留运行时，
 * 让装了插件但没开 Web 服务的环境也能正常跑钩子。
 */
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { registerJsonRoutes } from '../../../host/routes.js'
import { Config, readSettings } from './config.js'
import { createHookStore } from './domain/files.js'
import { createHookHistory } from './domain/history.js'
import { createHookRuntime } from './domain/runtime.js'
import { createHookRoutes, syntheticPayload } from './routes/hooks.js'

export const name = 'dsh-toolkit-hooks'

/** 不依赖任何宿主服务：钩子只监听事件，初始化权重为零。 */
export const inject: string[] = []

export { Config }

interface WorkingDirectoryLike {
  readonly defaultDirectory: string
  get(session: unknown): string
}

export function apply(ctx: any, config: unknown = {}): void {
  const settings = readSettings(config)
  const home = resolveDshHome()

  /**
   * 会话当前目录的来源。
   *
   * 桌面端 DSH 的 `process.cwd()` 是安装目录，直接用它当项目目录会让
   * `<workspace>/.dsh/hooks.json` 永远找不到。所以优先问 workingDirectory 服务；
   * 它要显式 `inject` 才拿得到（在没声明 inject 的插件里直接读 `ctx.workingDirectory`
   * 会被 cordis 拒绝），面板在没有会话时也要有个真实路径可展示，于是记住最后看到的目录。
   */
  let workingDirectory: WorkingDirectoryLike | undefined
  let sessionDir = ''

  ctx.inject(['workingDirectory'], (serviceCtx: any) => {
    workingDirectory = serviceCtx.workingDirectory as WorkingDirectoryLike | undefined
  })

  const projectDir = (): string => {
    if (settings.projectDir !== '') return settings.projectDir
    if (sessionDir !== '') return sessionDir
    const fallback = workingDirectory?.defaultDirectory
    return fallback !== undefined && fallback !== '' ? fallback : process.cwd()
  }

  const directoryOf = (agent?: any): string => {
    if (settings.projectDir !== '') return settings.projectDir
    if (agent !== undefined) {
      try {
        const dir = workingDirectory?.get(agent.session)
        if (typeof dir === 'string' && dir !== '') sessionDir = dir
      } catch {
        // 服务未就绪（或会话已销毁）时退回上一个已知目录，钩子照跑。
      }
    }
    return projectDir()
  }

  const store = createHookStore({
    home,
    projectDir,
    userFile: settings.userFile,
    includeProject: settings.includeProject,
    defaultTimeoutMs: settings.defaultTimeoutMs,
    enabled: () => settings.enabled,
  })
  const history = createHookHistory(settings.maxHistory)
  const runtime = createHookRuntime(ctx, {
    store,
    history,
    enabled: () => settings.enabled,
    directory: directoryOf,
  })

  // 面板路由是可选的：没有 Web 服务时钩子照跑，`ctx.inject` 只是让回调一直不触发。
  ctx.inject(['webServer', 'connection'], (routeCtx: any) => {
    registerJsonRoutes(routeCtx, createHookRoutes({
      store,
      history,
      runTest: async (hookId) => {
        const hook = await store.find(hookId)
        if (hook === undefined) return { ok: false, reason: 'hook 已不在配置里' }
        return runtime.runTest(hook, syntheticPayload(hook.event))
      },
    }))
  })
}

export default { name, inject, Config, apply }
