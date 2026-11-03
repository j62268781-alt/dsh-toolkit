/**
 * Regression test for the live mount wiring of the usage Host half.
 *
 * The root entry mounts every module as a child plugin. `src/index.js` must wrap
 * the usage namespace in `configuredPlugin()` (like Skills & MCP): the root
 * Config already validated `usage`, and its resolved value carries
 * `Volatile`-wrapped leaves. Mounting the bare namespace makes Cordis validate
 * that resolved value against the child's own `Config` schema, which fails with
 * "invalid config: $.budget expected number but got [object Object]" — the
 * plugin then never applies and its snapshot route is missing at runtime while
 * every sibling module still works (exactly the bug observed live).
 *
 * This test therefore drives the *built* artifact the way the root entry does
 * and asserts the route is registered and serves a snapshot.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Config as RootConfig } from '../../lib/host/config.js'
import { configuredPlugin } from '../../lib/host/plugins.js'
import * as usage from '../../lib/modules/usage/host/index.js'

const SNAPSHOT_PATH = '/_dsh/dsh-toolkit/usage/snapshot'

function responseStub() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { res.headers[String(name).toLowerCase()] = value },
    end(body) { res.body = body; return res },
  }
  return res
}

async function bootWithRootConfig(t, { wrap }) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-usage-wiring-'))
  // resolveDshHome() only prefers DSH_HOME when it actually has a sessions dir.
  await mkdir(join(home, 'sessions'), { recursive: true })
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(async () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  })

  const mounted = new Map()
  const ctx = new Context()
  const disposers = [
    ctx.provide('webServer', {
      register(route) {
        mounted.set(route.path, route)
        return () => mounted.delete(route.path)
      },
    }),
    ctx.provide('sessions', { list: () => [] }),
    ctx.provide('connection', { requestRejection: () => undefined }),
  ]
  t.after(() => { for (const dispose of disposers) dispose() })

  // The exact value the root entry passes to `ctx.plugin(Usage, config.usage)`.
  const { usage: resolvedUsage } = RootConfig({})
  const plugin = wrap ? configuredPlugin(usage) : usage
  const fiber = ctx.plugin(plugin, resolvedUsage)
  t.after(() => fiber.dispose())
  try {
    await fiber
  } catch {
    // An invalid-config child plugin rejects; the assertions below decide.
  }
  // Deferred effects (route registration) settle on a later microtask.
  await new Promise((resolve) => setTimeout(resolve, 10))
  return { mounted, route: mounted.get(SNAPSHOT_PATH), resolvedUsage }
}

test('the root entry wiring mounts usage with the resolved volatile config and registers its route', async (t) => {
  const { route, resolvedUsage } = await bootWithRootConfig(t, { wrap: true })
  // The parent-resolved config really contains volatile wrappers — this is the
  // shape that used to break validation.
  assert.equal(typeof resolvedUsage?.budget?.get, 'function')
  assert.ok(route, `expected ${SNAPSHOT_PATH} to be registered by the wrapped child plugin`)

  const res = responseStub()
  await route.handler({ method: 'GET', headers: {} }, res)
  assert.equal(res.statusCode, 200)
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  // readUsageConfig() unwraps the volatile fields, so defaults must survive.
  assert.equal(payload.budget.amount, 100)
  assert.equal(payload.budget.currency, 'CNY')
  assert.equal(payload.sessionCount, 0)
})

test('mounting the bare namespace with the resolved config is rejected (why the wrapper is required)', async (t) => {
  const { route } = await bootWithRootConfig(t, { wrap: false })
  assert.equal(route, undefined, 'without configuredPlugin the child never applies')
})
