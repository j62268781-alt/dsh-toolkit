/**
 * Client half of the notification module.
 * Contract: docs/notification/README.md.
 *
 * 与 usage/mobile 同一套「工厂 + 全局 JSX」模式：主 bundle 的 jsxFactory 是
 * `__dshReact.createElement`，所以工厂里先 `globalThis.__dshReact = require('react')`，
 * 之后任何组件才会被渲染。
 *
 * 装配分三层（全部通过注入端口连接，便于单测）：
 *   1. `settings`     —— 配置表单（宿主 settings）→ 容错解码后的偏好；
 *   2. `engine`       —— 会话列表快照 / 待交互快照 → 分类出通知事件；
 *   3. `dispatcher`   —— 事件 + 偏好 → 提示音 + 系统通知（点击回到对应会话）。
 *
 * 会话观察只读既有服务：`ctx.sessions.list` 提供 running 边沿，`ctx.uiSession.sessionStatus`
 * 提供待交互与「完成未读」，`ctx.uiConversation` 提供最后一条 assistant 文本，
 * `ctx.uiWorkspace.openSession` 负责点击通知后的跳转。
 */
import css from './styles.css'
import { installStylesheet } from '../../../client/ui/stylesheet.js'
import { settingsStyles } from '../../../client/styles/settings.js'
import { findScopedForm } from '../../../client/config.js'
import { acceptConfigWrite } from '../../../client/config-write.js'
import { fetchJson } from '../../../client/http.js'
import { NOTIFICATION_NS, NOTIFICATION_COPY, createTranslator } from './locale.js'
import { CONFIG_NS, readSettings, safeSnapshot } from './model.js'
import { displayTitleOf, sessionDetailOf } from './detail.js'
import { NotificationEngine } from './engine.js'
import { NotificationDispatcher } from './dispatch.js'
import { SystemSoundPlayer, loadSystemSounds } from './system-sounds.js'
import {
  browserPermission, dismissLiveNotifications, requestBrowserPermission, showBrowserNotification,
  showTestNotification,
} from './browser-notify.js'
import { createRecentStore } from './recent.js'
import { createNotificationPanel } from './panel.jsx'
import { registerSettingsIcon } from '../../../client/settings-icon.jsx'

/** 宿主 locale 的语言提示（拿不到就用运行时默认 locale）。 */
function localeHint(ctx) {
  try {
    const language = ctx?.locale?.language
      ?? (typeof ctx?.locale?.getLanguage === 'function' ? ctx.locale.getLanguage() : undefined)
      ?? ctx?.locale?.lang
    return typeof language === 'string' && language !== '' ? language : undefined
  } catch {
    return undefined
  }
}

/** 统一的诊断输出：注册失败只 warn，不让一个可选环节拖垮整个客户端半。 */
function warn(message, error) {
  try {
    if (error === undefined) console.warn(`[dsh-toolkit:notification] ${message}`)
    else console.warn(`[dsh-toolkit:notification] ${message}`, error)
  } catch {
    // 忽略。
  }
}

/** host 侧的提窗路由（见 src/modules/notification/host/raise.js）。 */
const RAISE_URL = '/api/plugins/dsh-toolkit/notification/raise'

/**
 * 待交互快照 → 引擎需要的形状。
 * `approval` 归到「需要授权」，`question`/`plan-review` 归到「等待回答」；
 * 详情优先用问题正文，其次工具名/原因。
 * @param {Map<string, object>} statuses `uiSession.sessionStatus` 的快照。
 */
