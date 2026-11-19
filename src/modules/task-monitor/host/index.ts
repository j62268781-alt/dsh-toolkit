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
import { classifyCall } from './domain/classify.js'
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
  const store = createTaskMonitorStore({ home: dshHome(), enabled: () => readSettings(config).enabled })

  ctx.on('tools/post-execute', (exec: any, result: any, next: () => Promise<any>) => {
    if (result?.isError !== true) {
      const sessionId = sessionOf(exec?.agent)
      if (sessionId !== '') void store.record(sessionId, classifyCall(exec?.name, exec?.arguments), 'ok')
    }
    return next()
  })

  ctx.on('tools/result', (exec: any, result: any) => {
    if (result?.isError !== true) return
    const sessionId = sessionOf(exec?.agent)
    if (sessionId !== '') void store.record(sessionId, classifyCall(exec?.name, exec?.arguments), 'failed')
  })

  ctx.on('agent/disposed', ({ agent }: any) => {
    const sessionId = sessionOf(agent)
    if (sessionId !== '') void store.flush(sessionId)
  })

  // 模块卸载时把防抖窗口里的改动落盘，重启不丢最后几秒的清单。
  ctx.effect(() => () => { void store.dispose() }, 'dsh-toolkit-task-monitor:flush')

  // 没有 Web 服务时只保留聚合，面板路由缺席不影响工具链。
  ctx.inject(['webServer', 'connection'], (routeCtx: any) => {
    registerJsonRoutes(routeCtx, createTaskMonitorRoutes({ store }))
  })
}

export default { name, inject, Config, apply }