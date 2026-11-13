import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  dshHomePath,
  readTrustedPeers,
  serverScope,
  trustedPeersPath,
} from '../../src/modules/remote/host/mobile/peers.js'

// 这三个目录名是真实机器上 ds-harness-remote 的落盘结果（配对服务器 / 本地验证服）。
// 哈希算法必须和上游 identity-store 一致，否则读不到同伴文件。
test('serverScope：与上游 identity-store 的目录名一致', () => {
  assert.equal(serverScope('https://129.204.29.215:16666'), '96b1ba3206af1b64d07c20f6')
  assert.equal(serverScope('https://dsh.r2049.cn'), 'e9988d504cda7c1541adafcc')
  assert.equal(serverScope('http://127.0.0.1:8787'), 'b1a61bf29a38ff3642af0dad')
  // 同一 origin 的路径/查询串不影响目录：一台服务器只有一个账号落盘位置。
  assert.equal(serverScope('https://dsh.r2049.cn/pair#v1.abc'), serverScope('https://dsh.r2049.cn'))
})

test('serverScope：非法地址与非 http(s) 协议给出 400', () => {
  for (const bad of ['', 'not a url', 'ftp://example.com', 'file:///tmp/x']) {
    assert.throws(() => serverScope(bad), (error) => error?.statusCode === 400, bad)
  }
})

test('dshHomePath：DSH_HOME 优先，否则 ~/.dsh', () => {
  assert.equal(dshHomePath({ DSH_HOME: '/tmp/dsh-home' }, '/home/u'), '/tmp/dsh-home')
  assert.equal(dshHomePath({ DSH_HOME: '  ' }, '/home/u'), '/home/u/.dsh')
  assert.equal(dshHomePath({}, '/home/u'), '/home/u/.dsh')
})

test('trustedPeersPath：拼在 <root>/ds-harness-remote/servers/<scope>/host 下', () => {
  assert.equal(
    trustedPeersPath({ serverUrl: 'https://dsh.r2049.cn', homeDir: '/root/dsh' }),
    join('/root/dsh', 'ds-harness-remote', 'servers', 'e9988d504cda7c1541adafcc', 'host', 'trusted-peers.json'),
  )
})

async function sandbox(serverUrl, peers) {
  const homeDir = await mkdtemp(join(tmpdir(), 'dsh-peers-'))
  const path = trustedPeersPath({ serverUrl, homeDir })
  if (peers !== undefined) {
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, typeof peers === 'string' ? peers : JSON.stringify({ peers }))
  }
  return { homeDir, path }
}

test('readTrustedPeers：按 trustedAt 倒序，只回身份字段', async () => {
  const older = {
    deviceId: 'phone-old',
    publicKey: 'must-not-leak',
    name: 'Old Phone',
    platform: 'ios',
    fingerprint: '1B25 B68D 48EA',
    trustedAt: 1_794_493_545_341,
  }
  const newer = {
    deviceId: 'phone-new',
    publicKey: 'must-not-leak',
    name: '  DSH App (Android)  ',
    fingerprint: '  7F2C 4CE8 0A33  ',
    trustedAt: 1_794_552_934_189,
  }
  const { homeDir } = await sandbox('https://129.204.29.215:16666', [older, newer])
  const { peers } = await readTrustedPeers({ serverUrl: 'https://129.204.29.215:16666', homeDir })
  assert.deepEqual(peers.map((peer) => peer.deviceId), ['phone-new', 'phone-old'])
  assert.equal(peers[0].name, 'DSH App (Android)', '名字去掉首尾空白')
  assert.equal(peers[0].fingerprint, '7F2C 4CE8 0A33')
  assert.equal(peers[0].platform, undefined)
  assert.equal(peers[0].publicKey, undefined, '公钥不该出现在面板接口里')
  assert.equal(peers[1].trustedAt, 1_794_493_545_341)
})

test('readTrustedPeers：文件不存在/坏内容都当成「没有 peer」', async () => {
  const missing = await sandbox('https://dsh.r2049.cn')
  assert.deepEqual(await readTrustedPeers({ serverUrl: 'https://dsh.r2049.cn', homeDir: missing.homeDir }), {
    path: missing.path,
    peers: [],
  })

  const broken = await sandbox('https://dsh.r2049.cn', '{ not json')
  assert.deepEqual((await readTrustedPeers({ serverUrl: 'https://dsh.r2049.cn', homeDir: broken.homeDir })).peers, [])

  const notList = await sandbox('https://dsh.r2049.cn', '{"version":1}')
  assert.deepEqual((await readTrustedPeers({ serverUrl: 'https://dsh.r2049.cn', homeDir: notList.homeDir })).peers, [])
})

test('readTrustedPeers：缺 deviceId 的条目被丢弃，trustedAt 非法记 0', async () => {
  const { homeDir } = await sandbox('http://127.0.0.1:8787', [
    { name: 'no id', trustedAt: 5 },
    { deviceId: 'ok', trustedAt: 'not-a-number' },
    null,
    'string',
  ])
  const { peers } = await readTrustedPeers({ serverUrl: 'http://127.0.0.1:8787', homeDir })
  assert.deepEqual(peers, [{ deviceId: 'ok', name: undefined, platform: undefined, fingerprint: undefined, trustedAt: 0 }])
})

test('readTrustedPeers：读不动的错误（权限等）照实抛出，不假装没有 peer', async () => {
  // 目录当文件用：EISDIR 不是「没配过」，应该冒到路由层变成 500，而不是静悄悄空列表。
  const { homeDir, path } = await sandbox('https://dsh.r2049.cn', undefined)
  await mkdir(path, { recursive: true })
  await assert.rejects(
    readTrustedPeers({ serverUrl: 'https://dsh.r2049.cn', homeDir }),
    (error) => error?.code === 'EISDIR',
  )
})
