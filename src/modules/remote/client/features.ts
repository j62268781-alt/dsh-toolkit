/**
 * 「移动端」面板里的两个开关，对侧栏入口的影响。
 *
 * 两个开关都是我们自己的功能位（remote/host/preferences.ts）：面板写、这里读，
 * 入口按它决定出不出图标、露出哪个 tab —— 用户要求「功能开了才在菜单里显示」。
 *
 * 手机入口读的不是 ds-harness-remote 的 `host.authorized`：那位表示「这台机器被哪台手机
 * 授权了」，是上游的连接状态，不是开关。混用会让开关点了没反应 —— 只接受扫码配对的机器上
 * 打开授权必然被拒（DEVICE_SCOPE_REQUIRED），面板于是只能弹回原样。
 *
 * 未读到之前当作「都开着」：先亮再收比先藏再弹更不容易让人以为功能坏了。
 */

import { fetchJson } from '../../../client/http.js'
import { API_PATH } from '../host/constants.js'

const POLL_MS = 4000

export interface RemoteFeatures {
  phone: boolean
  wechat: boolean
}

async function readSwitches(): Promise<RemoteFeatures | undefined> {
  try {
    const response = await fetchJson(`${API_PATH}/preferences`)
    const payload: any = await response.json()
    // 宿主版本比面板旧时没有 phone 字段：当作开着，别把入口藏起来。
    return { phone: payload?.phone !== false, wechat: payload?.wechat === true }
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
    const switches = await readSwitches()
    const next: RemoteFeatures = {
      phone: switches?.phone ?? value.phone,
      wechat: switches?.wechat ?? value.wechat,
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
