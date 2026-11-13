/**
 * 解绑后的本机残留清理。
 *
 * 真机回归（2026-11-13）：用户解绑设备后重启 DSH，面板仍然按「这台机器是配对主机」
 * 来讲话（「配对授权已被移除」），因为上游解绑只删身份记录，`pairing-host-only.json`
 * 与旧的 client 角色目录留在盘上。这里锁住清理范围与「不该删什么」。
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  pairingHostOnlyPath,
  purgePairingState,
  readPairingHostOnly,
  serverStateDir,
} from '../../src/modules/remote/host/local-state.js'

const SERVER = 'https://dsh.r2049.cn'
const SCOPE = 'e9988d504cda7c1541adafcc'

async function home() {
  return mkdtemp(join(tmpdir(), 'dsh-local-state-'))
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** 造一份「配过对的 hostOnly 安装」：策略文件 + host 身份 + 旧 client 身份。 */
async function pairedHostHome() {
  const homeDir = await home()
  const dir = serverStateDir({ serverUrl: SERVER, homeDir })
  await mkdir(join(dir, 'host'), { recursive: true })
  await mkdir(join(dir, 'client'), { recursive: true })
  await writeFile(join(dir, 'host', 'pairing-host-only.json'), '{"hostOnly":true}')
  await writeFile(join(dir, 'host', 'device.json'), '{"deviceId":"host-1"}')
  await writeFile(join(dir, 'host', 'device.key'), 'PRIVATE')
  await writeFile(join(dir, 'host', 'trusted-peers.json'), '{"schemaVersion":1,"peers":[]}')
  await writeFile(join(dir, 'client', 'device.json'), '{"deviceId":"client-1"}')
  return { homeDir, dir }
}

test('serverStateDir / pairingHostOnlyPath：与上游 identity-store 的落盘位置一致', () => {
  const dir = serverStateDir({ serverUrl: SERVER, homeDir: '/root/dsh' })
  assert.equal(dir, join('/root/dsh', 'ds-harness-remote', 'servers', SCOPE))
  // 同一 origin 的路径/查询串落在同一个目录。
  assert.equal(serverStateDir({ serverUrl: `${SERVER}/pair#v1.x`, homeDir: '/root/dsh' }), dir)
  assert.equal(pairingHostOnlyPath({ serverUrl: SERVER, homeDir: '/root/dsh' }), join(dir, 'host', 'pairing-host-only.json'))
})

test('serverStateDir：非法地址给出 400，不猜目录', () => {
  for (const bad of ['', 'not a url', 'ftp://example.com']) {
    assert.throws(() => serverStateDir({ serverUrl: bad, homeDir: '/root/dsh' }), (error) => error?.statusCode === 400, bad)
  }
})

test('readPairingHostOnly：只认 {"hostOnly":true}，坏文件当没有策略', async () => {
  const { homeDir } = await pairedHostHome()
  assert.equal(await readPairingHostOnly({ serverUrl: SERVER, homeDir }), true)

  const broken = await home()
  const policy = pairingHostOnlyPath({ serverUrl: SERVER, homeDir: broken })
  await mkdir(join(policy, '..'), { recursive: true })
  await writeFile(policy, '{ not json')
  assert.equal(await readPairingHostOnly({ serverUrl: SERVER, homeDir: broken }), false)

  const missing = await home()
  assert.equal(await readPairingHostOnly({ serverUrl: SERVER, homeDir: missing }), false)
})

test('purgePairingState：删掉策略文件与旧的 client 目录，保留 host 身份', async () => {
  const { homeDir, dir } = await pairedHostHome()
  const result = await purgePairingState({ serverUrl: SERVER, homeDir })

  assert.equal(result.hostOnly, true, '删之前读到的策略要回报给调用方')
  assert.equal(result.dir, dir)
  assert.deepEqual(result.removed.sort(), ['client', 'host/pairing-host-only.json'])
  assert.equal(await exists(join(dir, 'host', 'pairing-host-only.json')), false)
  assert.equal(await exists(join(dir, 'client')), false)

  // host 身份必须留着：运行中的 host 运行时就持有它，删了只会让内存与磁盘不一致。
  assert.equal(await readFile(join(dir, 'host', 'device.json'), 'utf8'), '{"deviceId":"host-1"}')
  assert.equal(await exists(join(dir, 'host', 'device.key')), true)
  assert.equal(await exists(join(dir, 'host', 'trusted-peers.json')), true)
})

test('purgePairingState：不是 hostOnly 的安装不动 client 身份（那是合法状态）', async () => {
  const homeDir = await home()
  const dir = serverStateDir({ serverUrl: SERVER, homeDir })
  await mkdir(join(dir, 'client'), { recursive: true })
  await writeFile(join(dir, 'client', 'device.json'), '{"deviceId":"client-1"}')

  const result = await purgePairingState({ serverUrl: SERVER, homeDir })
  assert.equal(result.hostOnly, false)
  assert.deepEqual(result.removed, [])
  assert.equal(await exists(join(dir, 'client', 'device.json')), true, '普通安装的 client 身份不能顺手删掉')
})

test('purgePairingState：重复调用是幂等的（第二次什么都不删，也不报错）', async () => {
  const { homeDir } = await pairedHostHome()
  await purgePairingState({ serverUrl: SERVER, homeDir })
  const again = await purgePairingState({ serverUrl: SERVER, homeDir })
  assert.deepEqual(again.removed, [])
  assert.equal(again.hostOnly, false)
})

test('purgePairingState：从未配过对的目录不会凭空创建', async () => {
  const homeDir = await home()
  const result = await purgePairingState({ serverUrl: SERVER, homeDir })
  assert.deepEqual(result.removed, [])
  assert.equal(await exists(serverStateDir({ serverUrl: SERVER, homeDir })), false)
})
