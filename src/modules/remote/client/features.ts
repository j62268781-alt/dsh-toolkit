/**
 * 「移动端」面板里的两个开关，对侧栏入口的影响。
 *
 * 手机入口的状态在 ds-harness-remote（host.authorized）；微信开关在我们自己的
 * 偏好文件里（remote/host/preferences.ts）。面板写、这里读，入口按它决定
 * 出不出图标、露出哪个 tab —— 用户要求「功能开了才在菜单里显示」。
 *
 * 未读到之前当作「都开着」：先亮再收比先藏再弹更不容易让人以为功能坏了。
 */

import { fetchJson } from '../../../client/http.js'
import { API_PATH } from '../host/constants.js'

const CONTROL_PREFIX = '/ds-harness-remote'
const POLL_MS = 4000

export interface RemoteFeatures {
  phone: boolean
  wechat: boolean
}

function newRpcId() {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  return `rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function phoneEnabled(): Promise<boolean | undefined> {
  try {
    const response = await fetch(`${CONTROL_PREFIX}/status`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: newRpcId(), method: 'status', payload: {} }),
    })
    if (!response.ok) return undefined
    const body = await response.json().catch(() => null)
    const result = body?.result
    if (result?.ok !== true) return undefined
    return result.value?.host?.authorized === true
  } catch {
    return undefined
  }
}

async function wechatEnabled(): Promise<boolean | undefined> {
  try {
    const response = await fetchJson(`${API_PATH}/preferences`)
    const payload: any = await response.json()
    return payload?.wechat === true
  } catch {
    return undefined
  }
}

export function createFeatures() {
  let value: RemoteFeatures = { phone: true, wechat: true }
  const listeners = new Set<() => void>()

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // 单个订阅者出错不影响其他订阅者。
      }
    }
  }

  const refresh = async () => {
    const [phone, wechat] = await Promise.all([phoneEnabled(), wechatEnabled()])
    const next: RemoteFeatures = {
      phone: phone ?? value.phone,
      wechat: wechat ?? value.wechat,
    }
    if (next.phone === value.phone && next.wechat === value.wechat) return
    value = next
    emit()
  }

  let timer: any
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return value
    },
    refresh,
    /** 首次读一次，之后按间隔轮询（页面隐藏时跳过）。 */
    start() {
      void refresh()
      timer = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        void refresh()
      }, POLL_MS)
      // 浏览器里 setInterval 返回 number，没有 unref；Node（构建期测试在 vm 里跑产物）
      // 返回 Timeout，不 unref 的话测试进程会因为这条定时器永远不退出。
      if (typeof timer?.unref === 'function') timer.unref()
      return () => {
        clearInterval(timer)
      }
    },
    /** 面板改完开关后立刻同步一次，不等下一个轮询周期。 */
    invalidate() {
      void refresh()
    },
  }
}
