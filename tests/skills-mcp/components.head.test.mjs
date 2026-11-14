/** components/head 接口测试：文案钉住 + 用 react-dom/server 渲染共享页头。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PAGE_INTRO, PAGE_TITLE, pageHead } from '../../src/modules/skills-mcp/client/components/head.tsx'

// JSX 产物调用全局 __dshReact（入口在 app 里设置；测试在这里设置）
globalThis.__dshReact = React

test('文案：标题与一行说明', () => {
  assert.equal(PAGE_TITLE, 'Skills & MCP')
  assert.equal(PAGE_INTRO, '全局与项目级分层管理；保存后立即生效。')
})

test('pageHead：产出共享页头，标题/说明各就各位', () => {
  const html = renderToStaticMarkup(pageHead())
  // 页头骨架（18px 标题 + 13px 三级色副标题 + 12px 间距）在 settings-parts 里，这里只钉住结构。
  assert.match(html, /class="sk-ui-pageHead"/)
  assert.match(html, new RegExp(`class="sk-ui-pageTitle">${PAGE_TITLE.replace('&', '&amp;')}<`))
  assert.match(html, new RegExp(`class="sk-ui-pageIntro">${PAGE_INTRO}<`))
})