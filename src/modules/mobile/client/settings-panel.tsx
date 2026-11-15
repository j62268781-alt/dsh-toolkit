/**
 * 「移动端」设置面板。
 *
 * 三块内容：
 *   1. 页头（和其余面板共用 settings-parts 的 PageHeader）；
 *   2. 下载卡：整张 dsh-go 横幅 + 标题行右侧的发布页入口；
 *   3. 开关卡组：手机远程入口（ds-harness-remote 的 host.authorization）
 *      与微信 ClawBot（本仓库 remote 模块的偏好文件 + 桥上启停）。
 *
 * 为什么手机入口走控制 RPC 而不是本地偏好：那台设备「要不要被远程控制」是
 * ds-harness-remote 自己的授权状态，关掉它会真的 clearHostAuthorization()，
 * 已配对的手机立刻连不上；本地再存一份只会两边打架。
 */

import { fetchJson } from '../../../client/http.js'
import { CardSection, PageHeader, Row } from '../../../client/ui/components/settings-parts/index.jsx'
import { Tag } from '../../../client/ui/components/tag/index.jsx'
import { API_PREFIX } from '../../remote/host/constants.js'
import panelCss from './settings-panel.css'
import heroUrl from './assets/hero.webp'

/** 与 ds-harness-remote 的本地控制路由前缀一致（见 remote/client/mobile/pairing.ts）。 */
const CONTROL_PREFIX = '/ds-harness-remote'

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

async function readFeatures(): Promise<Features> {
  let phone = false
  let wechat = false
  let wechatRunning = false
  try {
    const status = await control('status')
    phone = status?.host?.authorized === true
  } catch {
    // 控制通道没就绪时不阻塞另一个开关的展示。
  }
  try {
    const response = await fetchJson(`${API_PREFIX}/preferences`)
    const payload: any = await response.json()
    wechat = payload?.wechat === true
    wechatRunning = payload?.running === true
  } catch {
    // 同上。
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
    const [features, setFeatures] = React.useState({ phone: false, wechat: false, wechatRunning: false })
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
     * 先让开关跟手再发请求：切开关是一次明确的意图，等 RPC 回来才动会显得「卡一下」。
     * 失败就退回原值，并把原因写在这一行下面。
     */
    const apply = React.useCallback(async (key: 'phone' | 'wechat', next: boolean, current: boolean) => {
      mark(key, true)
      setError(null)
      patch(key, next)
      try {
        if (key === 'phone') {
          await control('host.authorization.set', { enabled: next })
        } else {
          const response = await fetchJson(`${API_PREFIX}/preferences`, { method: 'POST', json: { wechat: next } })
          const payload: any = await response.json()
          if (typeof payload?.error === 'string' && payload.error !== '') {
            patch(key, current)
            setError(payload.error)
          } else {
            setFeatures((prev: any) => ({ ...prev, wechatRunning: payload?.running === true }))
          }
        }
      } catch (failure: any) {
        patch(key, current)
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
            description="打开后可以用手机查看进度、处理审批并追加指令；关闭会撤销本机授权，已配对的手机也连不上。"
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
