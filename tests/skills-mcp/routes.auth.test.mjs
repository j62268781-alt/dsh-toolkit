import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { RUNTIME_PATH, registerRuntimeRoute } from '../../src/modules/skills-mcp/host/mcp/runtime.ts'
import { ROWS_PATH, registerRowRoute } from '../../src/modules/skills-mcp/host/mcp/rows.ts'
import { RECONNECT_PATH, registerReconnectRoute } from '../../src/modules/skills-mcp/host/mcp/reconnect.ts'
import { IMPORT_PATH, registerImportRoute } from '../../src/modules/skills-mcp/host/import/route.ts'
import { SKILLS_PATH, registerSkillRoute } from '../../src/modules/skills-mcp/host/skills/route.ts'
import { SKILL_READ_PATH, registerSkillReadRoute } from '../../src/modules/skills-mcp/host/skills/read.ts'
import { OAUTH_PATH, registerOAuthRoute } from '../../src/modules/skills-mcp/host/mcp/oauth/route.ts'

const routes = [
  { path: RUNTIME_PATH, register: (ctx, reject) => registerRuntimeRoute(ctx, reject) },
  { path: ROWS_PATH, register: (ctx, reject) => registerRowRoute(ctx, { schema: reject, apply: reject }) },
  { path: RECONNECT_PATH, register: (ctx, reject) => registerReconnectRoute(ctx, { schema: reject, run: reject }) },
  { path: IMPORT_PATH, register: (ctx, reject) => registerImportRoute(ctx, { schema: reject, scan: reject }) },
  { path: SKILLS_PATH, register: (ctx, reject) => registerSkillRoute(ctx, { schema: reject, apply: reject }) },
  { path: SKILL_READ_PATH, register: (ctx, reject) => registerSkillReadRoute(ctx, { resolve: reject }) },
  { path: OAUTH_PATH, register: (ctx, reject) => registerOAuthRoute(ctx, { schema: reject, run: reject }) },
]

const unexpected = () => assert.fail('a denied request must not parse or run business logic')

for (const entry of routes) {
  test(`${entry.path}: rejects before request parsing and owns exactly one route effect`, async () => {
    for (const rejection of [401, 403]) {
      let route, effects = 0, cleanups = 0, dispose, guardCalls = 0
      const req = Object.defineProperties({}, {
        method: { get: unexpected },
        headers: { get: unexpected },
        url: { get: unexpected },
        [Symbol.asyncIterator]: { get: unexpected },
      })
      const connection = {
        requestRejection(value) {
          assert.equal(this, connection)
          assert.equal(value, req)
          guardCalls++
          return rejection
        },
      }
      const ctx = {
        connection,
        webServer: { register(value) { route = value; return () => { cleanups++ } } },
        effect(setup) { effects++; dispose = setup(); return dispose },
      }
      entry.register(ctx, unexpected)
      assert.equal(effects, 1)
      assert.equal(route.kind, 'exact')
      assert.equal(route.path, entry.path)
      const res = {
        statusCode: 200,
        ended: 0,
        setHeader: unexpected,
        end(body) { assert.equal(body, undefined); this.ended++ },
      }
      await route.handler(req, res)
      assert.equal(guardCalls, 1)
      assert.equal(res.statusCode, rejection)
      assert.equal(res.ended, 1)
      await dispose()
      await dispose()
      assert.equal(cleanups, 1)
    }
  })

  test(`${entry.path}: missing authentication or web server fails before mounting`, () => {
    const effect = () => assert.fail('missing dependencies must not create an effect')
    assert.throws(() => entry.register({ effect }, unexpected), {
      message: 'dsh-toolkit: authenticated route registration requires connection.requestRejection',
    })
    assert.throws(() => entry.register({ effect, connection: {} }, unexpected), {
      message: 'dsh-toolkit: authenticated route registration requires connection.requestRejection',
    })
    assert.throws(() => entry.register({ effect, connection: { requestRejection() {} } }, unexpected), {
      message: 'dsh-toolkit: route registration requires webServer',
    })
  })

  test(`${entry.path}: Cordis mounts only with both dependencies and releases on dependency loss`, async (t) => {
    const ctx = new Context()
    const mounted = new Set()
    let cleanups = 0, injection
    const owner = ctx.plugin(child => {
      injection = child.inject(['webServer', 'connection'], inner => entry.register(inner, unexpected))
    })
    t.after(() => owner.dispose())
    await owner
    await injection
    assert.equal(mounted.size, 0)

    const removeServer = ctx.provide('webServer', {
      register(route) {
        assert.equal(route.path, entry.path)
        mounted.add(route)
        return () => { cleanups++; mounted.delete(route) }
      },
    })
    t.after(removeServer)
    await injection
    assert.equal(mounted.size, 0, 'webServer alone must not mount an unauthenticated route')

    const removeConnection = ctx.provide('connection', { requestRejection() {} })
    await injection
    assert.equal(mounted.size, 1)
    await removeConnection()
    assert.equal(mounted.size, 0)
    assert.equal(cleanups, 1)

    const removeReplacement = ctx.provide('connection', { requestRejection() {} })
    t.after(removeReplacement)
    await injection
    assert.equal(mounted.size, 1)
    await owner.dispose()
    assert.equal(mounted.size, 0)
    assert.equal(cleanups, 2)
  })
}
