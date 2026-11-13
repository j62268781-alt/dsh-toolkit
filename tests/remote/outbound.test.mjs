/**
 * 出站链路测试：文本发送、媒体加密上传、CDN 重试、下载解密、输入状态、文本整形与审批。
 *
 * 全部用假的 fetch 注入，不访问真实网络；只断言「发出去的报文长什么样」。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MESSAGE_STATE, MESSAGE_TYPE, createIlinkApi } from '../../src/modules/remote/host/wechat/api.js'
import { approvalPrompt, createApprovals, parseApprovalAnswer } from '../../src/modules/remote/host/wechat/approvals.js'
import { helpText, isKnownCommand, parseCommand } from '../../src/modules/remote/host/wechat/commands.js'
import {
  MAX_OUTBOUND_TEXT_BYTES,
  prepareOutboundText,
  truncateUtf8,
} from '../../src/modules/remote/host/wechat/markdown.js'
import { encryptAesEcb } from '../../src/modules/remote/host/wechat/media.js'

const BASE_URL = 'https://ilinkai.weixin.qq.com'
const TOKEN = 'tibdr-unit-token'
const CDN = 'https://novac2c.cdn.weixin.qq.com/c2c'

/** 替换全局 fetch，按调用顺序记录。 */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), init }
    calls.push(call)
    return handler(call, calls.length)
  }
  return {
    calls,
    restore() {
      globalThis.fetch = original
    },
  }
}

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03])

function api(overrides = {}) {
  return createIlinkApi({ baseUrl: BASE_URL, token: TOKEN, cdnBaseUrl: CDN, ...overrides })
}

