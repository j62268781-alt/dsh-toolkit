import { NAME as NS } from '../host/identity.js'
import { fetchJson } from '../../../client/http.js'

const bareRowId = (entryId) => String(entryId).replace(/^include:/, '').replace(/^[a-z-]+:/i, '')

const postJson = (path, json, signal) => fetchJson(`/${NS}/${path}`, {
  method: 'POST', json, ...(signal === undefined ? {} : { signal }),
})

/** Send a profile row command; callers apply the outcome or roll back optimistic state. */
export const sendRowOp = async (op) => {
  const payload = { ...op, entryId: bareRowId(op.entryId) }
  if (typeof fetch !== 'function') return { ok: false, reason: '当前环境没有 fetch' }
  try {
    const response = await postJson('rows', payload)
    if (response.status === 404 || response.status === 405) {
      return { ok: false, reason: '这个 Host 没有行命令路由（Host 侧改动需要重启一次 DSH）' }
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: '请求未被信任（请从 DSH 面板里操作）' }
    }
    if (!response.ok) {
      let reason = `HTTP ${String(response.status)}`
      try {
        const body = await response.json()
        if (typeof body?.reason === 'string' && body.reason !== '') reason = body.reason
      } catch { /* keep the status code */ }
      return { ok: false, reason }
    }
    const result = await response.json()
    if (result?.ok === true) {
      return { ok: true, reason: '', servers: Array.isArray(result.servers) ? result.servers : null }
    }
    return { ok: false, reason: String(result?.reason ?? '写入失败') }
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
}

/** Send a skill write through the Host route and return its outcome. */
export const sendSkillWrite = async (request) => {
  if (typeof fetch !== 'function') return { ok: false, reason: '当前环境没有 fetch' }
  try {
    const response = await postJson('skills', request)
    if (response.status === 404 || response.status === 405) {
      return { ok: false, reason: '这个 Host 没有技能写入路由（Host 侧改动需要重启一次 DSH）' }
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: '请求未被信任（请从 DSH 面板里操作）' }
    }
    if (!response.ok) {
      let reason = `HTTP ${String(response.status)}`
      try {
        const body = await response.json()
        if (typeof body?.reason === 'string' && body.reason !== '') reason = body.reason
      } catch { /* keep the status code */ }
      return { ok: false, reason }
    }
    const result = await response.json()
    if (result?.ok === true) return { ok: true, reason: '' }
    return { ok: false, reason: String(result?.reason ?? '写入失败') }
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
}

/** Read one skill body (GET; only files the Host's scan found are readable). */
export const readSkillBody = async (path, { signal } = {}) => {
  if (typeof fetch !== 'function') return { ok: false, reason: '当前环境没有 fetch' }
  if (typeof path !== 'string' || path === '') return { ok: false, reason: '没有文件路径' }
  try {
    const response = await fetchJson(`/${NS}/skill?path=${encodeURIComponent(path)}`, { signal })
    if (response.status === 404 || response.status === 405) {
      return { ok: false, reason: '这个 Host 没有技能读取路由（Host 侧改动需要重启一次 DSH）' }
    }
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
    return await response.json()
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
}

/** Run one reconnect command; the response is the outcome. */
export const sendReconnect = async ({ tier, serverName, scope }) => {
  if (typeof fetch !== 'function') return { ok: false, reason: '当前环境没有 fetch' }
  try {
    const response = await postJson('reconnect', { tier, serverName, scope })
    if (response.status === 404 || response.status === 405) {
      return { ok: false, reason: '这个 Host 没有重连路由（Host 侧改动需要重启一次 DSH）' }
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: '请求未被信任（请从 DSH 面板里操作）' }
    }
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
    return await response.json()
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
}

/** Ask the Host to scan one external tool's MCP config files. */
export const scanImport = async ({ source, scope, project, signal }) => {
  if (typeof fetch !== 'function') return { ok: false, files: [], servers: [], error: '当前环境没有 fetch' }
  try {
    const response = await postJson('import', { source, scope, project }, signal)
    if (response.status === 404 || response.status === 405) {
      return { ok: false, files: [], servers: [], error: '这个 Host 没有导入扫描路由（Host 侧改动需要重启一次 DSH）' }
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, files: [], servers: [], error: '请求未被信任（请从 DSH 面板里操作）' }
    }
    if (!response.ok) return { ok: false, files: [], servers: [], error: `HTTP ${response.status}` }
    return await response.json()
  } catch (error) {
    return { ok: false, files: [], servers: [], error: String(error?.message ?? error) }
  }
}

/** OAuth returns the authorization URL or outcome directly; failures remain renderable. */
export const sendOAuth = async ({ action, serverName }) => {
  if (typeof fetch !== 'function') return { ok: false, reason: '当前环境没有 fetch，无法发起授权' }
  try {
    const response = await postJson('oauth', { action, serverName })
    if (response.status === 404 || response.status === 405) {
      return { ok: false, reason: '这个 Host 版本没有 OAuth 通道（Host 侧改动需要重启一次 DSH）' }
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: '请求未被信任（请从 DSH 面板里操作）' }
    }
    if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` }
    const result = await response.json()
    return result !== null && typeof result === 'object' ? result : { ok: false, reason: '响应格式无效' }
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) }
  }
}
