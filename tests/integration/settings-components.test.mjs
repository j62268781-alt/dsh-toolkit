/** 公共设置组件（chevron / tag）：各面板共用，结构一旦变了全站九个面板一起变。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Chevron } from '../../src/client/ui/components/chevron/index.tsx'
import { Tag } from '../../src/client/ui/components/tag/index.tsx'

// JSX 产物调用全局 __dshReact（入口在 app 里设置；测试在这里设置）
globalThis.__dshReact = React

test('Chevron：默认挂公共类名，方向由 data-open 表达', () => {
  const open = renderToStaticMarkup(Chevron({ open: true }))
  assert.match(open, /class="sk-ui-chevron"/)
  assert.match(open, /data-open="true"/)
  assert.match(open, /aria-hidden="true"/, '图标是装饰，不该被读屏念出来')

  const closed = renderToStaticMarkup(Chevron({ open: false }))
  assert.match(closed, /data-open="false"/, '收起态靠 CSS 转 -90°，不是换图标')
  // 同一个图标两态都是同一条 path：不要为「收起」再造一枚。
  assert.equal((open.match(/<path/g) ?? []).length, 1)
  assert.equal((closed.match(/<path/g) ?? []).length, 1)
})

test('Chevron：允许换类名（面板要加自己的定位类时）', () => {
  const html = renderToStaticMarkup(Chevron({ open: true, className: 'smp-chevron' }))
  assert.match(html, /class="smp-chevron"/)
  assert.doesNotMatch(html, /sk-ui-chevron/)
})

test('Tag：默认 neutral 档，结构与样式类名固定', () => {
  const html = renderToStaticMarkup(Tag({ children: '全局' }))
  assert.equal(html, '<span class="sk-ui-tag" data-tone="neutral">全局</span>')
})

test('Tag：四档语气都只是 data-tone，不额外加类名', () => {
  for (const tone of ['ok', 'warn', 'danger']) {
    const html = renderToStaticMarkup(Tag({ tone, children: 'x' }))
    assert.equal(html, `<span class="sk-ui-tag" data-tone="${tone}">x</span>`)
  }
})

test('Tag：附加类名追加在后面，公共类名不能被顶掉', () => {
  const html = renderToStaticMarkup(Tag({ className: 'extra', children: '1' }))
  assert.match(html, /class="sk-ui-tag extra"/)
})
