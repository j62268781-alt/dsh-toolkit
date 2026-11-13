/** JSON request construction and diagnostics, without retries or a global timeout. */

/** What the adapters actually read from a response; kept narrow so a fake is easy to build. */
export interface JsonResponse {
  ok: boolean
  status: number
  headers: any
  json(): Promise<any>
}

export interface FetchJsonOptions {
  /** Sent as the JSON body with `content-type: application/json`. */
  json?: unknown
  [option: string]: any
}

export async function fetchJson(url: string, { json, ...options }: FetchJsonOptions = {}): Promise<JsonResponse> {
  const headers = new Headers(options.headers)
  if (json !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(url, {
    credentials: 'same-origin', cache: 'no-store', ...options,
    headers: Object.fromEntries(headers),
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  })
  // Parse lazily so adapters can handle admission/missing-route statuses before reading a body.
  let parsed: Promise<any> | undefined
  return {
    ok: response.ok, status: response.status, headers: response.headers,
    json() {
      parsed ??= (async () => {
        if (typeof response.text !== 'function') return response.json()
        const text = await response.text()
        if (text === '') return {}
        try { return JSON.parse(text) } catch {
          const error: any = new Error(`HTTP ${response.status} 返回了非 JSON：${text.slice(0, 200)}`)
          error.status = response.status
          error.bodyPreview = text.slice(0, 200)
          throw error
        }
      })()
      return parsed
    },
  }
}