test('sendText 的报文是 Bot 完成态，并回传 context_token', async () => {
  const stub = stubFetch(() => jsonResponse({ ret: 0 }))
  try {
    await api().sendText('user-1', '你好', 'ctx-token-1')
    assert.equal(stub.calls.length, 1)
    const [call] = stub.calls
    assert.ok(call.url.endsWith('/ilink/bot/sendmessage'), call.url)
    assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`)
    const body = JSON.parse(call.init.body)
    assert.equal(body.msg.from_user_id, '')
    assert.equal(body.msg.to_user_id, 'user-1')
    assert.equal(body.msg.message_type, MESSAGE_TYPE.bot)
    assert.equal(body.msg.message_state, MESSAGE_STATE.done)
    assert.equal(typeof body.msg.client_id, 'string')
    assert.deepEqual(body.msg.item_list, [{ type: 1, text_item: { text: '你好' } }])
    assert.equal(body.msg.context_token, 'ctx-token-1')
    assert.equal(body.base_info.bot_agent, 'dsh-toolkit-remote')
  } finally {
    stub.restore()
  }
})

test('没有 context_token 时不带该字段；空文本直接拒绝', async () => {
  const stub = stubFetch(() => jsonResponse({ ret: 0 }))
  try {
    await api().sendText('user-1', 'hi')
    assert.equal('context_token' in JSON.parse(stub.calls[0].init.body).msg, false)
    await assert.rejects(() => api().sendText('user-1', ''), /空文本/)
    assert.equal(stub.calls.length, 1)
  } finally {
    stub.restore()
  }
})

test('iLink 返回非零 ret 会抛出带错误码的可读错误', async () => {
  const stub = stubFetch(() => jsonResponse({ ret: -14, errmsg: 'session timeout' }))
  try {
    await assert.rejects(() => api().sendText('user-1', 'hi'), /发送微信消息失败.*-14/)
  } finally {
    stub.restore()
  }
})

test('sendImage：getuploadurl → 密文上传 → sendmessage 三步，且密钥以 base64 回传', async () => {
  let uploadedBody
  const stub = stubFetch((call, index) => {
    if (call.url.includes('/ilink/bot/getuploadurl')) {
      return jsonResponse({ ret: 0, upload_full_url: 'https://cdn.example.com/upload?token=abc' })
    }
    if (call.url === 'https://cdn.example.com/upload?token=abc') {
      uploadedBody = call.init.body
      return new Response(null, { status: 200, headers: { 'x-encrypted-param': 'enc-param-1' } })
    }
    assert.ok(call.url.endsWith('/ilink/bot/sendmessage'), `第 ${index} 次调用是 ${call.url}`)
    return jsonResponse({ ret: 0 })
  })
  try {
    await api().sendImage('user-1', PNG)
    assert.equal(stub.calls.length, 3)

    const uploadRequest = JSON.parse(stub.calls[0].init.body)
    assert.equal(uploadRequest.media_type, 1)
    assert.equal(uploadRequest.to_user_id, 'user-1')
    assert.equal(uploadRequest.rawsize, PNG.byteLength)
    assert.equal(uploadRequest.rawfilemd5.length, 32)
    assert.equal(uploadRequest.filesize % 16, 0)
    assert.equal(uploadRequest.aeskey.length, 32)
    assert.ok(uploadedBody instanceof Uint8Array)
    assert.equal(uploadedBody.byteLength, uploadRequest.filesize)

    const sendRequest = JSON.parse(stub.calls[2].init.body)
    const [item] = sendRequest.msg.item_list
    assert.equal(item.type, 2)
    assert.equal(item.image_item.media.encrypt_query_param, 'enc-param-1')
    assert.equal(item.image_item.media.encrypt_type, 1)
    // 协议约定：aes_key 是「16 字节密钥的 hex 字符串」再做 base64，解开是 32 个 hex 字符
    const decoded = Buffer.from(item.image_item.media.aes_key, 'base64').toString('utf8')
    assert.match(decoded, /^[0-9a-f]{32}$/)
    assert.equal(decoded, uploadRequest.aeskey)
    assert.equal(item.image_item.mid_size, uploadRequest.filesize)
  } finally {
    stub.restore()
  }
})

test('CDN 上传 5xx 会重试，4xx 立即失败且不重试', async () => {
  const fiveThenOk = stubFetch((call, index) => {
    if (call.url.includes('/ilink/bot/getuploadurl')) return jsonResponse({ ret: 0, upload_full_url: 'https://cdn.example.com/u' })
    if (call.url === 'https://cdn.example.com/u') {
      return index === 2
        ? new Response('boom', { status: 500 })
        : new Response(null, { status: 200, headers: { 'x-encrypted-param': 'p' } })
    }
    return jsonResponse({ ret: 0 })
  })
  try {
    await api().sendImage('user-1', PNG)
    assert.equal(fiveThenOk.calls.length, 4)
  } finally {
    fiveThenOk.restore()
  }

  const fatal = stubFetch((call) => {
    if (call.url.includes('/ilink/bot/getuploadurl')) return jsonResponse({ ret: 0, upload_full_url: 'https://cdn.example.com/u' })
    return new Response('nope', { status: 403 })
  })
  try {
    await assert.rejects(() => api().sendImage('user-1', PNG), /CDN 上传失败：HTTP 403/)
    assert.equal(fatal.calls.length, 2)
  } finally {
    fatal.restore()
  }
})

test('sendImage 先校验图片格式，坏数据不会打到网络上', async () => {
  const stub = stubFetch(() => jsonResponse({ ret: 0 }))
  try {
    await assert.rejects(() => api().sendImage('user-1', Buffer.from('not an image')), /微信图片格式不受支持/)
    assert.equal(stub.calls.length, 0)
  } finally {
    stub.restore()
  }
})

test('downloadImage 用 aes_key 解密（AES-128-ECB）', async () => {
  const key = Buffer.alloc(16, 7)
  const plaintext = Buffer.concat([PNG, Buffer.from('hello weixin')])
  const encrypted = encryptAesEcb(plaintext, key)
  const stub = stubFetch(() => new Response(encrypted, { status: 200 }))
  try {
    const bytes = await api().downloadImage({
      media: { encrypt_query_param: 'q-1', aes_key: key.toString('base64'), encrypt_type: 1 },
    })
    assert.deepEqual(Buffer.from(bytes), plaintext)
    assert.ok(stub.calls[0].url.startsWith(`${CDN}/download?`))
    assert.ok(stub.calls[0].url.includes('encrypted_query_param=q-1'))
  } finally {
    stub.restore()
  }
})

test('输入状态与渠道通知走对应端点', async () => {
  const stub = stubFetch((call) => {
    if (call.url.includes('/getconfig')) return jsonResponse({ ret: 0, typing_ticket: 'ticket-9' })
    return jsonResponse({ ret: 0 })
  })
  try {
    const client = api()
    assert.equal(await client.getTypingTicket('user-1', 'ctx'), 'ticket-9')
    await client.sendTyping('user-1', 'ticket-9', 1)
    await client.notifyStart()
    await client.notifyStop()
    const paths = stub.calls.map((call) => new URL(call.url).pathname)
    assert.deepEqual(paths, [
      '/ilink/bot/getconfig',
      '/ilink/bot/sendtyping',
      '/ilink/bot/msg/notifystart',
      '/ilink/bot/msg/notifystop',
    ])
    assert.equal(JSON.parse(stub.calls[1].init.body).status, 1)
  } finally {
    stub.restore()
  }
})

test('prepareOutboundText 去掉微信不渲染的标记，但保留代码块', () => {
  const output = prepareOutboundText([
    '## 标题',
    '',
    '**粗体** 与 ![图](https://example.com/a.png)',
    '',
    '```js',
    'const x = 1',
    '```',
  ].join('\n'))
  assert.ok(output.includes('标题'))
  assert.ok(!output.includes('##'))
  assert.ok(output.includes('粗体'))
  assert.ok(!output.includes('**'))
  assert.ok(!output.includes('!['))
  assert.ok(output.includes('```js'))
  assert.ok(output.includes('const x = 1'))
})