export function pendingFactsOf(statuses) {
  const facts = new Map()
  for (const [id, status] of statuses ?? []) {
    const interaction = status?.pendingInteraction
    if (interaction === undefined || interaction === null) continue
    const kind = interaction.kind === 'approval'
      ? 'permission'
      : (interaction.kind === 'question' || interaction.kind === 'plan-review' ? 'question' : undefined)
    if (kind === undefined) continue
    const key = typeof interaction.key === 'string' && interaction.key !== ''
      ? interaction.key
      : `${kind}:${id}`
    const questions = Array.isArray(interaction.questions) ? interaction.questions : []
    const first = questions[0]
    const questionText = typeof first?.question === 'string'
      ? first.question
      : (typeof first === 'string' ? first : '')
    const detail = questionText !== ''
      ? questionText
      : (interaction.displayReason ?? interaction.reason ?? interaction.toolName ?? '')
    facts.set(id, { key, kind, detail: String(detail) })
  }
  return facts
}

/**
 * 宿主是否会自己续跑这个会话（排队输入，或还没跑完的 goal 轮次）。
 * 那种情况下 running 变成 false 只是「暂停」，不是「结束」。
 * 投影形状随宿主版本变化，因此全部按结构读、读不到就当 false。
 * @param {object} snapshot `ctx.sessions.list` 快照。
 * @param {string} id 会话 id。
 */
export function hasUnfinishedWork(snapshot, id) {
  try {
    const values = snapshot?.projectionsBySession?.[id]?.values
    if (values === null || typeof values !== 'object') return false
    const inbox = values.inbox
    const pendingInput = (inbox?.['next-turn']?.length ?? 0) > 0 || (inbox?.['next-step']?.length ?? 0) > 0
    if (pendingInput) return true
    const goal = values.goal
    if (goal === null || typeof goal !== 'object' || goal.goal === null || typeof goal.goal !== 'object') return false
    // 到达轮次上限的 goal 驱动不会再续跑。
    return goal.goal.phase === 'active' && Number(goal.roundsStarted) < Number(goal.goal.maxGoalRounds)
  } catch {
    return false
  }
}

/**
 * 一个会话是否还有在跑的后代（子代理可能自己再派子代理，所以要递归）。
 * @param {object} snapshot `ctx.sessions.list` 快照。
 * @param {string} id 会话 id。
 */
