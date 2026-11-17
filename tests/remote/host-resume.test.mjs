/**
 * 启动期恢复手机连接。
 *
 * 真机回归（2026-11-17）：这台桌面端明明配过对（trusted-peers 里有手机），重启 DSH 之后
 * 到配对服务器的 ws 一直没建立；只有打开面板之后才「像是连上了」。上游只在 start() 里
 * （且 hostControl !== false）拉起 ws，扫码配对的主机重启后没有任何人再去连——
 * 面板那几条 host.pairing.status / status 全是只读的，帮不上忙。
 * 这里锁住「读本地快照 → 按需 reconnect → 不瞎连」这套判断。
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply } from '../../src/modules/remote/host/index.ts'
import { serverStateDir } from '../../src/modules/remote/host/mobile/local-state.ts'
import { createStartupResume, decideStartupResume, hasLocalBinding } from '../../src/modules/remote/host/mobile/resume.ts'

const SERVER = 'https://129.204.29.215:16666'

async function home() {
  return mkdtemp(join(tmpdir(), 'dsh-remote-resume-'))
}

/** 造一份「配过对」的 host 目录：scope 目录名是 serverUrl 的 sha256 前 24 位。 */
async function pairedHome({ peers = true } = {}) {
  const homeDir = await home()
  const dir = serverStateDir({ serverUrl: SERVER, homeDir })
  await mkdir(join(dir, 'host'), { recursive: true })
  await writeFile(join(dir, 'host', 'pairing-host-only.json'), '{"hostOnly":true}')
  await writeFile(
    join(dir, 'host', 'trusted-peers.json'),
    JSON.stringify({
      schemaVersion: 1,
      peers: peers ? [{ deviceId: 'phone-1', name: 'DSH App (Android)', trustedAt: 1 }] : [],
    }),
  )
  return { homeDir, dir }
}

test('decideStartupResume：只在该连的时候连', () => {
  const status = (extra = {}) => ({ configured: true, online: false, authorized: false, pairingHostOnly: true, ...extra })
  assert.deepEqual(decideStartupResume(status(), true), { action: 'connect' })
  assert.deepEqual(decideStartupResume(status(), false), { action: 'skip', reason: 'no-binding' })
  assert.deepEqual(decideStartupResume(status({ online: true }), true), { action: 'skip', reason: 'online' })
  assert.deepEqual(decideStartupResume(status({ configured: false }), true), { action: 'skip', reason: 'not-configured' })
  // authorized 不参与判断：扫码配对的主机本身没有账号授权，拿它当门槛反而永远不连。
  assert.deepEqual(decideStartupResume(status({ authorized: false }), true), { action: 'connect' })
})

test('hasLocalBinding：认得到本机快照，认不到别的服务地址', async () => {
  const { homeDir } = await pairedHome()
  const service = { config: { serverUrl: SERVER } }
  assert.equal(await hasLocalBinding({ service, homeDir }), true)

  // 换一个服务地址就是另一个 scope 目录，等于「这台机器没配过对」。
  assert.equal(await hasLocalBinding({ service: { config: { serverUrl: 'https://dsh.r2049.cn' } }, homeDir }), false)
  // 没配 serverUrl：上游也不会建 serverApi，直接不连。
  assert.equal(await hasLocalBinding({ service: {}, homeDir }), false)
  // 非法地址（serverScope 会抛 400）不能把开机流程整挂。
  assert.equal(await hasLocalBinding({ service: { config: { serverUrl: 'not a url' } }, homeDir }), false)
})

test('hasLocalBinding：只有 trusted-peers 也算绑定过', async () => {
  const { homeDir } = await pairedHome()
  const dir = serverStateDir({ serverUrl: SERVER, homeDir })
  // 没有 pairing-host-only.json 的普通安装：靠可信设备清单识别。
  await writeFile(join(dir, 'host', 'pairing-host-only.json'), '{"hostOnly":false}')
  assert.equal(await hasLocalBinding({ service: { config: { serverUrl: SERVER } }, homeDir }), true)

  const empty = await pairedHome({ peers: false })
  await writeFile(join(empty.dir, 'host', 'pairing-host-only.json'), '{"hostOnly":false}')
  assert.equal(await hasLocalBinding({ service: { config: { serverUrl: SERVER } }, homeDir: empty.homeDir }), false)
})

/** 假的等待：立刻返回，测试不等真定时器。 */
const instant = async () => {}

test('createStartupResume：已在线上时不发 reconnect', async () => {
  const calls = []
  const logs = []
  const resume = createStartupResume({
    service: { hostStatus: () => ({ configured: true, online: true }), reconnectHost: () => calls.push('reconnect') },
    hasBinding: () => true,
    log: (level, message) => logs.push([level, message]),
    wait: instant,
  })
  assert.equal(await resume.run(), 'online')
  assert.deepEqual(calls, [])
  assert.match(logs[0][1], /已在线上/)
})

