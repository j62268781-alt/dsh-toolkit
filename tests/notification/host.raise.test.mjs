/**
 * 提窗端口与路由测试。
 *
 * 「点击系统通知 → 把桌面端窗口提到前台」在 Windows 上只能靠「再启动一次本应用」，
 * 让主实例走 second-instance → focusPrimaryWindow。这里锁住三个关键契约：
 * 非桌面壳不启动、启动时必须摘掉 ELECTRON_RUN_AS_NODE、路由只接受 POST 且不把
 * 内部错误泄漏给渲染进程。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RAISE_PATH, registerRaiseRoute } from '../../src/modules/notification/host/index.js'
import { raiseWindow } from '../../src/modules/notification/host/raise.js'

/** 记录启动参数的 spawn 替身。 */
function createSpawnSpy({ throws = false } = {}) {
  const launches = []
  return {
    launches,
    spawnProcess(execPath, args, options) {
      launches.push({ execPath, args, options })
      if (throws) throw new Error('spawn failed')
      return { unref() { launches[launches.length - 1].unrefd = true } }
    },
  }
}

test('raiseWindow：桌面壳里启动同一个 exe，并摘掉 ELECTRON_RUN_AS_NODE', () => {
  const spy = createSpawnSpy()
  const raised = raiseWindow({
    spawnProcess: spy.spawnProcess,
    execPath: 'D:\\软件\\deepseek\\DeepSeek Harness.exe',
    versions: { electron: '44.7.0', node: '24.21.0' },
    env: { ELECTRON_RUN_AS_NODE: '1', PATH: 'C:\\Windows' },
  })
  assert.equal(raised, true)
  assert.equal(spy.launches.length, 1)
  const [launch] = spy.launches
  assert.equal(launch.execPath, 'D:\\软件\\deepseek\\DeepSeek Harness.exe')
  assert.deepEqual(launch.args, [])
  // 带着 ELECTRON_RUN_AS_NODE 再启动等于跑一个空 Node 脚本，窗口永远不会被提起来。
  assert.equal('ELECTRON_RUN_AS_NODE' in launch.options.env, false)
  assert.equal(launch.options.env.PATH, 'C:\\Windows')
  assert.equal(launch.options.detached, true)
  assert.equal(launch.options.stdio, 'ignore')
  assert.equal(launch.unrefd, true, '不能拖住宿主退出')
})

test('raiseWindow：纯 node 部署（无 electron 版本）直接跳过，不启动进程', () => {
  const spy = createSpawnSpy()
  assert.equal(raiseWindow({ spawnProcess: spy.spawnProcess, versions: { node: '24.21.0' }, env: {} }), false)
  assert.deepEqual(spy.launches, [])
})

test('raiseWindow：启动失败只返回 false，不抛给调用方', () => {
  const spy = createSpawnSpy({ throws: true })
  assert.equal(raiseWindow({
    spawnProcess: spy.spawnProcess,
    versions: { electron: '44.7.0' },
    env: {},
  }), false)
})

test('提窗路由：只接受 POST，走共享鉴权，不支持时如实返回 unsupported', async () => {
  const routes = [], disposals = []
  const ctx = {
    effect(fn) { disposals.push(fn()) },
    webServer: { register(route) { routes.push(route); return () => {} } },
    connection: { requestRejection() { return rejection } },
  }
  let rejection
  const spy = createSpawnSpy()
  registerRaiseRoute(ctx, {
    spawnProcess: spy.spawnProcess,
    versions: { electron: '44.7.0' },
    env: {},
  })
  assert.deepEqual(routes.map(({ path: pathname, kind }) => [pathname, kind]), [[RAISE_PATH, 'exact']])

  async function request(method) {
    const res = {
      statusCode: 200, headers: {}, body: undefined,
      setHeader(name, value) { this.headers[name] = value },
      end(value) { this.body = value },
    }
    await routes[0].handler({ method, url: RAISE_PATH }, res)
    return res
  }

  rejection = 401
  const denied = await request('POST')
  assert.equal(denied.statusCode, 401)
  assert.equal(spy.launches.length, 0, '未鉴权时绝不能启动进程')

  rejection = undefined
  assert.equal((await request('GET')).statusCode, 404, 'GET 会被预取/缓存命中，等于用户没点也提窗')
  assert.equal(spy.launches.length, 0)

  const raised = await request('POST')
  assert.equal(raised.statusCode, 200)
  assert.equal(JSON.parse(raised.body).ok, true)
  assert.equal(spy.launches.length, 1)

  // 非桌面壳（浏览器部署）如实回 unsupported，而不是假装成功。
  const plainRoutes = []
  registerRaiseRoute({
    effect(fn) { fn() },
    webServer: { register(route) { plainRoutes.push(route); return () => {} } },
    connection: { requestRejection() { return undefined } },
  }, { spawnProcess: spy.spawnProcess, versions: { node: '24.21.0' }, env: {} })
  const res = {
    statusCode: 200, headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { this.body = value },
  }
  await plainRoutes[0].handler({ method: 'POST', url: RAISE_PATH }, res)
  assert.deepEqual(JSON.parse(res.body), { ok: false, reason: 'unsupported' })
  assert.equal(spy.launches.length, 1)

  disposals.forEach((dispose) => dispose())
})
