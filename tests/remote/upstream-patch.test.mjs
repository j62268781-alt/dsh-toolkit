/**
 * 守卫 `ds-harness-remote` 的 pnpm patch。
 *
 * 真机反馈（2026-11-16）：「http://10.144.70.35/IYN9bNRe/dshgo，有的是转发的 nginx 的啊」——
 * 上游把 serverUrl 当 origin 用（`normalizeServerUrl` 直接抛 `serverUrl must be an origin without a path`），
 * 但它的 HTTP 请求是 `${baseUrl}${path}` 拼接、WebSocket 是 `baseUrl.pathname + '/ws/v1/connect'`，
 * 本来就支持子路径。我们在 `patches/ds-harness-remote@0.6.4.patch` 里放宽了两处：
 *   1. `normalizeServerUrl` 保留 pathname（只去末尾斜杠）；
 *   2. `checkIdentity` 不再要求 `serverUrl === origin`。
 *
 * 这条用例守的就是「patch 还在」：上游升级到新版本、或有人 `rm -rf node_modules` 后忘了
 * `pnpm install`（patch 未生效）时，这里会先红，而不是等用户在面板上看到英文 TypeError。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const CONFIG = new URL('../../node_modules/ds-harness-remote/dist/config.js', import.meta.url)
const BUNDLE = new URL('../../node_modules/ds-harness-remote/dist/index.js', import.meta.url)

test('上游 normalizeServerUrl 保留子路径前缀（pnpm patch 生效）', async () => {
  const { normalizeServerUrl } = await import(CONFIG)
  assert.equal(
    normalizeServerUrl('http://10.144.70.35/IYN9bNRe/dshgo/'),
    'http://10.144.70.35/IYN9bNRe/dshgo',
    'nginx 子路径必须原样保留，只去掉末尾斜杠',
  )
  assert.equal(normalizeServerUrl('https://pair.example.com/'), 'https://pair.example.com')
  assert.equal(normalizeServerUrl('http://192.168.1.5:8080'), 'http://192.168.1.5:8080')

  // 上游原有的安全约束不能丢：公网 http、带凭据、带查询参数仍然拒绝。
  assert.throws(() => normalizeServerUrl('http://pair.example.com'), /must use HTTPS/)
  assert.throws(() => normalizeServerUrl('https://user:pw@pair.example.com'), /credentials/)
  assert.throws(() => normalizeServerUrl('https://pair.example.com/?a=1'), /query parameters/)
})

test('上游 dist 里不再残留 origin-only 校验（两个文件都要盖到）', async () => {
  for (const path of [CONFIG, BUNDLE]) {
    const source = await readFile(path, 'utf8')
    assert.equal(
      source.includes('origin without a path'),
      false,
      `${path.pathname} 还留着 origin-only 的报错，说明 pnpm patch 没打上（跑 pnpm install）`,
    )
    assert.equal(
      source.includes('origin.origin !== pairing.serverUrl'),
      false,
      `${path.pathname} 还要求 serverUrl 等于 origin，带子路径的配置会被判 IDENTITY_INVALID`,
    )
  }
})