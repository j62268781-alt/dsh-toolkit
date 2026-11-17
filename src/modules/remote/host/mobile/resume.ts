/**
 * 启动期：把「已经配对过、但这次开机没连上」的手机连接接回来。
 *
 * 为什么需要它：上游只在自己 start() 里（且 `hostControl.enabled !== false`）拉起
 * server ws；而扫码配对的主机（`pairing-host-only.json` = `{"hostOnly":true}`）走的是
 * 「配对成功回调里 reconnect」这一条路，配对那一刻之后进程再重启，就没有任何人去连了。
 * 面板（popup）帮不上忙：它调用的 `host.pairing.status` / `settings.get` / `status`
 * 全是只读的，一个都不会启动 ws——所以「打开面板才连上」只是错觉，真相是这台机器
 * 重启后一直没人发起连接。
 *
 * 还有一层原因：`hostControl.enabled` 一旦变成 false，上游 `start()` 就再也不启动 ws，
 * 而把它改回 true 需要本机 client 凭据——只接受扫码配对的机器永远拿不到（见
 * `src/modules/mobile/client/settings-panel.tsx` 里关于「开关会变成一次性」的记录）。
 * 结果是本机明明绑定过手机，却永远不上线。所以这里**不看这个开关**：判定依据是本地那份
 * 配对快照（trusted-peers / pairing-host-only），也就是用户自己扫码授权过的设备；
 * 那个字段是上游给账号态记账用的，不该成为本机被控连接的唯一闸门。
 *
 * 这里只做一件事：读一眼本地配对快照，确认「这台机器确实绑定过手机」且当前不在线，
 * 就调一次 `reconnectHost()`（上游 `HostServerConnection.reconnect()` 在未运行时
 * 等价于 `start()`）。不写配置、不改 `hostControl` 字段、不碰凭据。
 */

import { dshHome } from '../../../../host/dsh-home.js'
import { readPairingHostOnly } from './local-state.js'
import { readTrustedPeers } from './peers.js'

/**
 * 检查节奏（毫秒）：上游 start() 要先加载身份、再建 serverConnection，
 * 第一次看太早只会看到「连接对象还没建出来」。
 */
const DEFAULT_DELAYS_MS = [1_500, 3_000, 7_000, 15_000]

/** 一轮启动最多主动 reconnect 两次：再多只会跟上游自己的退避重连打架。 */
const DEFAULT_MAX_CONNECTS = 2

/** 上游还没走到「建 serverConnection」那一步时 reconnectHost() 抛的稳定业务码。 */
const NOT_READY_CODE = 'SERVER_NOT_CONFIGURED'

export type ResumeOutcome =
  | 'online'
  | 'connected'
  | 'not-configured'
  | 'no-binding'
  | 'offline'
  | 'gave-up'
  | 'error'
  | 'disposed'

export interface StartupResumeOptions {
  /** 上游 host 运行时（宿主服务 `dshRemote`）：至少要 hostStatus() / reconnectHost()。 */
  service: any
  /** 「本机绑定过手机」的判据；默认读 $DSH_HOME 下的配对快照。 */
  hasBinding?: () => boolean | Promise<boolean>
  log?: (level: 'info' | 'warn', message: string) => void
  delays?: readonly number[]
  maxConnects?: number
  /** 注入用：测试里换成即时返回，免得等真定时器。 */
  wait?: (ms: number) => Promise<void>
}

export interface StartupResume {
  begin: () => void
  run: () => Promise<ResumeOutcome>
  dispose: () => void
}

/**
 * 「这次开机该不该主动连一次」的纯决策。
 *
 * 单独拎出来是为了能脱离运行时单测：它只看两样东西——本地有没有绑定痕迹、
 * 上游此刻的状态。`authorized` 故意不参与判断：扫码配对的主机本身没有账号授权
 * （`authorization === undefined`），拿它当门槛会把最该连的那台机器挡在外面。
 */
export function decideStartupResume(status: any, hasBinding: boolean) {
  if (hasBinding !== true) return { action: 'skip', reason: 'no-binding' } as const
  if (status?.online === true) return { action: 'skip', reason: 'online' } as const
  if (status?.configured !== true) return { action: 'skip', reason: 'not-configured' } as const
  return { action: 'connect' } as const
}

/**
 * 本机是否「绑定过手机」。
 *
 * 两个来源都只看文件：`pairing-host-only.json`（本机只被控）与 `trusted-peers.json`
 * （配对过的手机清单）。serverUrl 取上游运行时自己的配置——面板写进 patch 的那个值，
 * 因为 scope 目录名是它的 sha256 前 24 位，换服务地址就等于换目录。
 */