test('createStartupResume：没绑定过就什么都不做', async () => {
  const calls = []
  const resume = createStartupResume({
    service: { hostStatus: () => ({ configured: true, online: false }), reconnectHost: () => calls.push('reconnect') },
    hasBinding: () => false,
    wait: instant,
  })
  assert.equal(await resume.run(), 'no-binding')
  assert.deepEqual(calls, [])
})

test('createStartupResume：没配服务地址就不连（上游也没建 serverConnection）', async () => {
  const calls = []
  const resume = createStartupResume({
    service: { hostStatus: () => ({ configured: false, online: false }), reconnectHost: () => calls.push('reconnect') },
    hasBinding: () => true,
    wait: instant,
  })
  assert.equal(await resume.run(), 'not-configured')
  assert.deepEqual(calls, [])
})

test('createStartupResume：连上之后报 connected，并且只连一次', async () => {
  const calls = []
  let online = false
  const resume = createStartupResume({
    service: {
      hostStatus: () => ({ configured: true, online }),
      reconnectHost: () => {
        calls.push('reconnect')
        online = true
      },
    },
    hasBinding: () => true,
    wait: instant,
  })
  assert.equal(await resume.run(), 'connected')
  assert.equal(calls.length, 1)
})

test('createStartupResume：上游还没建好连接对象时等下一拍再试', async () => {
  const calls = []
  let online = false
  const resume = createStartupResume({
    service: {
      hostStatus: () => ({ configured: true, online }),
      reconnectHost: () => {
        calls.push('reconnect')
        if (calls.length === 1) {
          const error = new Error('Configure serverUrl before reconnecting.')
          error.code = 'SERVER_NOT_CONFIGURED'
          throw error
        }
        online = true
      },
    },
    hasBinding: () => true,
    delays: [1, 1, 1],
    wait: instant,
  })
  assert.equal(await resume.run(), 'connected')
  assert.equal(calls.length, 2)
})

test('createStartupResume：连不上就重试两次然后放弃（记 warn，不无限重连）', async () => {
  const calls = []
  const logs = []
  const resume = createStartupResume({
    service: {
      hostStatus: () => ({ configured: true, online: false, error: 'HELLO_TIMEOUT' }),
      reconnectHost: () => calls.push('reconnect'),
    },
    hasBinding: () => true,
    delays: [1, 2, 3, 4, 5],
    maxConnects: 2,
    log: (level, message) => logs.push([level, message]),
    wait: instant,
  })
  assert.equal(await resume.run(), 'gave-up')
  assert.equal(calls.length, 2)
  assert.ok(logs.some(([level, message]) => level === 'warn' && /未能恢复手机连接/.test(message)))
  assert.ok(logs.some(([, message]) => /HELLO_TIMEOUT/.test(message)), '上游错误码要出现在日志里，否则没人能查')
})

test('createStartupResume：reconnectHost 抛别的错就收手', async () => {
  const resume = createStartupResume({
    service: {
      hostStatus: () => ({ configured: true, online: false }),
      reconnectHost: () => {
        throw new Error('remote runtime is closed')
      },
    },
    hasBinding: () => true,
    wait: instant,
  })
  assert.equal(await resume.run(), 'error')
})

test('createStartupResume：dispose 之后不再发请求', async () => {
  let release
  const calls = []
  const resume = createStartupResume({
    service: { hostStatus: () => ({ configured: true, online: false }), reconnectHost: () => calls.push('reconnect') },
    hasBinding: () => true,
    wait: () => new Promise((resolve) => { release = resolve }),
  })
  resume.begin()
  // begin() 幂等：重复调用不会开出第二份检查。
  resume.begin()
  await Promise.resolve()
  resume.dispose()
  release()
  assert.equal(await resume.run(), 'disposed')
  assert.deepEqual(calls, [])
})

test('apply：即使宿主没有 webServer，也会去订阅 dshRemote 做启动检查', () => {
  const registered = []
  const effects = []
  const ctx = {
    inject: (services, callback) => registered.push([services, callback]),
    effect: (fn) => effects.push(fn),
    logger: () => ({ info: () => {}, warn: () => {} }),
  }
  // 没有 webServer / connection：apply 会提前返回，但启动检查必须已经挂上了。
  apply(ctx, {})
  assert.deepEqual(registered.map(([services]) => services), [['dshRemote']])

  const disposers = []
  const [, callback] = registered[0]
  callback({
    dshRemote: { hostStatus: () => ({ configured: true, online: true }), reconnectHost: () => {} },
    effect: (fn) => disposers.push(fn()),
    logger: () => ({ info: () => {}, warn: () => {} }),
  })
  assert.equal(typeof disposers[0], 'function', 'effect 要返回 disposer，插件卸载时收掉定时器')
  disposers[0]()
})
