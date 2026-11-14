import { NAME as NS } from '../host/identity.js'
import { findScopedForm } from '../../../client/config.js'
import { registerSettingsIcon } from '../../../client/ui/components/settings-icon/index.jsx'
import { installSettingsParts } from '../../../client/ui/components/settings-parts/install.js'
import { createPanel } from './panel.jsx'

/** Host injection and settings registration for the Skills & MCP panel. */
export default function createClient(require) {
  const React = require('react')
  globalThis.__dshReact = React
  const primitives = (() => {
    try {
      return require('@deepseek-ai/dsh-client-ui-primitives')
    } catch {
      return null
    }
  })()
  const Panel = createPanel(React, primitives)
  return {
    inject: ['slots', 'configForms', 'remote', 'remote.pluginInventory'],
    apply(ctx) {
      const { form, entryId } = findScopedForm(ctx, 'skillsMcp', [NS])
      // Services reached through `remote` must be injected first; a bare access
      // throws in cordis and would fail the whole client half.
      let inventory
      try {
        inventory = ctx.remote?.pluginInventory
      } catch {
        inventory = undefined
      }
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'skills-mcp',
        order: 20,
        label: () => 'Skills & MCP',
        inject: () => ({ form, entryId, inventory }),
      }, Panel))
      // 页头/卡片/行是九个设置面板共用的骨架，共享样式在 client 根只插一次。
      ctx.effect(() => installSettingsParts(), 'dsh-toolkit-skills-mcp:settings-parts')
      ctx.effect(() => registerSettingsIcon(ctx, 'skills-mcp', 'plug'), 'dsh-toolkit-skills-mcp:settings-icon')
    },
  }
}
