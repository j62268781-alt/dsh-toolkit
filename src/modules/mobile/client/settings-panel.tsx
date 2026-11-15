/**
 * 「移动端」设置面板。
 *
 * 三块内容：
 *   1. 页头（和其余面板共用 settings-parts 的 PageHeader）；
 *   2. 下载卡：整张 dsh-go 横幅 + 标题行右侧的发布页入口；
 *   3. 开关卡组：手机远程入口 + 微信 ClawBot。
 *
 * 两个开关都是本插件自己的功能位，存在 `$DSH_HOME/toolkit/remote-preferences.json`
 * （见 remote/host/preferences.ts）。手机入口关掉时会顺带解绑：撤销本机授权、忘掉本地快照，
 * 让「已配对」这件事真的作废，而不是只把菜单藏起来。
 *
 * 为什么不直接调上游的 `host.authorization.set`：那位是「这台机器被哪台手机授权了」，
 * 只接受扫码配对的机器上打开它必然被拒（DEVICE_SCOPE_REQUIRED），开关点完只会弹回去。
 * 开关要控的是「这个入口开不开」，所以走我们自己的位；配对本身由「远程连接」弹窗里的二维码做。
 */

import { fetchJson } from '../../../client/http.js'
import { CardSection, PageHeader, Row } from '../../../client/ui/components/settings-parts/index.jsx'
import { Tag } from '../../../client/ui/components/tag/index.jsx'
import { API_PREFIX } from '../../remote/host/constants.js'
import panelCss from './settings-panel.css'
import heroUrl from './assets/hero.webp'

/** 与 ds-harness-remote 的本地控制路由前缀一致（见 remote/client/mobile/pairing.ts）。 */
const CONTROL_PREFIX = '/ds-harness-remote'

/** 「最近配对」快照的存储键，与 remote/client/mobile/pairing.ts 的 LAST_PAIRED_KEY 一致。 */
const LAST_PAIRED_KEY = 'dsh-toolkit-remote/last-paired.v1'

/** dsh-go 的发布页：面板里的「下载」都跳这里。 */
const DOWNLOAD_URL = 'https://github.com/ccch1mneyyy/dsh-Go/releases'

interface Features {
  phone: boolean
  wechat: boolean
  wechatRunning: boolean
}

function newRpcId() {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
  return `rpc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 发一条 ds-harness-remote 控制 RPC；成功返回 `result.value`。 */
async function control(endpoint: string, payload: Record<string, unknown> = {}): Promise<any> {
  const response = await fetch(`${CONTROL_PREFIX}/${endpoint}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: newRpcId(), method: endpoint, payload }),
  })
  if (response.status === 404) throw new Error('远程通道没装上（ds-harness-remote 未加载）')
  if (!response.ok) throw new Error(`远程通道返回 HTTP ${response.status}`)
  const body = await response.json().catch(() => null)
  const result = body?.result
  if (result?.ok === true) return result.value
  const message = typeof result?.error?.message === 'string' ? result.error.message : '远程通道拒绝了这次操作'
  throw new Error(message)
}

/**
 * 写一位开关。
 *
 * 两种失败要分开：HTTP 本身没成 → 功能位没落地，开关要退回原值；
 * 宿主回 `error` 说明偏好已写进去、只是微信桥接没起来 → 开关留在原位，只报那一句。
 */
async function writeSwitch(patch: { phone?: boolean; wechat?: boolean }): Promise<any> {
  const response = await fetchJson(`${API_PREFIX}/preferences`, { method: 'POST', json: patch })
  const payload: any = await response.json().catch(() => ({}))
  if (!response.ok) {
    const reason = typeof payload?.reason === 'string' && payload.reason !== '' ? payload.reason : '宿主没有回应'
    throw new Error(`开关没写成（HTTP ${response.status}）：${reason}`)
  }
  if (typeof payload?.error === 'string' && payload.error !== '') {
    const failure: any = new Error(payload.error)
    failure.persisted = true
    throw failure
  }
  return payload
}

