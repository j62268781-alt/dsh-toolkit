import { findScopedForm } from '../../../client/config.js'
import { acceptConfigWrite } from '../../../client/config-write.js'
import { installStylesheet } from '../../../client/ui/stylesheet.js'
import { createPetConnection } from './connection.js'
import { CONFIG_NS, formSnapshot, readSettings } from './model.js'
import { createTranslator, PET_COPY, PET_NS } from './locale.js'
import { createPetPanel } from './panel.jsx'
import { registerSettingsIcon } from '../../../client/settings-icon.jsx'
import css from './style.css'

export default function createPet(require) {
  const React = require('react')
  globalThis.__dshReact = React
  return {
    name: 'toolkit-pet-client',
    inject: ['slots', 'locale', 'configForms', 'uiWorkspace', 'workspaces'],
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
      ctx.effect(() => typeof document === 'undefined' ? undefined : installStylesheet(css, 'toolkit-pet'), 'toolkit-pet:stylesheet')
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
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'desktop-pet', order: 25, label: () => t('nav'), locale: PET_NS }, Panel)), 'toolkit-pet:section')
      ctx.effect(() => registerSettingsIcon(ctx, 'desktop-pet', 'paw'), 'toolkit-pet:settings-icon')
    },
  }
}
