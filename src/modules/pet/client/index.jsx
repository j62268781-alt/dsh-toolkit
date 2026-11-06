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
      ctx.effect(() => typeof document === 'undefined' ? undefined : installStylesheet(css, 'toolkit-pet'), 'toolkit-pet:stylesheet')
      ctx.effect(() => {
        const off = form ? (form.subscribe?.(refresh) ?? form.store?.subscribe?.(refresh)) : connection.subscribe(refresh)
        return () => { off?.(); listeners.clear() }
      }, 'toolkit-pet:settings')
      ctx.effect(() => { connection.start(); return () => connection.dispose() }, 'toolkit-pet:connection')
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'desktop-pet', order: 25, label: () => t('nav'), locale: PET_NS }, Panel)), 'toolkit-pet:section')
      ctx.effect(() => registerSettingsIcon(ctx, 'desktop-pet', 'paw'), 'toolkit-pet:settings-icon')
    },
  }
}