test('truncateUtf8 按字节截断且不切碎表情', () => {
  const text = '🐱'.repeat(200)
  const cut = truncateUtf8(text, 100)
  assert.ok(Buffer.byteLength(cut, 'utf8') <= 100)
  assert.ok(cut.endsWith('（内容过长，已截断）'))
  assert.equal(truncateUtf8('短', MAX_OUTBOUND_TEXT_BYTES), '短')
})

test('斜杠命令解析与帮助文案', () => {
  assert.deepEqual(parseCommand('/new'), { name: 'new', args: '' })
  assert.deepEqual(parseCommand('  /APPROVE  abc '), { name: 'approve', args: 'abc' })
  assert.equal(parseCommand('你好'), undefined)
  assert.equal(parseCommand('/'), undefined)
  assert.equal(isKnownCommand('help'), true)
  assert.equal(isKnownCommand('foo'), false)
  assert.ok(helpText().includes('/approve'))
})

test('审批：回复 allow 解开挂起，超时按取消，第二个并发请求直接拒绝', async () => {
  const sent = []
  const approvals = createApprovals({ notify: async (userId, text) => { sent.push({ userId, text }) } })
  const pending = approvals.request('user-1', { toolName: 'bash', reason: '需要执行命令' })
  assert.equal(approvals.hasPending('user-1'), true)
  assert.ok(sent[0].text.includes('bash'))
  assert.equal(approvals.answer('user-1', '允许'), true)
  assert.equal(await pending, 'allowed-once')
  assert.equal(approvals.hasPending('user-1'), false)

  // 同一用户第二个请求：直接拒绝，不排队
  const first = approvals.request('user-2', { toolName: 'a' })
  await Promise.resolve()
  assert.equal(await approvals.request('user-2', { toolName: 'b' }), 'rejected')
  approvals.answer('user-2', '/reject')
  assert.equal(await first, 'rejected')
  approvals.dispose()

  const timed = createApprovals({ notify: async () => {}, timeoutMs: 20 })
  assert.equal(await timed.request('user-3', { toolName: 'c' }), 'cancelled')
  timed.dispose()

  const broken = createApprovals({ notify: async () => { throw new Error('offline') } })
  assert.equal(await broken.request('user-4', { toolName: 'd' }), 'unavailable')
  broken.dispose()
})

test('审批回答解析与提示文案', () => {
  assert.equal(parseApprovalAnswer('YES'), 'allowed-once')
  assert.equal(parseApprovalAnswer('不同意'), 'rejected')
  assert.equal(parseApprovalAnswer('再说吧'), undefined)
  assert.ok(approvalPrompt({ toolName: 'write', reason: '改文件' }).includes('write'))
  assert.ok(approvalPrompt({}).includes('未知工具'))
})

test('审批提示带上会话 id，并发冲突时把两条会话都点名', async () => {
  // 文案：没有会话上下文时不加那一行
  assert.ok(!approvalPrompt({ toolName: 'bash' }).includes('会话：'))
  const withSession = approvalPrompt({ toolName: 'bash' }, { sessionId: 'remote-6f338b7ca279' })
  assert.match(withSession, /^会话：remote-6f338b7ca279\n【需要授权】工具「bash」/)

  const sent = []
  const approvals = createApprovals({
    notify: async (userId, text) => {
      sent.push(text)
    },
  })
  const first = approvals.request('user-1', { toolName: 'write', reason: '写文件' }, { sessionId: 'remote-a' })
  assert.equal(approvals.pendingSessionOf('user-1'), 'remote-a')
  assert.match(sent[0], /会话：remote-a/)
  await Promise.resolve()

  // 第二条并发请求：自己立刻被拒，但要说清「谁在等、谁被拒」——不能静默
  assert.equal(await approvals.request('user-1', { toolName: 'bash' }, { sessionId: 'remote-b' }), 'rejected')
  assert.match(sent[1], /已自动拒绝「bash」的请求（会话 remote-b）/)
  assert.match(sent[1], /仍在等待的是「write」（会话 remote-a）/)
  assert.equal(approvals.pendingSessionOf('user-1'), 'remote-a')

  approvals.answer('user-1', '/approve')
  assert.equal(await first, 'allowed-once')
  assert.equal(approvals.pendingSessionOf('user-1'), undefined)
  approvals.dispose()
})
