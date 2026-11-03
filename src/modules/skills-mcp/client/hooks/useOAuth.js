import { sendOAuth } from '../commands.js'

/** Keep per-server authorization results and pending/copy state local to this panel. */
export function useOAuth(React, projection) {
  const { useState } = React
  const oauthState = projection ?? {}
  const oauthServers = projection?.servers ?? {}
  const [oauthResult, setOauthResult] = useState({})
  const [oauthPending, setOauthPending] = useState('')
  const [copiedUrlFor, setCopiedUrlFor] = useState('')
  const oauthServerState = (serverName) => {
    const entry = oauthServers[serverName]
    return entry !== null && typeof entry === 'object' ? entry : {}
  }
  // A URL returned by this panel's last command is newer than the projection.
  const authorizeUrlFor = (serverName) => {
    const local = String(oauthResult[serverName]?.authorizeUrl ?? '')
    if (local !== '') return local
    return String(oauthServerState(serverName).authorizeUrl ?? '')
  }
  const oauthFailureFor = (serverName) => {
    const result = oauthResult[serverName]
    if (result === undefined || result === null) return ''
    if (result.ok === true) return ''
    const reason = String(result.reason ?? '')
    const detail = String(result.detail ?? '')
    if (detail !== '' && detail !== reason) return `${reason === '' ? '授权失败' : reason}：${detail}`
    return reason === '' ? '授权失败' : reason
  }
  const startOAuth = async (serverName) => {
    if (oauthPending !== '') return
    setOauthPending(serverName)
    setCopiedUrlFor('')
    try {
      const result = await sendOAuth({ action: 'authorize', serverName })
      setOauthResult((previous) => ({ ...previous, [serverName]: result }))
    } finally {
      setOauthPending('')
    }
  }
  const revokeOAuth = async (serverName) => {
    if (oauthPending !== '') return
    setOauthPending(serverName)
    try {
      const result = await sendOAuth({ action: 'logout', serverName })
      setOauthResult((previous) => ({ ...previous, [serverName]: result }))
    } finally {
      setOauthPending('')
    }
  }
  const copyAuthorizeUrl = (serverName) => {
    const url = authorizeUrlFor(serverName)
    if (url === '') return
    try {
      void navigator.clipboard?.writeText?.(url)
      setCopiedUrlFor(serverName)
    } catch {
      // The adjacent input remains selectable when the clipboard is unavailable.
      setCopiedUrlFor('')
    }
  }
  return {
    oauthState, oauthPending, copiedUrlFor, oauthServerState, authorizeUrlFor,
    oauthFailureFor, startOAuth, revokeOAuth, copyAuthorizeUrl,
  }
}
