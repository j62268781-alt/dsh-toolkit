/** Register a route in its owning module's effect scope. */
export function registerRoute(ctx, route) {
  if (typeof ctx.webServer?.register !== 'function') {
    throw new Error('dsh-toolkit: route registration requires webServer')
  }
  return ctx.effect(() => {
    const registered = ctx.webServer.register(route)
    // Cordis awaits async setup before disposal, including teardown during setup.
    return registered && typeof registered.then === 'function'
      ? Promise.resolve(registered).then(once)
      : once(registered)
  }, `web route ${route.kind} ${route.path}`)
}

/** Ordinary HTTP routes always use the host's identity and origin policy. */
export function registerAuthenticatedRoute(ctx, route) {
  if (typeof ctx.connection?.requestRejection !== 'function') {
    throw new Error('dsh-toolkit: authenticated route registration requires connection.requestRejection')
  }
  return registerRoute(ctx, {
    ...route,
    handler(req, res) {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      return route.handler(req, res)
    },
  })
}

function once(dispose) {
  if (typeof dispose !== 'function') return undefined
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    return dispose()
  }
}
