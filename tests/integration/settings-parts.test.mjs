/** 公共设置骨架样式表的去重与生命周期：多个插件共用一份，最后一个卸载才删。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import {
  SETTINGS_PARTS_ID,
  installSettingsParts,
  installSharedStylesheet,
} from '../../src/client/ui/components/settings-parts/install.ts'

const SELECTOR = `style[data-plugin="${SETTINGS_PARTS_ID}"]`

function usePage(t) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
  const previous = globalThis.document
  globalThis.document = dom.window.document
  t.after(() => {
    globalThis.document = previous
  })
  return dom.window.document
}

test('多个模块各自装一次：页面上只有一份 <style>，最后一个卸载才删', (t) => {
  const document = usePage(t)
  const offNotification = installSettingsParts()
  const offPet = installSettingsParts()
  assert.equal(document.querySelectorAll(SELECTOR).length, 1)
  assert.match(document.querySelector(SELECTOR).textContent, /\.sk-ui-pageTitle\s*\{[^}]*font-size:\s*18px/)

  offNotification()
  assert.equal(document.querySelectorAll(SELECTOR).length, 1, '先卸载的模块不能把别人还在用的样式删掉')
  offPet()
  assert.equal(document.querySelectorAll(SELECTOR).length, 0)
})

test('重复卸载同一次安装不会把后来者的样式删掉', (t) => {
  const document = usePage(t)
  const offFirst = installSettingsParts()
  offFirst()
  offFirst()
  const offSecond = installSettingsParts()
  assert.equal(document.querySelectorAll(SELECTOR).length, 1)
  offSecond()
  assert.equal(document.querySelectorAll(SELECTOR).length, 0)
})

test('样式已存在时不重复插入，也不负责删除别人的那份', (t) => {
  const document = usePage(t)
  const foreign = document.createElement('style')
  foreign.dataset.plugin = SETTINGS_PARTS_ID
  document.head.appendChild(foreign)

  const off = installSettingsParts()
  assert.equal(document.querySelectorAll(SELECTOR).length, 1)
  off()
  assert.ok(document.querySelector(SELECTOR), '不是本模块插入的 <style> 不能由它删除')
})

test('换文档时补插一份（每例一个新页面）', (t) => {
  const first = usePage(t)
  const offFirst = installSettingsParts()
  assert.equal(first.querySelectorAll(SELECTOR).length, 1)
  offFirst()

  const second = usePage(t)
  const offSecond = installSharedStylesheet('.sk-ui-row { padding: 0 }', SETTINGS_PARTS_ID)
  assert.equal(second.querySelectorAll(SELECTOR).length, 1)
  offSecond()
  assert.equal(second.querySelectorAll(SELECTOR).length, 0)
})