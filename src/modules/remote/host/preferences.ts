/**
 * 「移动端」面板的偏好：哪些入口是开着的。
 *
 * 为什么单独落文件而不是写 profile 的 cordis 配置：那些配置是插件加载期读的，
 * 改完要重启 DSH 才生效；面板里的开关必须点完立刻管用，所以状态存在
 * `$DSH_HOME/toolkit/remote-preferences.json`，由本模块在进程内即时应用。
 *
 * 两个开关都是本插件自己的功能位，不是上游的授权状态：
 *   · `phone` 决定侧栏「远程连接」里的「手机连接」还能不能用。上游的
 *     `host.authorized` 说的是「这台机器被哪台手机授权了」，是另一回事 —— 拿它当开关，
 *     在只接受扫码配对的机器上「打开」必然被拒（DEVICE_SCOPE_REQUIRED），
 *     开关点完只会弹回去，看起来就是没反应。关闭时才走一次解绑：撤销授权 + 忘掉本地快照。
 *   · `wechat` 决定 ClawBot 桥接跑不跑，由 apply() 直接启停。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface RemotePreferences {
  /** 侧栏「远程连接」里的「手机连接」是否可用。 */
  phone: boolean
  /** 微信 ClawBot 桥接是否运行。 */
  wechat: boolean
}

export interface PreferenceTarget {
  /** 偏好文件绝对路径。 */
  path: string
  /** 文件不存在时的取值（来自插件配置）。 */
  fallback: RemotePreferences
}

const EMPTY: RemotePreferences = { phone: true, wechat: false }

function normalize(value: any, fallback: RemotePreferences): RemotePreferences {
  if (value === null || typeof value !== 'object') return { ...fallback }
  return {
    phone: typeof value.phone === 'boolean' ? value.phone : fallback.phone,
    wechat: typeof value.wechat === 'boolean' ? value.wechat : fallback.wechat,
  }
}

/**
 * 同步版本：只在插件加载期用一次。
 *
 * 插件装配顺序里有一步必须「拿到初值再决定起不起微信桥接」，而 cordis 不会等
 * `ctx.effect` 里的异步回调（实测 `await fiber` 之后异步 effect 还没跑完），
 * 于是路由先注册好、服务却还没起来，面板上就闪一下「已关闭」。这里同步读一个
 * 只有几十字节的 JSON，换掉那个竞态。
 */
export function readPreferencesSync(target: PreferenceTarget): RemotePreferences {
  try {
    return normalize(JSON.parse(readFileSync(target.path, 'utf8')), target.fallback)
  } catch {
    return { ...target.fallback }
  }
}

/** 读偏好；文件不存在或坏掉都退回配置里的默认值，不让面板因此失败。 */
export async function readPreferences(target: PreferenceTarget): Promise<RemotePreferences> {
  try {
    const raw = await readFile(target.path, 'utf8')
    return normalize(JSON.parse(raw), target.fallback)
  } catch {
    return { ...target.fallback }
  }
}

/**
 * 写偏好。先写临时文件再 rename：面板可能连点两下开关，
 * 半截文件会让下一次读取把两个开关都当成默认值。
 */
export async function writePreferences(target: PreferenceTarget, next: RemotePreferences): Promise<RemotePreferences> {
  const value = normalize(next, target.fallback)
  await mkdir(dirname(target.path), { recursive: true })
  const temp = `${target.path}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, target.path)
  return value
}

/**
 * 配置里的默认值：没写过偏好文件时，跟插件配置保持一致。
 *
 * `phone` 默认开着：它只是「菜单里给不给这个入口」，跟上游授权无关；
 * 老版本没有这个字段的偏好文件读出来也是开，行为跟以前一致。
 */
export function defaultPreferences(enabled: boolean): RemotePreferences {
  return { ...EMPTY, wechat: enabled }
}
