import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { installSettingsNav } from '../../src/modules/theme/client/settings-nav.js'

test('toolbar config mirrors native availability and errors across a contribution remount', async (t) => {
  const dom = new JSDOM(`<div data-shortcut-modal="settings">
    <nav class="_x_nav"><div class="_x_navList"></div></nav>
    <div class="_x_content"><div class="_x_header"><div class="_x_actions">
      <div class="native-config"><button>打开配置文件</button></div>
    </div></div></div>
  </div>`)
  const globals = new Map()
  for (const name of ['window', 'document', 'MutationObserver', 'KeyboardEvent']) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] })
  }
  const dispose = installSettingsNav()
  t.after(() => {
    dispose()
    dom.window.close()
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  })
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  const { document } = dom.window
  const actions = document.querySelector('._x_actions')
  const owner = actions.querySelector('.native-config')
  const original = owner.querySelector('button')
  const toolbar = document.querySelector('.sk-setnav__toolbar')
  const action = toolbar.querySelector(':scope > button.sk-setnav__config')
  const alert = toolbar.querySelector('.sk-setnav__action-error[role="alert"]')
  assert.ok(action)
  assert.ok(alert)
  const clicks = []
  original.addEventListener('click', () => clicks.push('original'))

  assert.equal(action.hidden, false)
  assert.equal(action.disabled, false)
  assert.ok(owner.hasAttribute('data-sk-config-original'))
  assert.equal(alert.hidden, true)
  action.click()
  assert.deepEqual(clicks, ['original'], 'one click directly invokes the native button')

  original.disabled = true
  await flush()
  assert.equal(action.disabled, true)
  action.click()
  assert.deepEqual(clicks, ['original'], 'the disabled action cannot run again')

  const error = document.createElement('span')
  error.setAttribute('role', 'alert')
  error.textContent = '无法打开配置文件'
  owner.append(error)
  await flush()
  assert.equal(alert.textContent, error.textContent)
  assert.equal(alert.hidden, false)
  error.firstChild.data = '配置文件不可用'
  await flush()
  assert.equal(alert.textContent, '配置文件不可用', 'changes to the native error are mirrored')

  owner.remove()
  await flush()
  assert.equal(action.hidden, true, 'the toolbar action is unavailable until a native contribution returns')
  assert.equal(alert.hidden, true)
  assert.equal(alert.textContent, '', 'the removed contribution leaves no stale error')
  assert.equal(owner.hasAttribute('data-sk-config-original'), false)

  const replacement = document.createElement('div')
  replacement.innerHTML = '<button>编辑配置文件</button>'
  const next = replacement.querySelector('button')
  next.addEventListener('click', () => clicks.push('replacement'))
  actions.append(replacement)
  await flush()
  assert.equal(action.hidden, false)
  assert.equal(action.disabled, false, 'the old contribution does not leave the replacement disabled')
  assert.equal(action.getAttribute('aria-label'), '编辑配置文件')
  assert.equal(action.title, '编辑配置文件')
  assert.equal(alert.hidden, true)
  action.click()
  assert.deepEqual(clicks, ['original', 'replacement'], 'the projected action forwards to the new native button')

  dispose()
  assert.ok(document.querySelector('.sk-setnav__config, .sk-setnav__action-error') === null)
  assert.equal(replacement.hasAttribute('data-sk-config-original'), false, 'teardown restores the native contribution')
})
