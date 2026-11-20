import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyCall } from '../../src/modules/task-monitor/host/domain/classify.js'
import { collectInputSources, observeInputSources } from '../../src/modules/task-monitor/host/domain/sources.js'

const text = (text) => ({ type: 'text', text })
const user = (...content) => ({ role: 'user', source: { kind: 'user' }, content })
const recall = (sessionId, label) => ({
  role: 'user', source: { kind: 'session-reference', form: 'recall', version: 1, references: [{ sessionId, label }] },
  content: [text('Snapshot: @private.md https://snapshot.test/')],
})

const messageEvent = (seq, data) => ({ type: 'user/message', seq, data })

test('记录已发送的文件及图片附件，不将附件 opaque ID 当作路径', () => {
  const file = { type: 'file', attachment: { attachmentId: 'file-id', name: 'brief.pdf', bytes: 13 } }
  const image = { type: 'image', attachment: { attachmentId: 'image-id', mediaType: 'image/png' } }
  assert.deepEqual(collectInputSources(user(file, image, file, { type: 'file', receiptId: 'staged' })), [
    { kind: 'source', id: 'input:attachment:file:file-id', label: 'brief.pdf', detail: '' },
    { kind: 'source', id: 'input:attachment:image:image-id', label: 'image/png', detail: '' },
  ])
})

test('只提取显式文件引用及 HTTP(S) 链接，保持同一消息去重', () => {
  const seeds = collectInputSources(user(text([
    String.raw`帮我读 @./src/main.ts @src\main.ts， @"assets/my image.png" @Dockerfile @README @"notes"`,
    'src/implicit.ts email@example.com @teammate @"unfinished @https://example.org/not-a-file',
    '> 引述内容 @quoted.md https://quoted.test/',
    '参考 <https://example.com/a?x=1&y=2> 和 [wiki](HTTPS://example.com/Title_(test))。',
    '重复 https://example.com/a?x=1&y=2；以及 ftp://other.test 和 https://',
  ].join('\n'))))
  assert.deepEqual(seeds.map(({ id, target }) => [id, target]), [
    ['input:file:src/main.ts', 'src/main.ts'],
    ['input:file:assets/my image.png', 'assets/my image.png'],
    ['input:file:Dockerfile', 'Dockerfile'],
    ['input:file:README', 'README'],
    ['input:file:notes', 'notes'],
    ['input:url:https://example.com/a?x=1&y=2', 'https://example.com/a?x=1&y=2'],
    ['input:url:HTTPS://example.com/Title_(test)', 'HTTPS://example.com/Title_(test)'],
  ])
  assert.ok(seeds.every(({ kind }) => kind === 'source'))
})

test('read/read_image、运行时上下文和助手事件不生成来源', async () => {
  assert.deepEqual(classifyCall('read', { file_path: 'src/main.ts' }), [])
  assert.deepEqual(classifyCall('read_image', { path: 'images/logo.png' }), [])
  const seen = []
  const listener = observeInputSources((...input) => seen.push(input))
  const session = { header: { id: 'current' } }
  const data = user(text('@src/main.ts https://example.com/'))
  listener(session, { type: 'assistant/message', seq: 11, data })
  listener(session, { type: 'agent/inbox/spliced', seq: 12, data: { inserted: [data] } })
  listener(session, messageEvent(13, { ...data, source: { kind: 'runtime-context' } }))
  listener(session, messageEvent(14, { ...data, role: 'assistant' }))
  listener(session, messageEvent(15, undefined))
  await Promise.resolve()
  assert.deepEqual(seen, [])
})

test('仅归集紧跟发送消息的会话引用元数据，不归集回忆正文或把会话标题重复记作文件/链接', async () => {
  const seen = []
  const listener = observeInputSources((...input) => seen.push(input))
  const session = { header: { id: 'current' } }
  const other = { header: { id: 'other' } }
  listener(session, messageEvent(20, user(text('看看 @status.md.bak 和 @status.md，以及 @https://label.test/ 和 https://input.test/'))))
  listener(other, messageEvent(21, recall('unrelated', 'unrelated.md')))
  const related = recall('ref', 'status.md')
  related.source.references.push({ sessionId: 'link-title', label: 'https://label.test/' })
  listener(session, messageEvent(21, related))
  listener(session, messageEvent(22, user(text('@second.md'))))
  await Promise.resolve()
  assert.deepEqual(seen.map(([id, seeds]) => [id, seeds.map(seed => [seed.id, seed.target])]), [
    ['current', [
      ['input:file:status.md.bak', 'status.md.bak'],
      ['input:url:https://input.test/', 'https://input.test/'],
      ['input:session:ref', undefined],
      ['input:session:link-title', undefined],
    ]],
    ['current', [['input:file:second.md', 'second.md']]],
  ])
})
