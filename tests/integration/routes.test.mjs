import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { registerRoute, registerAuthenticatedRoute } from '../../src/host/routes.js'

function host(register, connection) {
  const ctx = new Context()
  ctx.provide('webServer', { register })
  if (connection) ctx.provide('connection', connection)
  return ctx
}

const route = handler => ({ kind: 'exact', path: '/toolkit-test', handler })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Use the actual host lifecycle: mock effects would miss setup/teardown races.
test('route belongs to its module, supports explicit cleanup, and can reload', async () => {
  const mounted = new Map()
  let cleanups = 0
  const ctx = host(value => {
    const key = `${value.kind}:${value.path}`
    assert.equal(mounted.has(key), false, 'a reload must not leave a duplicate route')
    mounted.set(key, value)
    return () => { cleanups++; mounted.delete(key) }
  })
  let dispose
  const plugin = child => { dispose = registerRoute(child, route(() => {})) }
  const first = ctx.plugin(plugin)
  await first
  assert.equal(mounted.size, 1)
  await dispose()
  await dispose()
  assert.equal(cleanups, 1)
  await first.dispose()
  assert.equal(cleanups, 1)
  const second = ctx.plugin(plugin)
  await second
  assert.equal(mounted.size, 1)
  await second.dispose()
  assert.equal(mounted.size, 0)
  assert.equal(cleanups, 2)
})

test('unload during async registration waits for and removes the late route once', async () => {
  const registration = deferred()
  let cleanups = 0
  let dispose
  const ctx = host(() => registration.promise)
  const fiber = ctx.plugin(child => { dispose = registerRoute(child, route(() => {})) })
  await fiber
  const closing = fiber.dispose()
  registration.resolve(() => { cleanups++ })
  await closing
  await dispose()
  assert.equal(cleanups, 1)
})

test('module disposal waits for an async route disposer', async () => {
  const cleanup = deferred()
  let calls = 0, closed = false
  const ctx = host(() => () => { calls++; return cleanup.promise })
  const fiber = ctx.plugin(child => { registerRoute(child, route(() => {})) })
  await fiber
  const closing = fiber.dispose().then(() => { closed = true })
  await Promise.resolve()
  assert.equal(calls, 1)
  assert.equal(closed, false)
  cleanup.resolve()
  await closing
  assert.equal(closed, true)
})

test('async registration failure is reported during cleanup without leaking an effect', async () => {
  const registration = deferred()
  const failure = new Error('async route registration failed')
  const ctx = host(() => registration.promise)
  let dispose
  const fiber = ctx.plugin(child => { dispose = registerRoute(child, route(() => {})) })
  await fiber
  const closing = dispose()
  registration.reject(failure)
  await assert.rejects(closing, error => error === failure)
  await fiber.dispose()
})

test('missing registration disposer is supported', async () => {
  for (const result of [undefined, Promise.resolve(undefined)]) {
    const ctx = host(() => result)
    const fiber = ctx.plugin(child => { registerRoute(child, route(() => {})) })
    await fiber
    await fiber.dispose()
  }
})

test('registration errors are surfaced by the owning effect', () => {
  const failure = new Error('duplicate route')
  const ctx = host(() => { throw failure })
  assert.throws(() => registerRoute(ctx, route(() => {})), error => error === failure)
})

test('authenticated routes reject before business and preserve host request binding', async () => {
  let mounted, calls = 0, rejection
  const request = { headers: {} }
  const connection = {
    requestRejection(req) {
      assert.equal(req, request)
      assert.equal(this.requestRejection, connection.requestRejection)
      return rejection
    },
  }
  const ctx = host(value => { mounted = value }, connection)
  const fiber = ctx.plugin(child => {
    registerAuthenticatedRoute(child, route(async (req, res) => {
      calls++
      res.statusCode = 202
      res.end('accepted')
      return 'business-result'
    }))
  })
  await fiber
  for (const status of [401, 403]) {
    rejection = status
    const response = { end(body) { this.body = body; this.ended = true } }
    await mounted.handler(request, response)
    assert.equal(response.statusCode, status)
    assert.equal(response.ended, true)
    assert.equal(response.body, undefined)
  }
  assert.equal(calls, 0)
  rejection = undefined
  const response = { end(body) { this.body = body } }
  assert.equal(await mounted.handler(request, response), 'business-result')
  assert.equal(calls, 1)
  assert.equal(response.statusCode, 202)
  assert.equal(response.body, 'accepted')
  await fiber.dispose()
})

test('a failing host guard never enters the business handler', async () => {
  let mounted, calls = 0
  const failure = new Error('identity service unavailable')
  const ctx = host(value => { mounted = value }, {
    requestRejection() { throw failure },
  })
  const fiber = ctx.plugin(child => {
    registerAuthenticatedRoute(child, route(() => { calls++ }))
  })
  await fiber
  assert.throws(() => mounted.handler({}, {}), error => error === failure)
  assert.equal(calls, 0)
  await fiber.dispose()
})

test('missing host dependencies fail closed before registering', () => {
  let registrations = 0
  const ctx = host(() => { registrations++ })
  assert.throws(() => registerAuthenticatedRoute(ctx, route(() => {})), /requires connection\.requestRejection/)
  assert.equal(registrations, 0)
  assert.throws(() => registerRoute(new Context(), route(() => {})), /requires webServer/)
})

test('state-protected routes can use base registration without a session guard', async () => {
  let mounted
  const ctx = host(value => { mounted = value })
  const fiber = ctx.plugin(child => { registerRoute(child, route(() => 'state-checked')) })
  await fiber
  assert.equal(mounted.handler(), 'state-checked')
  await fiber.dispose()
})
