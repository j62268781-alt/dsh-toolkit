/**
 * Client half of the token usage module.
 * Contract: docs/usage/README.md.
 *
 * 入口放在左侧栏「自动化任务」下方：注册 `sidebar.panellist`（图标按钮，id 与
 * `main` 的 key 相同）与 `main` 的 `usage-tokens` 面板，点图标即在中栏打开统计页。
 * 不再占用设置页。
 *
 * 与 mobile 客户端同一套「工厂 + 全局 JSX」模式：主 bundle 的 jsxFactory 是
 * `__dshReact.createElement`，所以工厂里先 `globalThis.__dshReact = require('react')`，
 * 之后任何组件才会被渲染。
 */
import css from './styles.css'
import { installStylesheet } from '../../../client/ui/stylesheet.js'
import { findScopedForm } from '../../../client/config.js'
import { USAGE_NS, USAGE_COPY, createTranslator } from './locale.js'
import { createUsagePanel } from './panel.jsx'

/** 左侧栏按钮 id 与中栏面板 key：两边必须一致，点按钮才会打开对应面板。 */
export const USAGE_PANEL_ID = 'usage-tokens'

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

/**
 * 左侧栏按钮图标（owner 传入 `{ size, active }`）。
 * 用 currentColor 跟随侧栏前景色；选中时把柱子填满，未选中只描边。
 */
function createUsageIcon(React) {
  return function UsageArtwork({ size = 16, active = false }) {
    const edge = Number.isFinite(size) && size > 0 ? Math.round(size) : 16
    const bars = [
      { x: 3, y: 9, height: 4.5 },
      { x: 6.4, y: 6.5, height: 7 },
      { x: 9.8, y: 4, height: 9.5 },
      { x: 13.2, y: 7.5, height: 6 },
    ]
    return React.createElement(
      'svg',
      {
        className: 'usg-navIcon',
        width: edge,
        height: edge,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
        'data-active': active === true ? 'true' : 'false',
      },
      bars.map((bar) => React.createElement('rect', {
        key: bar.x,
        x: bar.x,
        y: bar.y,
        width: 1.9,
        height: bar.height,
        rx: 0.6,
        stroke: 'currentColor',
        strokeWidth: active === true ? 1.6 : 1.1,
        fill: active === true ? 'currentColor' : 'none',
      })),
    )
  }
}

export default function createUsage(require) {
  const React = require('react')
  globalThis.__dshReact = React

  return {
    name: 'toolkit-usage-client',
    inject: ['slots', 'locale', 'configForms'],
    apply(ctx) {
      // 表单在注册时解析一次；缺失时页面只读展示（不抛错）。
      const { form, entryId } = findScopedForm(ctx, 'usage')
      const t = createTranslator(ctx)
      const Panel = createUsagePanel(React, { form, entryId, t, locale: localeHint(ctx) })
      const Icon = createUsageIcon(React)
      const install = (run, label) => {
        try {
          if (typeof ctx.effect === 'function') return ctx.effect(run, label)
          return run()
        } catch (error) {
          try {
            console.warn(`[usage] 安装 ${label} 失败：`, error)
          } catch {}
          return undefined
        }
      }
      const register = (slot, meta, Component, label) => install(() => {
        if (typeof ctx.slots?.inject !== 'function' || typeof ctx.slots?.register !== 'function') return undefined
        return ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, ...meta }, Component))
      }, label)

      install(() => {
        try {
          return ctx.locale?.register?.(USAGE_NS, USAGE_COPY)
        } catch {
          return undefined
        }
      }, 'toolkit-usage:dictionary')

      install(() => {
        if (typeof document === 'undefined') return () => {}
        return installStylesheet(css, 'toolkit-usage')
      }, 'toolkit-usage:stylesheet')

      // 左侧栏图标：排在「自动化任务」(schedules, order 10) 之后。
      register('sidebar.panellist', {
        id: USAGE_PANEL_ID,
        order: 11,
        label: () => t('nav'),
      }, Icon, 'toolkit-usage:sidebar-icon')

      // 中栏页面：key 与图标 id 相同，点图标即打开。
      register('main', {
        key: USAGE_PANEL_ID,
      }, Panel, 'toolkit-usage:main-panel')
    },
  }
}
