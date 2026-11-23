/**
 * monitor 模块装配：只读订阅工具事件 → 聚合进 store → 挂三条路由。
 *
 * 订阅 `tools/post-execute` 必须把 `next()` 原样交还——我们是观察者，不是决策者，
 * 吞掉 next 会断掉整条工具链。失败观察走宿主指定的 `tools/result`。
 * 子代理的事件按 parentSession 归到主会话，面板才是一个任务一张清单。
 */
import { dshHome } from '../../../host/dsh-home.js'
import { registerJsonRoutes } from '../../../host/routes.js'
import { NAME } from './constants.js'
import { Config, readSettings } from './config.js'
import { absoluteArtifact, workspaceArtifacts } from './domain/artifacts.js'
import { classifyCall } from './domain/classify.js'
import { observeInputSources } from './domain/sources.js'
import { createTaskMonitorStore } from './domain/store.js'
import { createTaskMonitorRoutes } from './routes/highlights.js'

export const name = NAME

/** 事件监听不需要声明 inject；webServer/connection 走下面的可选注入。 */
export const inject: string[] = []

export { Config }

function sessionOf(agent: any): string {
  const header = agent?.session?.header
  const parent = header?.parentSession
  const id = typeof parent === 'string' && parent !== '' ? parent : header?.id
  return typeof id === 'string' ? id : ''
}

export function apply(ctx: any, config: unknown = {}): void {
  const headerCwd = (session: any): unknown => session?.header?.cwd
  let cwdOf = headerCwd
  let sessionOfId = (_id: string): any => undefined
  ctx.inject(['workingDirectory'], (serviceCtx: any) => {
    cwdOf = (session: any) => {
      if (session !== undefined) {
        try { return serviceCtx.workingDirectory.get(session) ?? headerCwd(session) } catch { /* session is gone */ }
      }
      return headerCwd(session)
    }
    return () => { cwdOf = headerCwd }
  })
  ctx.inject(['sessions'], (serviceCtx: any) => {
    sessionOfId = (id: string) => serviceCtx.sessions.get(id)
    return () => { sessionOfId = () => undefined }
  })
  const store = createTaskMonitorStore({
    home: dshHome(), enabled: () => readSettings(config).enabled,
    cwdOf: (id) => cwdOf(sessionOfId(id)),
  })

  ctx.on('tools/post-execute', (exec: any, result: any, next: () => Promise<any>) => {
    if (result?.isError !== true) {
      const sessionId = sessionOf(exec?.agent)
      const seeds = classifyCall(exec?.name, exec?.arguments)
      if (sessionId !== '' && seeds.length > 0) {
        const cwd = seeds.some(seed => seed.kind === 'artifact') ? cwdOf(exec?.agent?.session) : undefined
        void store.record(sessionId, seeds.map(seed => absoluteArtifact(seed, cwd)), 'ok')
      }
    }
    return next()
  })

  ctx.on('tools/result', (exec: any, result: any) => {
    if (result?.isError !== true) return
    const sessionId = sessionOf(exec?.agent)
    if (sessionId !== '') void store.record(sessionId, classifyCall(exec?.name, exec?.arguments), 'failed')
  })

  ctx.inject(['workspaceChanges'], (serviceCtx: any) => {
    let active = true
    serviceCtx.on('session/event', (session: any, event: any) => {
      if (event?.type !== 'workspace/changes' || typeof event.seq !== 'number') return
      const id = session?.header?.id
      const owner = sessionOf({ session })
      if (typeof id !== 'string' || owner === '') return
      // 宿主先发事件，随后才把同一个 seq 的摘要放进服务。
      queueMicrotask(() => {
        if (!active) return
        const summary = serviceCtx.workspaceChanges.summary(id, event.seq)
        void store.record(owner, workspaceArtifacts(summary), 'ok')
      })
    })
    return () => { active = false }
  })

  ctx.on('session/event', observeInputSources((sessionId, seeds) => {
    void store.record(sessionId, seeds, 'ok')
  }))

  ctx.on('agent/disposed', ({ agent }: any) => {
    const sessionId = sessionOf(agent)
    if (sessionId !== '') void store.flush(sessionId)
  })

  // 模块卸载时把防抖窗口里的改动落盘，重启不丢最后几秒的清单。
  ctx.effect(() => () => { void store.dispose() }, 'dsh-toolkit-session-panel:flush')

  // 没有 Web 服务时只保留聚合，面板路由缺席不影响工具链。
  ctx.inject(['webServer', 'connection'], (routeCtx: any) => {
    registerJsonRoutes(routeCtx, createTaskMonitorRoutes({ store }))
  })
}

export default { name, inject, Config, apply }