/** JSON request construction and diagnostics, without retries. */

/** What the adapters actually read from a response; kept narrow so a fake is easy to build. */
export interface JsonResponse {
  ok: boolean
  status: number
  headers: any
  json(): Promise<any>
}

/**
 * Default deadline. Without one, a route that never answers leaves the caller's
 * `finally` unrun forever: the UI keeps `loading`/`busy` true and every button
 * that awaits this call stays disabled ("the buttons are just dead now").
 */
export const DEFAULT_TIMEOUT_MS = 15_000

export interface FetchJsonOptions {
  /** Sent as the JSON body with `content-type: application/json`. */
  json?: unknown
  /** Whole-request deadline in ms; `0` disables it. Callers cancel with `signal`. */
  timeoutMs?: number
  [option: string]: any
}

/** Combine the caller's signal with the deadline; degrade to the caller's signal. */
function withDeadline(timeoutMs: number, signal: AbortSignal | undefined): AbortSignal | undefined {
  // `typeof AbortSignal.timeout` 在 AbortSignal 整个不存在时会抛 ReferenceError（vm 沙箱、
  // 老 WebView 都这样），那样每个请求都会死在构造阶段 —— 宁可不加截止时间也要把请求发出去。
  if (!(timeoutMs > 0) || typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') return signal
  const deadline = AbortSignal.timeout(timeoutMs)
  if (signal === undefined) return deadline
  if (typeof AbortSignal.any !== 'function') return signal
  return AbortSignal.any([signal, deadline])
}

export async function fetchJson(url: string, { json, timeoutMs = DEFAULT_TIMEOUT_MS, ...options }: FetchJsonOptions = {}): Promise<JsonResponse> {
  const headers = new Headers(options.headers)
  if (json !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(url, {
    credentials: 'same-origin', cache: 'no-store', ...options,
    signal: withDeadline(timeoutMs, options.signal),
    headers: Object.fromEntries(headers),
    // `json` 意味着有请求体，而 fetch 默认 GET —— 浏览器在发请求前就抛
    // "Request with GET/HEAD method cannot have body"。调用方没写 method 时按 POST 补齐，
    // 该行为在 fetchJson 这一层收口，免得每个「忘了写 method」的调用点各炸一次。
    ...(json === undefined ? {} : { method: options.method ?? 'POST', body: JSON.stringify(json) }),
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
