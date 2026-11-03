/** JSON request construction and diagnostics, without retries or a global timeout. */
export async function fetchJson(url, { json, ...options } = {}) {
  const headers = new Headers(options.headers)
  if (json !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(url, {
    credentials: 'same-origin', cache: 'no-store', ...options,
    headers: Object.fromEntries(headers),
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  })
  // Parse lazily so adapters can handle admission/missing-route statuses before reading a body.
  let parsed
  return {
    ok: response.ok, status: response.status, headers: response.headers,
    json() {
      parsed ??= (async () => {
        if (typeof response.text !== 'function') return response.json()
        const text = await response.text()
        if (text === '') return {}
        try { return JSON.parse(text) } catch {
          const error = new Error(`HTTP ${response.status} 返回了非 JSON：${text.slice(0, 200)}`)
          error.status = response.status
          error.bodyPreview = text.slice(0, 200)
          throw error
        }
      })()
      return parsed
    },
  }
}