export async function hasLocalBinding({ service, homeDir = dshHome() }: {
  service: any
  homeDir?: string
}) {
  const serverUrl = typeof service?.config?.serverUrl === 'string' ? service.config.serverUrl.trim() : ''
  // 没配服务地址就没有配对这回事（上游也是这么判的：serverApi === undefined）。
  if (serverUrl === '') return false
  try {
    if (await readPairingHostOnly({ serverUrl, homeDir }) === true) return true
    const { peers } = await readTrustedPeers({ serverUrl, homeDir })
    return peers.length > 0
  } catch {
    // 地址非法、读盘失败都当成「没有证据」：宁可不连，也不要在开机时瞎发请求。
    return false
  }
}

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 启动期恢复器。
 *
 * `begin()` 是幂等的（重复调用只有一份在跑）；`dispose()` 之后正在等待的那一拍
 * 会立刻收尾，不再发任何请求——插件可能在连接完成前就被卸载。
 */
export function createStartupResume(options: StartupResumeOptions): StartupResume {
  const {
    service,
    hasBinding = () => hasLocalBinding({ service }),
    log = () => {},
    delays = DEFAULT_DELAYS_MS,
    maxConnects = DEFAULT_MAX_CONNECTS,
    wait = defaultWait,
  } = options

  let disposed = false
  let running: Promise<ResumeOutcome> | undefined
  let connects = 0

  function status() {
    if (typeof service?.hostStatus !== 'function') return undefined
    try {
      return service.hostStatus()
    } catch {
      return undefined
    }
  }

  async function binding() {
    try {
      return (await hasBinding()) === true
    } catch {
      return false
    }
  }

  /** 最后一次看结果：连上了就报「已恢复」，没连上就把上游的错误码带进日志。 */
  function settle(): ResumeOutcome {
    const final = status()
    if (final?.online === true) return connects > 0 ? 'connected' : 'online'
    const reason = typeof final?.error === 'string' && final.error !== '' ? `：${final.error}` : ''
    log('warn', `[remote] 启动时未能恢复手机连接${reason}`)
    return connects > 0 ? 'gave-up' : 'offline'
  }

  async function attempt(): Promise<ResumeOutcome> {
    // 绑定与否只查一次：一盘启动里那些文件不会自己变。
    let bound: boolean | undefined
    for (const delay of delays) {
      await wait(delay)
      if (disposed) return 'disposed'

      const current = status()
      if (current === undefined) {
        log('warn', '[remote] 上游 host 运行时不可用，跳过启动期连接检查')
        return 'error'
      }

      if (bound === undefined) bound = await binding()
      if (disposed) return 'disposed'
      const decision = decideStartupResume(current, bound === true)
      if (decision.action === 'skip') {
        if (decision.reason === 'online') {
          if (connects > 0) return 'connected'
          log('info', '[remote] 手机连接已在线上，启动期无需干预')
          return 'online'
        }
        if (decision.reason === 'no-binding') {
          log('info', '[remote] 本机没有配对过手机，启动期不主动连接')
          return 'no-binding'
        }
        return 'not-configured'
      }
      if (connects >= maxConnects) break

      // 这个开关关着的时候，上游自己永远不会连着；把它说出来，否则「为什么又能连上」查不清。
      if (connects === 0 && service?.config?.hostControl?.enabled === false) {
        log('warn', '[remote] 上游 hostControl 处于关闭状态，已按本地配对快照直接接回手机连接')
      }

      try {
        await service.reconnectHost()
        connects += 1
        log('info', '[remote] 已按本地配对快照发起手机连接')
      } catch (error: any) {
        if (error?.code === NOT_READY_CODE) continue
        log('warn', `[remote] 发起手机连接失败：${String(error?.message ?? error)}`)
        return 'error'
      }
    }
    // 最后一拍刚发过 reconnect，给它一点握手时间再定论。
    if (connects > 0 && !disposed) await wait(delays[delays.length - 1] ?? 0)
    if (disposed) return 'disposed'
    return settle()
  }

  return {
    begin() {
      if (disposed || running !== undefined) return
      running = attempt().catch((error: any): ResumeOutcome => {
        log('warn', `[remote] 启动期连接检查异常：${String(error?.message ?? error)}`)
        return 'error'
      })
    },
    run() {
      running ??= attempt()
      return running
    },
    dispose() {
      disposed = true
    },
  }
}