export function hasRunningDescendants(snapshot, id) {
  try {
    const byId = snapshot?.byId ?? {}
    const seen = new Set([id])
    const queue = [id]
    while (queue.length > 0) {
      const parent = queue.shift()
      for (const summary of Object.values(byId)) {
        if (summary?.parentId !== parent || seen.has(summary.id)) continue
        seen.add(summary.id)
        if (summary.running === true) return true
        queue.push(summary.id)
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * 创建 notification 客户端子插件。
 * @param {(spec: string) => any} require 宿主的模块表 require。
 */
export default function createNotification(require) {
  const React = require('react')
  globalThis.__dshReact = React

  return {
    name: 'toolkit-notification-client',
    // `workspaces` 只用于点击通知时判断/取消归档；Cordis 的 ctx 是严格的，
    // 没在 inject 里声明的服务一读就抛错（真机上表现为点击通知只打一条 warn）。
    inject: ['slots', 'locale', 'configForms', 'sessions', 'uiSession', 'uiConversation', 'uiWorkspace', 'workspaces'],
    apply(ctx) {
      // 表单在注册时解析一次；缺失时页面只读展示（不抛错）。
      const { form, entryId } = findScopedForm(ctx, CONFIG_NS)
      const t = createTranslator(ctx, localeHint(ctx))
      const writable = () => typeof form?.set === 'function' && form?.writable !== false

      /* ── 偏好源：配置表单 → 容错解码 → 稳定的快照 ─────────────────────── */
      let settingsValue = readSettings(safeSnapshot(form))
      const settingsListeners = new Set()
      const refreshSettings = () => {
        settingsValue = readSettings(safeSnapshot(form))
        for (const listener of [...settingsListeners]) {
          try {
            listener()
          } catch {
            // 单个订阅者出错不影响其他订阅者。
          }
        }
      }
      const settingsSource = {
        getSnapshot: () => settingsValue,
        subscribe: (listener) => {
          if (typeof listener !== 'function') return () => {}
          settingsListeners.add(listener)
          return () => settingsListeners.delete(listener)
        },
      }

      const recent = createRecentStore()
      // 提醒只走系统通知（browser-notify.js）；应用内不再自己画一套卡片。
      const player = new SystemSoundPlayer(() => settingsSource.getSnapshot().volume)

      /* ── 会话事实读取：只在需要分类时碰快照，全程 try/catch ───────────── */
      const readDetail = (id) => {
        try {
          const binding = ctx.sessions?.binding?.(id)
          const session = binding?.session?.getSnapshot?.()
          let chat
          if (binding !== undefined && typeof ctx.uiConversation?.binding === 'function') {
            const conversation = ctx.uiConversation.binding(binding)
            // 未激活的 target 快照是 undefined；激活后才能读到 chat 节点。
            conversation?.activate?.('chat')
            chat = conversation?.target?.('chat')?.getSnapshot?.()
          }
          return sessionDetailOf(session, chat)
        } catch {
          // 世代切换中读绑定会抛错：降级为「没有对话快照」，失败判据仍可用。
          return undefined
        }
      }

      const titleOf = (id) => {
        try {
          return displayTitleOf(ctx.sessions?.list?.getSnapshot?.()?.byId?.[id], id, t)
        } catch {
          return t('untitled')
        }
      }

      /* ── 打开会话：聚焦窗口 → 导航 → 确认宿主真的切过去了 ───────────────── */
      /** 一个宏任务：宿主的选择是同步状态机，验证要等这一轮提交结束。 */
      const nextTask = () => new Promise((resolve) => { setTimeout(resolve, 0) })

      /** 先把应用窗口提到前台：macOS 上横幅点击常伴随「窗口已聚焦」的判定。 */
      const focusWindow = () => {
        try {
          if (typeof window !== 'undefined' && typeof window.focus === 'function') window.focus()
        } catch {
          // 浏览器可能拒绝聚焦；导航本身仍然值得一试。
        }
      }

      /**
       * 主视图是否真的持有该会话（引用数 > 0）。
       * 读不到 retainInfo（老宿主/降级宿主）时返回 undefined —— 无法验证就不该谎报失败。
       * @returns {boolean|undefined}
       */
      const mainViewRetains = (sessionId) => {
        try {
          const snapshot = ctx.sessions?.retainInfo?.(sessionId)?.getSnapshot?.()
          if (snapshot === undefined || snapshot === null) return undefined
          // 快照存在就说明宿主支持引用追踪：没有 mainView 计数即视为没有持有。
          const count = Number(snapshot?.retainedBy?.mainView ?? 0)
          return Number.isFinite(count) ? count > 0 : undefined
        } catch {
          return undefined
        }
      }

      /** 导航本身：归档会话先取消归档（否则列表刷新会把选择清掉），再打开会话。 */
      const navigate = async (sessionId) => {
        const archived = ctx.workspaces?.list?.getSnapshot?.()?.archivedSessionIds
        const isArchived = Array.isArray(archived) && archived.includes(sessionId)
        if (isArchived && typeof ctx.uiWorkspace?.unarchiveSession === 'function') {
          await ctx.uiWorkspace.unarchiveSession(sessionId)
        }
        await ctx.uiWorkspace?.openSession?.(sessionId)
      }

      /**
       * 关掉挡住主视图的宿主模态弹层（设置 / 外观等）。
       *
       * 点通知时如果设置面板正开着，会话是在弹层背后切的 —— 用户看到的仍是弹层，表现依旧是
       * 「点了没跳」。宿主的 modal 层只在打开期间监听 document 级 Escape，所以切完补一个 Escape。
       */
      const dismissBlockingModal = () => {
        try {
          const open = document.querySelector('[role="dialog"][aria-modal="true"]')
          if (open === null) return
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        } catch {
          // 老环境没有 KeyboardEvent 构造器：忽略，导航本身已经生效。
        }
      }

      /**
       * 把桌面端窗口提到前台。
       *
       * `window.focus()`（见 focusWindow）在 Windows 上会被前台锁忽略：只有当前持有前台权的
       * 进程才能把窗口抢到最前。桌面壳里唯一被系统允许的做法是「再启动一次本应用」，让主实例
       * 收到 second-instance 后自己 restore + show + focus。这条路由由 host 侧提供，
       * 原理见 src/modules/notification/host/raise.js。
       *
       * 失败（浏览器部署、host 没注册路由、路由返回 unsupported）时静默忽略——提窗只是锦上添花，
       * 会话本身已经切好了。
       */
      const raiseWindow = () => {
        void fetchJson(RAISE_URL, { method: 'POST' }).catch(() => undefined)
      }

      /**
       * 打开事件对应的会话。
       *
       * 点击通知不生效的常见原因是「导航被同帧内的其他选择覆盖」或「窗口没被真正提到前台」，
       * 所以这里：先聚焦窗口并请求提窗 → 导航 → 等一个宏任务 → 用主视图引用数确认；没生效就
       * 再试一次，仍失败只留一行诊断日志。整个过程不会再向调用方抛错。
       * @param {string} sessionId 目标会话。
       * @returns {Promise<{ok: boolean, error?: string}>} 是否切过去了。
       */
      const openSession = async (sessionId) => {
        if (typeof sessionId !== 'string' || sessionId === '') return { ok: false }
        focusWindow()
        // 提窗是异步的（新进程启动约 400ms），先发出去，下面同步导航，等窗口真的到前台时
        // 会话已经切好了。
        raiseWindow()
        const attempt = async () => {
          try {
            await navigate(sessionId)
            return true
          } catch (error) {
            warn(`could not open session ${sessionId}`, error)
            return false
          }
        }
        await attempt()
        await nextTask()
        let retained = mainViewRetains(sessionId)
        if (retained === false) {
          // 第一次导航被别的东西盖掉了：再试一次（仍不生效才算失败）。
          await attempt()
          await nextTask()
          retained = mainViewRetains(sessionId)
        }
        if (retained !== false) dismissBlockingModal()
        if (retained === false) {
          const message = t('navigateFailed')
          warn(`session ${sessionId} did not become the main view after retry`)
          return { ok: false, error: message }
        }
        return { ok: true }
      }

      const dispatcher = new NotificationDispatcher({
        settings: () => settingsSource.getSnapshot(),
        t,
        playSound: (sound, volume) => player.play(sound, volume),
        showNotification: ({ title, body, tag, kind, sessionId }) => showBrowserNotification({
          title,
          body,
          tag,
          kind,
          sessionId,
          onClick: () => openSession(sessionId),
        }),
        isCurrent: (sessionId) => {
          try {
            return (ctx.sessions?.retainInfo?.(sessionId)?.getSnapshot?.()?.retainedBy?.mainView ?? 0) > 0
          } catch {
            return false
          }
        },
        isHidden: () => {
          try {
            return typeof document !== 'undefined' && document.visibilityState === 'hidden'
          } catch {
            return false
          }
        },
        hasFocus: () => {
          try {
            return typeof document === 'undefined' || typeof document.hasFocus !== 'function'
              ? true
              : document.hasFocus()
          } catch {
            return true
          }
        },
        // 跨模块契约（只读）：pet 客户端在「灵动岛开启且桌面 helper 在跑」时把
        // `document.documentElement.dataset.dshIsland` 写成 'on'，其余情况移除。
        // 通知侧据此判断前台视觉提醒是否已经由灵动岛承担；读不到标记 = 没有灵动岛。
        islandActive: () => {
          try {
            return typeof document !== 'undefined'
              && document.documentElement?.dataset?.dshIsland === 'on'
          } catch {
            return false
          }
        },
      })

      const engine = new NotificationEngine({
        detailOf: readDetail,
        // 未打开过的会话没有对话快照：借一次临时引用把它物化，并在释放前读到事实。
        ensureDetail: async (id) => {
          const current = settingsSource.getSnapshot()
          if (current.enabled !== true) return undefined
          if (!Object.values(current.types ?? {}).some((type) => type.enabled === true)) return undefined
          if (typeof ctx.sessions?.using !== 'function') return undefined
          let captured
          try {
            await ctx.sessions.using(id, { source: 'controllerOperation' }, async () => {
              captured = readDetail(id)
            })
          } catch (error) {
            warn(`could not load session ${id} for notification text`, error)
          }
          return captured
        },
        titleOf,
        settle: () => new Promise((resolve) => setTimeout(resolve, 250)),
        isSubagent: (id) => {
          try {
            return ctx.sessions?.list?.getSnapshot?.()?.byId?.[id]?.origin === 'subagent'
          } catch {
            return false
          }
        },
        hasRunningDescendants: (id) => hasRunningDescendants(ctx.sessions?.list?.getSnapshot?.(), id),
        hasUnfinishedWork: (id) => hasUnfinishedWork(ctx.sessions?.list?.getSnapshot?.(), id),
        emit: (event) => {
          const result = dispatcher.dispatch(event)
          if (result.notified === true) {
            recent.add({ kind: event.kind, sessionId: event.sessionId, title: result.title, body: result.body })
          }
        },
      })
      engine.setScope(settingsSource.getSnapshot().scope)

      /* ── 生效范围：偏好变化时同步给引擎 ───────────────────────────────── */
      const syncScope = () => engine.setScope(settingsSource.getSnapshot().scope)

      /** 页面动作：写一个配置字段（缺失/只读时抛出可展示的错误）。 */
      const writeField = async (field, value) => {
        if (!writable()) throw new Error(t('readOnly'))
        await acceptConfigWrite(() => form.set(field, value), field)
        refreshSettings()
        return true
      }

      /**
       * 页面动作：按配置字段逐个写入。
       * 开关类字段直接写布尔；音量写 0..1 的数字。
       */
      const actions = {
        setEnabled: (value) => writeField('enabled', value === true),
        setSoundEnabled: (value) => writeField('soundEnabled', value === true),
        setVolume: (value) => writeField('volume', Math.min(1, Math.max(0, Number(value) || 0))),
        setCurrentMode: (value) => writeField('currentMode', String(value)),
        setScope: (value) => writeField('scope', String(value)),
        setKindEnabled: (kind, value) => writeField(`${kind}Enabled`, value === true),
        setKindSound: (kind, value) => writeField(`${kind}Sound`, String(value)),
        setSound: (value) => writeField('sound', String(value)),
        loadSounds: loadSystemSounds,
        previewSound: (sound) => player.preview(sound, settingsSource.getSnapshot().volume),
        testNotification: () => {
          const sent = showTestNotification(t)
          const current = settingsSource.getSnapshot()
          if (sent && current.soundEnabled && current.volume > 0) player.play(current.sound, current.volume)
          return sent
        },
        permission: () => browserPermission(),
        requestPermission: async () => {
          const permission = await requestBrowserPermission()
          if (permission === 'granted') refreshSettings()
          return permission
        },
        openSession,
        isWritable: writable,
      }

      const Panel = createNotificationPanel(React, {
        form,
        entryId,
        t,
        settings: settingsSource,
        recent,
        actions,
        // 官方 primitives 是 web-shell 的 seed，工厂里 require 一定拿得到；降级宿主则传 null。
        primitives: (() => {
          try {
            return require('@deepseek-ai/dsh-client-ui-primitives')
          } catch {
            return null
          }
        })(),
      })

      /* ── 注册：词典 / 样式 / 配置订阅 / 会客观测 / 设置页 ───────────────── */
      const install = (run, label) => {
        try {
          if (typeof ctx.effect === 'function') return ctx.effect(run, label)
          return run()
        } catch (error) {
          warn(`安装 ${label} 失败`, error)
          return undefined
        }
      }

      install(() => {
        try {
          return ctx.locale?.register?.(NOTIFICATION_NS, NOTIFICATION_COPY)
        } catch {
          return undefined
        }
      }, 'toolkit-notification:dictionary')

      // 样式挂在全局而不是设置页里：`.ntf-*` 同时服务于设置页与（此前的）浮层元素，
      // 而设置页在降级宿主里可能根本不挂载。
      install(() => {
        if (typeof document === 'undefined') return () => {}
        return installStylesheet(`${settingsStyles('ntf')}\n${css}`, 'toolkit-notification')
      }, 'toolkit-notification:stylesheet')

      install(() => {
        if (typeof form?.subscribe !== 'function') return undefined
        const off = form.subscribe(() => {
          refreshSettings()
          syncScope()
        })
        return () => {
          try {
            off?.()
          } catch {
            // 忽略。
          }
        }
      }, 'toolkit-notification:settings')

      install(() => {
        const list = ctx.sessions?.list
        if (typeof list?.subscribe !== 'function' || typeof list?.getSnapshot !== 'function') return undefined
        const off = list.subscribe(() => {
          try {
            engine.observe(list.getSnapshot())
          } catch (error) {
            warn('session observation failed', error)
          }
        })
        // 先建立基线：插件加载前就空闲的会话不该补发通知。
        try {
          engine.seed(list.getSnapshot())
        } catch (error) {
          warn('session baseline failed', error)
        }
        return off
      }, 'toolkit-notification:sessions')

      install(() => {
        const status = ctx.uiSession?.sessionStatus
        if (typeof status?.subscribe !== 'function' || typeof status?.getSnapshot !== 'function') return undefined
        const off = status.subscribe(() => {
          try {
            engine.observePending(pendingFactsOf(status.getSnapshot()))
          } catch (error) {
            warn('pending interaction observation failed', error)
          }
        })
        try {
          // 只建基线：插件加载前就在等回答的交互不补发提醒。
          engine.seedPending(pendingFactsOf(status.getSnapshot()))
        } catch {
          // 初始快照读失败不影响后续订阅。
        }
        return off
      }, 'toolkit-notification:pending')

      install(() => () => player.dispose(), 'toolkit-notification:sounds')

      // 回到前台就收回提醒：系统横幅原本是用来「叫人回来」的，人已经在看了还挂着只会挡视线。
      // 只关「用户此刻确实看得到」的那条——主视图持有的会话，或者窗口整体回到前台时的全部。
      install(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
        const currentSessionId = () => {
          try {
            const byId = ctx.sessions?.list?.getSnapshot?.()?.byId ?? {}
            for (const id of Object.keys(byId)) {
              if (mainViewRetains(id) === true) return id
            }
          } catch {
            // 读不到就当作没有「当前会话」。
          }
          return undefined
        }
        const foregrounded = () => {
          try {
            return document.visibilityState !== 'hidden' && document.hasFocus() === true
          } catch {
            return false
          }
        }
        const dismissVisible = () => {
          if (!foregrounded()) return
          const visible = currentSessionId()
          try {
            // 没有可见会话就说明用户回到的是一个空视图：把剩下的提醒一起收掉。
            dismissLiveNotifications(
              visible === undefined ? () => true : (entry) => entry.sessionId === visible,
            )
          } catch (error) {
            warn('could not dismiss notifications', error)
          }
        }
        document.addEventListener('visibilitychange', dismissVisible)
        window.addEventListener('focus', dismissVisible)
        return () => {
          document.removeEventListener('visibilitychange', dismissVisible)
          window.removeEventListener('focus', dismissVisible)
        }
      }, 'toolkit-notification:dismiss-visible')

      install(() => {
        if (typeof ctx.slots?.inject !== 'function' || typeof ctx.slots?.register !== 'function') return undefined
        return ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'notification', // 接在 usage-tokens(23) 之后
          order: 24,
          label: () => t('nav'),
          locale: NOTIFICATION_NS,
        }, Panel))
      }, 'toolkit-notification:section')

      install(
        () => registerSettingsIcon(ctx, 'notification', 'bell'),
        'toolkit-notification:settings-icon',
      )
    },
  }
}
