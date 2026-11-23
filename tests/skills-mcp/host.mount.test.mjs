import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import * as host from '../../src/modules/skills-mcp/host/index.js'

for (const alpha of [false, true]) {
  test(`Skills/MCP Host mounts and reports scope (${alpha ? 'symbol root' : 'native Context'})`, async (t) => {
    const home = await mkdtemp(join(tmpdir(), 'smp-host-'))
    const { DSH_HOME, DSH_AGENTS_HOME } = process.env
    process.env.DSH_HOME = process.env.DSH_AGENTS_HOME = home
    t.after(async () => {
      for (const [key, value] of Object.entries({ DSH_HOME, DSH_AGENTS_HOME })) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await rm(home, { recursive: true, force: true })
    })

    const root = new Context()
    root.provide('loader', { entries: () => [] })
    const plugin = alpha ? {
      ...host,
      apply(ctx, config) {
        host.apply(new Proxy(ctx, {
          get(target, key) {
            if (key === Symbol.for('cordis.root')) return root
            if (key === 'root') throw new Error('cannot get property "root" without inject')
            return Reflect.get(target, key)
          },
        }), config)
      },
    } : host
    const fiber = root.plugin(plugin, {})
    try {
      await fiber.await()
      // The first reconcile and skill scan can overlap writes; allow one more scan (5 s).
      let heartbeat
      const deadline = Date.now() + 7000
      while (Date.now() < deadline) {
        try {
          heartbeat = JSON.parse(await readFile(join(home, 'dsh-toolkit-skills-mcp.heartbeat.json'), 'utf8'))
          if (heartbeat.rootScope === true && heartbeat.discovery.at) break
        } catch (error) {
          if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
        }
        await delay(10)
      }
      assert.equal(heartbeat?.rootScope, true)
      assert.equal(heartbeat.mounted, 0)
      assert.ok(heartbeat.discovery.at)
    } finally {
      await fiber.dispose()
    }
  })
}
