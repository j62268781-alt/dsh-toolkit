import React from 'react'

globalThis.__dshReact = React

import { installStylesheet } from '../../../client/ui/stylesheet.js'
import { createConnection } from './wechat/model.js'
import { createTranslator, WC_COPY, WC_NS } from './locale.js'
import { createPanel } from './panel.jsx'
import { installEntry } from './mount.jsx'
import css from './styles.css'

/**
 * Client 半边：侧栏账户行里的「微信连接」图标 + hover 弹出的扫码面板。
 *
 * 依赖只有 `locale`：
 *   - 入口不走插槽 —— 账户行没有可注册的 list 插槽，改用 DOM 安装器（见 mount.jsx）；
 *   - 不需要 configForms：本模块的状态全部在宿主服务里，不通过设置表单读写；
 *   - 不需要 remote：所有请求都走同源 HTTP 路由。
 */
export default function createRemote(require) {
  const ReactRuntime = require('react')
  globalThis.__dshReact = ReactRuntime

  // createPortal 由宿主的模块表提供；拿不到时退化成内联渲染。
  let portal = (node) => node
  try {
    const rd = require('react-dom')
    if (rd !== undefined && typeof rd.createPortal === 'function') portal = rd.createPortal
  } catch {
    portal = (node) => node
  }

  // createRoot 只在 react-dom/client 上；同样拿不到就退化成「不安装入口」。
  let createRoot
  try {
    const client = require('react-dom/client')
    if (client !== undefined && typeof client.createRoot === 'function') createRoot = client.createRoot
  } catch {
    createRoot = undefined
  }

  return {
    name: 'toolkit-remote-client',
    inject: ['locale'],
    apply(ctx) {
      const t = createTranslator(ctx)
      const connection = createConnection({
        onError: (error) => {
          // 传输层错误只在控制台留一条，面板里另有可见提示。
          try {
            console.warn('[remote]', error)
          } catch {
            // 忽略。
          }
        },
      })

      const Entry = createPanel(ReactRuntime, { t, connection, portal })

      ctx.effect(() => ctx.locale?.register?.(WC_NS, WC_COPY) ?? (() => {}), 'toolkit-remote:dictionary')
      ctx.effect(() => installStylesheet(css, 'toolkit-remote'), 'toolkit-remote:stylesheet')
      ctx.effect(() => {
        connection.dispose()
      }, 'toolkit-remote:connection')
      ctx.effect(
        () => installEntry(ctx, { React: ReactRuntime, createRoot, Entry }),
        'toolkit-remote:entry-icon',
      )
    },
  }
}