/** 删掉本机的配对快照：关掉入口等于「忘掉这台手机」，不能留一张作废的配对卡。 */
function forgetLastPaired() {
  try {
    globalThis.localStorage?.removeItem(LAST_PAIRED_KEY)
  } catch {
    // 隐私模式下 localStorage 会抛：清不掉最多是弹窗里多一张旧卡，不该因此关不掉功能。
  }
}

/** 让宿主删掉解绑后残留的本机状态（pairing-host-only.json 等，见 remote/host/mobile/local-state.ts）。 */
async function purgeLocalState(serverUrl: string) {
  if (serverUrl === '') return
  try {
    await fetch(`${API_PREFIX}/local-state/purge?serverUrl=${encodeURIComponent(serverUrl)}`, {
      method: 'POST',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    })
  } catch {
    // 老版本宿主没有这条路由：解绑已经生效，残留清理是加分项。
  }
}

/**
 * 关闭手机入口时的解绑：撤销本机授权（手机那边立刻连不上）+ 忘掉本地配对快照 + 清残留。
 *
 * 走 `settings.logout` 而不是 `host.authorization.set{enabled:false}`：后者会顺手把
 * `hostControl.enabled` 写成 false，再想打开就要求本机的 client 凭据 —— 只接受扫码配对的
 * 机器上永远拿不到，开关会变成一次性的。logout 只清凭据与身份，配对新码随时还能开。
 */
async function unbindPhone(): Promise<void> {
  let serverUrl = ''
  try {
    // logout 的响应就是 settingsView，顺手拿 serverUrl 定位要清的目录，省一次 settings.get。
    const view = await control('settings.logout')
    serverUrl = typeof view?.config?.serverUrl === 'string' ? view.config.serverUrl : ''
  } catch {
    // 凭据本来就不在了（旧 token 失效）时 logout 会报错；本地清理照做。
    try {
      const view = await control('settings.get')
      serverUrl = typeof view?.config?.serverUrl === 'string' ? view.config.serverUrl : ''
    } catch {
      // 连设置都读不到就只做本地清理。
    }
  }
  forgetLastPaired()
  await purgeLocalState(serverUrl)
}

async function readFeatures(): Promise<Features> {
  let phone = true
  let wechat = false
  let wechatRunning = false
  try {
    const response = await fetchJson(`${API_PREFIX}/preferences`)
    const payload: any = await response.json()
    // 读成 true：拿不到状态时先亮着，别让入口莫名消失。
    phone = payload?.phone !== false
    wechat = payload?.wechat === true
    wechatRunning = payload?.running === true
  } catch {
    // 宿主路由没就绪时按默认值展示，开关会在 ready 之后再读一次。
  }
  return { phone, wechat, wechatRunning }
}

export interface MobileSettingsDeps {
  primitives: any
}

