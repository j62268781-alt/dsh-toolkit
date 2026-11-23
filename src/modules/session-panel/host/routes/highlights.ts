/**
 * 任务监控的三条路由：读快照、加来源、移来源。
 *
 * 状态码只在这一层决定：域层给稳定数字业务码，这里一张表折算 HTTP。
 * client 读 code 与 detail，不解析文案反推状态。
 */
import type { JsonRouteSpec } from '../../../../host/routes.js'
import {
  TASK_MONITOR_REASON,
  TASK_MONITOR_SNAPSHOT_PATH,
  TASK_MONITOR_SOURCE_ADD_PATH,
  TASK_MONITOR_SOURCE_REMOVE_PATH,
  type TaskMonitorReasonCode,
} from '../constants.js'
import type { TaskMonitorStore } from '../domain/store.js'

/** sessionId + 类型 + 最长 2048 字符的来源值，8 KiB 解码字符足够。 */
const LIMIT = 8192

const STATUS: Record<TaskMonitorReasonCode, number> = {
  [TASK_MONITOR_REASON.invalidSession]: 400,
  [TASK_MONITOR_REASON.invalidSource]: 400,
  [TASK_MONITOR_REASON.notManual]: 409,
  [TASK_MONITOR_REASON.notFound]: 404,
  [TASK_MONITOR_REASON.disabled]: 409,
  [TASK_MONITOR_REASON.storeFailed]: 500,
}

function reply(result: { ok: true } | { ok: false, code: TaskMonitorReasonCode }): [number, unknown] {
  if (result.ok === true) return [200, result]
  return [STATUS[result.code] ?? 500, result]
}

const isString = (value: any): boolean => typeof value === 'string'
const sessionOf = (body: any): unknown => (body !== null && typeof body === 'object' ? body.sessionId : undefined)
const tripleOf = (body: any): unknown =>
  body !== null && typeof body === 'object' ? [body.sessionId, body.kind, body.value] : undefined
const isTriple = (value: any): boolean => Array.isArray(value) && value.every(isString)
const pairOf = (body: any): unknown =>
  body !== null && typeof body === 'object' ? [body.sessionId, body.id] : undefined
const isPair = (value: any): boolean => Array.isArray(value) && value.every(isString)

export function createTaskMonitorRoutes({ store }: { store: TaskMonitorStore }): JsonRouteSpec[] {
  return [
    {
      path: TASK_MONITOR_SNAPSHOT_PATH,
      limit: LIMIT,
      pick: sessionOf,
      check: isString,
      reason: 'sessionId 必须是字符串',
      run: async (_ctx: any, sessionId: string) => reply(await store.snapshot(sessionId)),
    },
    {
      path: TASK_MONITOR_SOURCE_ADD_PATH,
      limit: LIMIT,
      pick: tripleOf,
      check: isTriple,
      reason: 'sessionId、kind、value 必须是字符串',
      run: async (_ctx: any, value: [string, string, string]) => reply(await store.addSource(value[0], value[1], value[2])),
    },
    {
      path: TASK_MONITOR_SOURCE_REMOVE_PATH,
      limit: LIMIT,
      pick: pairOf,
      check: isPair,
      reason: 'sessionId 与 id 必须是字符串',
      run: async (_ctx: any, value: [string, string]) => reply(await store.removeSource(value[0], value[1])),
    },
  ]
}