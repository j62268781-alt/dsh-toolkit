import React from 'react'

globalThis.__dshReact = React

import { installStylesheet } from '../../../client/ui/stylesheet.js'
import { createConnection } from './model.js'
import { createTranslator, WC_COPY, WC_NS } from './locale.js'
import { createPanel } from './panel.jsx'
import css from './styles.css'

/**
 * Client 半边：侧栏底部的「微信连接」入口 + hover 弹出的扫码面板。
 *
 * 依赖只有 `slots` 与 `locale`：
 *   - 不需要 configForms：本模块的状态全部在宿主服务里，不通过设置表单读写；
 *   - 不需要 remote：所有请求都走同源 HTTP 路由。
 */
export default function createWeixinClawbot(require) {
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

  return {
    name: 'toolkit-weixin-clawbot-client',
    inject: ['slots', 'locale'],
    apply(ctx) {
      const t = createTranslator(ctx)
      const connection = createConnection({
        onError: (error) => {
          // 传输层错误只在控制台留一条，面板里另有可见提示。
          try {
            console.warn('[weixin-clawbot]', error)
          } catch {
            // 忽略。
          }
        },
      })

      const Entry = createPanel(ReactRuntime, { t, connection, portal })

      ctx.effect(() => ctx.locale?.register?.(WC_NS, WC_COPY) ?? (() => {}), 'toolkit-weixin-clawbot:dictionary')
      ctx.effect(() => installStylesheet(css, 'toolkit-weixin-clawbot'), 'toolkit-weixin-clawbot:stylesheet')
      ctx.effect(() => {
        connection.dispose()
      }, 'toolkit-weixin-clawbot:connection')
      ctx.effect(
        () => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'weixin-clawbot',
          key: 'weixin-clawbot',
          order: 9,
          label: () => t('entry'),
          locale: WC_NS,
        }, Entry)),
        'toolkit-weixin-clawbot:footer-action',
      )
    },
  }
}