export function createMobileSettings(React: any, deps: MobileSettingsDeps) {
  const h = React.createElement
  const Switch: any = deps.primitives?.Switch

  /** 有宿主开关就用宿主的，没有就退回同语义的 button（测试/降级环境）。 */
  function Toggle(props: { checked: boolean; disabled?: boolean; label: string; onChange: (next: boolean) => void }) {
    if (typeof Switch === 'function') {
      return h(Switch, {
        checked: props.checked,
        disabled: props.disabled === true,
        label: props.label,
        onChange: (next: any) => props.onChange(next === true),
      })
    }
    return h('button', {
      type: 'button',
      role: 'switch',
      className: 'mbm-switch',
      'data-on': props.checked ? 'true' : 'false',
      'aria-checked': props.checked,
      'aria-label': props.label,
      disabled: props.disabled === true,
      onClick: () => props.onChange(!props.checked),
    }, h('span', { className: 'mbm-switchKnob' }))
  }

  return function MobileSettings() {
    const [features, setFeatures] = React.useState({
      phone: true,
      wechat: false,
      wechatRunning: false,
    })
    const [ready, setReady] = React.useState(false)
    // 每个开关各自忙：一个在等回执时另一个还能点，也不会把整页一起刷一遍。
    const [pending, setPending] = React.useState({ phone: false, wechat: false })
    const [error, setError] = React.useState(null)

    React.useEffect(() => {
      let alive = true
      void readFeatures().then((next) => {
        if (!alive) return
        setFeatures(next)
        setReady(true)
      })
      return () => {
        alive = false
      }
    }, [])

    const patch = React.useCallback((key: 'phone' | 'wechat', next: boolean) => {
      setFeatures((prev: any) => ({ ...prev, [key]: next }))
    }, [])

    const mark = React.useCallback((key: 'phone' | 'wechat', next: boolean) => {
      setPending((prev: any) => ({ ...prev, [key]: next }))
    }, [])

    /**
     * 先让开关跟手再发请求：切开关是一次明确的意图，等回执回来才动会显得「卡一下」。
     *
     * 关手机入口是两步：写功能位（关掉菜单入口）→ 解绑（撤销授权、忘掉本地快照）。
     * 第二步失败不该把开关翻回开：功能位已经落地，这时候显示「开」反而更骗人；
     * 所以只有写功能位本身失败才退回原值。
     */
    const apply = React.useCallback(async (key: 'phone' | 'wechat', next: boolean, current: boolean) => {
      mark(key, true)
      setError(null)
      patch(key, next)
      let persisted = false
      try {
        const payload = await writeSwitch(key === 'phone' ? { phone: next } : { wechat: next })
        persisted = true
        if (key === 'wechat') {
          setFeatures((prev: any) => ({ ...prev, wechatRunning: payload?.running === true }))
        } else if (!next) {
          await unbindPhone()
        }
      } catch (failure: any) {
        if (!persisted) patch(key, current)
        setError(String(failure?.message ?? failure))
      } finally {
        mark(key, false)
      }
    }, [patch, mark])

    // 横幅走 data URL，重新创建 <img> 会让浏览器重新解码一次；渲染一次就固定下来，
    // 这样切换开关时不会因为整块子树重建而闪一下。
    const hero = React.useMemo(() => h(
      'div',
      { className: 'mbm-heroFrame' },
      h('img', {
        className: 'mbm-hero',
        src: heroUrl,
        alt: 'dsh-go：把 DeepSeek Harness 装进口袋，手机本机运行，也能遥控你的电脑',
        draggable: false,
      }),
    ), [])

    const enabled = features.phone || features.wechat
    return (
      <div className="mbm-settings">
        <style>{panelCss}</style>
        <PageHeader
          title="移动端"
          subtitle="随时用手机查看 Agent 进度、处理关键审批并追加指令，任务完成后直接预览并验收成果。"
        />
        <CardSection
          className="mbm-group"
          cardClassName="mbm-download"
          title="下载移动端"
          hint={(
            <a className="mbm-link" href={DOWNLOAD_URL} target="_blank" rel="noreferrer">下载</a>
          )}
          aria-label="下载移动端"
        >
          {hero}
        </CardSection>
        <CardSection
          className="mbm-group"
          title={(
            <span className="mbm-groupTitle">
              启用远程控制
              <Tag tone={enabled ? 'ok' : 'neutral'}>{enabled ? '已启用' : '已关闭'}</Tag>
            </span>
          )}
          aria-label="启用远程控制"
        >
          <Row
            title="允许手机控制此设备"
            description="打开后可以用手机查看进度、处理审批并追加指令；关闭会撤销本机授权并解绑当前手机，下次要用重新扫码即可。"
          >
            <Toggle
              checked={features.phone}
              disabled={!ready || pending.phone}
              label="允许手机控制此设备"
              onChange={(next: boolean) => void apply('phone', next, features.phone)}
            />
          </Row>
          <Row
            title="微信 ClawBot"
            description="把微信当作 DSH 的入口：手机端发消息、收结果。关闭后桥接停止，重新打开会接着用已登录的账号。"
          >
            <Toggle
              checked={features.wechat}
              disabled={!ready || pending.wechat}
              label="微信 ClawBot"
              onChange={(next: boolean) => void apply('wechat', next, features.wechat)}
            />
          </Row>
        </CardSection>
        {error === null ? null : <p className="mbm-error">{error}</p>}
      </div>
    )
  }
}
