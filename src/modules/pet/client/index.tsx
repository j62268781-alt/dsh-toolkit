import { findScopedForm } from '../../../client/config.js'
import { acceptConfigWrite } from '../../../client/config-write.js'
import { installStylesheet } from '../../../client/ui/stylesheet.js'
import { paginationCss } from '../../../client/ui/components/pagination/index.jsx'
import { resizableDialogCss } from '../../../client/ui/components/resizable-dialog/index.jsx'
import { createPetConnection } from './connection.js'
import { CONFIG_NS, formSnapshot, readSettings } from './model.js'
import { createTranslator, PET_COPY, PET_NS } from './locale.js'
import { createPetPanel } from './panel.jsx'
import { registerSettingsIcon } from '../../../client/ui/components/settings-icon/index.jsx'
import css from './style.css'

export default function createPet(require) {
  const React = require('react')
  globalThis.__dshReact = React
  return {
    name: 'toolkit-pet-client',
    inject: ['slots', 'locale', 'configForms', 'uiWorkspace', 'workspaces', 'sessions'],
    apply(ctx) {
      const { form } = findScopedForm(ctx, CONFIG_NS)
      const t = createTranslator(ctx)
      const warn = (error) => console.warn('[toolkit-pet]', error)
      const listeners = new Set()
      let value = readSettings(formSnapshot(form))
      const refresh = () => { value = readSettings(form ? formSnapshot(form) : connection.getSnapshot().settings); for (const listener of [...listeners]) listener() }
      const settings = { getSnapshot: () => value, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } }
      const connection = createPetConnection({
        onNavigation: async (sessionId, disposed) => {
          const archived = ctx.workspaces?.list?.getSnapshot?.()?.archivedSessionIds
          if (Array.isArray(archived) && archived.includes(sessionId)) await ctx.uiWorkspace?.unarchiveSession?.(sessionId)
          if (!disposed()) await ctx.uiWorkspace?.openSession?.(sessionId)
        },
        onNavigationError: warn,
      })
      const actions = {
        isWritable: () => typeof form?.set === 'function' && form.writable !== false,
        async write(field, next) {
          if (!actions.isWritable()) throw new Error(t('readOnly'))
          await acceptConfigWrite(() => form.set(field, next), field)
          refresh()
        },
      }
      const primitives = (() => {
        try { return require('@deepseek-ai/dsh-client-ui-primitives') } catch { return null }
      })()
      const Panel = createPetPanel(React, { t, settings, connection, actions, primitives })
      ctx.effect(() => ctx.locale?.register?.(PET_NS, PET_COPY), 'toolkit-pet:dictionary')
      // Panel-local CSS injected globally: every selector is a `.pet-*` class under the settings
      // panel, so an inline <style> would work too — kept as-is so the plugin keeps using the
      // host's `data-plugin` reclaim contract (tests assert `style[data-plugin=toolkit-pet]`).
      // 分页控件是共享件（src/client/ui/components/pagination/index.jsx），样式随本模块的样式表一起注入。
      ctx.effect(() => typeof document === 'undefined' ? undefined : installStylesheet(css + paginationCss + resizableDialogCss, 'toolkit-pet'), 'toolkit-pet:stylesheet')
      ctx.effect(() => {
        const off = form ? (form.subscribe?.(refresh) ?? form.store?.subscribe?.(refresh)) : connection.subscribe(refresh)
        return () => { off?.(); listeners.clear() }
      }, 'toolkit-pet:settings')
      ctx.effect(() => { connection.start(); return () => connection.dispose() }, 'toolkit-pet:connection')
      // 跨模块契约（只读方：toolkit-notification）：灵动岛在线时在根元素上留一个标记，
      // 通知侧据此把「前台提醒」让给岛上的徽标，避免同一件事既响提示音又亮徽标。
      //   'on'  = 灵动岛已开启（islandEnabled）且桌面 helper 在跑（runtime.status === 'running'）
      //   缺失  = 没有灵动岛（未装 pet 模块 / 没开岛 / helper 没跑），通知侧按旧行为提醒
      // 只写这一个人可读的 dataset，不碰 pet host，也不 import 通知模块的任何代码。
      ctx.effect(() => {
        const root = typeof document === 'undefined' ? undefined : document.documentElement
        if (!root) return undefined
        const sync = () => {
          const active = value.islandEnabled === true
            && connection.getSnapshot()?.runtime?.status === 'running'
          if (active) root.dataset.dshIsland = 'on'
          else delete root.dataset.dshIsland
        }
        const off = connection.subscribe(sync)
        listeners.add(sync)
        sync()
        return () => {
          off?.()
          listeners.delete(sync)
          delete root.dataset.dshIsland
        }
      }, 'toolkit-pet:island-mark')
      // 别人把主视图切到这个会话时（系统通知点击跳转、侧栏点另一个会话），灵动岛的状态也要
      // 跟着刷新：读到「主视图持有哪个会话」就把它标记成已读。只读既有快照，不新增事件通道。
      // 三路来源互为兜底（列表快照 → retainInfo → 当前会话的本地记录），并每秒重扫一次，
      // 免得任何一路的订阅语义变化就让整条链路静默失效。
      ctx.effect(() => {
        const sessions = ctx.sessions
        const list = sessions?.list
        const ids = () => {
          try {
            const snap = list?.getSnapshot?.()
            if (Array.isArray(snap?.ids)) return snap.ids
            return Object.keys(snap?.byId ?? {})
          } catch {
            return []
          }
        }
        const mainView = () => {
          try {
            const byId = list?.getSnapshot?.()?.byId ?? {}
            for (const key of Object.keys(byId)) {
              if ((byId[key]?.retainedBy?.mainView ?? 0) > 0) return key
            }
          } catch {}
          try {
            for (const id of ids()) {
              if ((sessions?.retainInfo?.(id)?.getSnapshot?.()?.retainedBy?.mainView ?? 0) > 0) return id
            }
          } catch {}
          try {
            const raw = globalThis.localStorage?.getItem('dsh.sessions.current')
            if (!raw) return undefined
            const parsed = JSON.parse(raw)
            const id = typeof parsed === 'string' ? parsed : parsed?.sessionId
            if (typeof id === 'string' && id) return id
          } catch {}
          return undefined
        }
        // 只有「窗口真的在前台」才算看过了：用户从别的应用切回来、既没点通知也没点
        // 灵动岛时，岛上残留的「有新结果」必须自己清爽 —— 他此刻就坐在会话前面。
        const present = () => {
          try {
            if (typeof document === 'undefined') return false
            if (document.visibilityState !== 'visible') return false
            return typeof document.hasFocus !== 'function' || document.hasFocus()
          } catch { return false }
        }
        const sent = new Set()
        const report = (id, stamp) => {
          if (typeof id !== 'string' || id === '' || !present()) return
          const key = `${id}@${stamp}`
          if (sent.has(key)) return
          sent.add(key)
          Promise.resolve(connection.seen(id)).catch(warn)
        }
        let last
        const sync = () => {
          const id = mainView()
          if (typeof id !== 'string' || id === '' || id === last) return
          last = id
          Promise.resolve(connection.seen(id)).catch(warn)
        }
        // 岛上把当前会话标成「有新结果 / 失败」时，取那一条的指纹用于一次去重。
        const rowStamp = (id) => {
          if (typeof id !== 'string' || id === '') return undefined
          const rows = connection.getSnapshot()?.sessions
          if (!Array.isArray(rows)) return undefined
          const row = rows.find((item) => item?.id === id)
          if (!row || (row.status !== 'completed' && row.status !== 'failed')) return undefined
          return `row:${row.updatedAt ?? 0}`
        }
        // 前台安静时出现「有新结果」：用户正看着这个会话，直接算已读。
        const settle = () => {
          const id = mainView()
          const stamp = rowStamp(id)
          if (stamp) report(id, stamp)
        }
        const offs = []
        if (typeof list?.subscribe === 'function') offs.push(list.subscribe(sync))
        try {
          for (const id of ids()) {
            const observable = sessions?.retainInfo?.(id)
            if (typeof observable?.subscribe === 'function') offs.push(observable.subscribe(sync))
          }
        } catch {}
        const timer = setInterval(() => { sync(); settle() }, 1000)
        timer.unref?.()
        // 一次性的能力自报：只进 host 私有 /state，用来确认客户端到底读到了什么。
        const submitDiag = () => {
          try {
            const snap = list?.getSnapshot?.()
            const byId = snap?.byId ?? {}
            const first = Object.keys(byId)[0]
            void connection.diag({
              hasSessions: Boolean(sessions),
              hasList: Boolean(list),
              canSubscribe: typeof list?.subscribe === 'function',
              canSnapshot: typeof list?.getSnapshot === 'function',
              canRetainInfo: typeof sessions?.retainInfo === 'function',
              count: ids().length,
              rowKeys: first ? Object.keys(byId[first] ?? {}).slice(0, 24) : [],
              retainedKeys: first ? Object.keys(byId[first]?.retainedBy ?? {}) : [],
              current: String(globalThis.localStorage?.getItem('dsh.sessions.current') ?? '').slice(0, 120),
              resolved: String(mainView() ?? ''),
            }).catch(warn)
          } catch (error) { warn(error) }
        }
        const reportTimer = setTimeout(submitDiag, 3000)
        reportTimer.unref?.()
        sync()
        // 主视图订阅之外，再盯一眼岛推来的会话状态：前台时「有新结果」不该留在岛上。
        offs.push(connection.subscribe(settle))
        let activations = 0
        // 恢复前台＝看过了：这一次激活已经覆盖岛上那条「有新结果」，不必再多发一次。
        const wake = () => {
          sync()
          const id = mainView()
          activations += 1
          if (present()) {
            const stamp = rowStamp(id)
            if (stamp) sent.add(`${id}@${stamp}`)
          }
          report(id, `focus:${activations}`)
        }
        globalThis.addEventListener?.('focus', wake)
        globalThis.addEventListener?.('visibilitychange', wake)
        return () => {
          for (const off of offs) { try { off?.() } catch {} }
          clearInterval(timer)
          clearTimeout(reportTimer)
          globalThis.removeEventListener?.('focus', wake)
          globalThis.removeEventListener?.('visibilitychange', wake)
        }
      }, 'toolkit-pet:seen-on-focus')
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'desktop-pet', order: 25, label: () => t('nav'), locale: PET_NS }, Panel)), 'toolkit-pet:section')
      ctx.effect(() => registerSettingsIcon(ctx, 'desktop-pet', 'paw'), 'toolkit-pet:settings-icon')
    },
  }
}
