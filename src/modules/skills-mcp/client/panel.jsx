import { NAME as NS } from '../host/identity.js'
import { ROOT_ENTRIES } from '../../../client/config.js'
import { snapshotOf, statusOf } from './config.js'
import { filterRow } from './components/filterRow.jsx'
import { tabStrip } from './components/tabs.jsx'
import { pageHead } from './components/head.jsx'
import { matchesName } from './components/filters.js'
import { orderedScopeGroups, scopeKey } from './components/scopeOrder.js'
import { pendingAdds as pendingAddsOf, pendingLabel, settleInflight } from './crud/inflight.js'
import { emptyMcpText, emptySkillText } from './components/sections.js'
import { anchorStyle, measureMenuAnchor, listenMenuDismiss } from './components/menuAnchor.js'
import { useFormSnapshot, useFormRefresh } from './hooks/useFormRefresh.js'
import { useInventory } from './hooks/useInventory.js'
import { useRuntime } from './hooks/useRuntime.js'
import { useOAuth } from './hooks/useOAuth.js'
import { deleteConfirmDialog } from './components/dialog.jsx'
import { skillPreviewDialog } from './components/skillPreview.jsx'
import { skillDialogView } from './components/skillDialog.jsx'
import { dropOptimisticSkill, hideSkillUntilGone, removalTargetOf } from './crud/skills.js'
import { addServerOp, deleteServerOp, draftFromRow, inflightKeyForRow, rowEntryId, toggleServerOp, updateServerOp } from './crud/servers.js'
import panelCss from './styles/panel.css'

import { HINTS } from './components/form.js'
import { CONNECTION_DRAFT_DEFAULTS } from '../host/mcp/connection.js'
import { sendRowOp, sendSkillWrite, readSkillBody, sendReconnect, scanImport } from './commands.js'
import { serverFormView } from './views/serverForm.jsx'
import { importCardView } from './views/importCard.jsx'
import { listCardView } from './views/listCard.jsx'
import { profileCardView } from './views/profileCard.jsx'
import { settingsStyles } from '../../../client/styles/settings.js'
import { createLatestTask } from '../../../client/latest-task.js'
import { acceptConfigWrite } from '../../../client/config-write.js'

/** Panel state and command outcomes stay together; effects and views are separate. */
export function createPanel(React, primitives) {
  const switchControl = (checked, onChange, label, disabled = false) => (
    primitives?.Switch !== undefined
      ? <primitives.Switch key="switch" checked={checked} disabled={disabled} label={label} onChange={onChange} />
      : (
        <button
          className="smp-switch" key="switch" type="button"
          role="switch" aria-checked={checked} aria-label={label}
          data-on={checked ? 'true' : 'false'} disabled={disabled}
          onClick={() => onChange(!checked)}
        >
          <span className="smp-switchKnob" key="k" />
        </button>
      )
  )
  const { useState, useEffect, useMemo, useRef } = React

  const CSS = `${settingsStyles('smp')}\n${panelCss}`

  function Panel(props) {
    const form = props.form
    const { tick, refresh } = useFormSnapshot(React, form)
    const [tab, setTab] = useState('mcp')
    const [query, setQuery] = useState('')
    const [expanded, setExpanded] = useState('')
    const [menuFor, setMenuFor] = useState('')
    const [menuAnchor, setMenuAnchor] = useState(null)
    const [editing, setEditing] = useState(null)
    const [draft, setDraft] = useState({})
    const [scopeDraft, setScopeDraft] = useState({ value: '', custom: false })
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [confirming, setConfirming] = useState('')
    const [deleteDialog, setDeleteDialog] = useState(null)
    const [reconnectState, setReconnectState] = useState({})
    const [deleteNonce, setDeleteNonce] = useState("")
    const [deletePending, setDeletePending] = useState(false)
    const [deleteError, setDeleteError] = useState("")
    const [optimistic, setOptimistic] = useState([])
    const [removedKeys, setRemovedKeys] = useState([])
    const opCtxRef = useRef(null)

    const nonceSeqRef = useRef(0)
    // Keep request ids distinct even for two actions in the same millisecond.
    const nextNonce = () => `${Date.now().toString(36)}-${(nonceSeqRef.current += 1)}`

    const [skillPendingPath, setSkillPendingPath] = useState("")
    const [skillPreview, setSkillPreview] = useState(null)
    const [skillDialog, setSkillDialog] = useState(null)
    const [skillDraft, setSkillDraft] = useState({ name: "", description: "", body: "" })
    const [skillError, setSkillError] = useState("")
    const [skillNonce, setSkillNonce] = useState("")
    const skillSentAtRef = useRef(0)
    // Reset only when opening or closing a dialog; an active save keeps its markers.
    const resetSkillPending = () => {
      editBodyTaskRef.current?.invalidate()
      setSkillNonce("")
      setEditBodyPending(false)
      setEditBodyNonce("")
    }

    const finishSkillDelete = (delResult) => {
      const target = deleteTargetRef.current
      setSkillPendingPath("")
      if (delResult?.ok === true) {
        setDeleteDialog(null)
        setDeleteError("")
        if (target !== null) {
          setOptimistic((list) => dropOptimisticSkill(list, target.name))
          setRemovedKeys((list) => hideSkillUntilGone(list, target.name, target.scopeKey))
        }
      } else {
        setSkillError(String(delResult?.reason ?? "删除失败"))
        if (target !== null) setOptimistic((list) => dropOptimisticSkill(list, target.name))
      }
      deleteTargetRef.current = null
      setDeletePending(false)
      setDeleteNonce("")
    }

    const applyOptimisticSkillWrite = (ctx) => {
      if (ctx === null) return
      const dirs = runtime.skillDirs ?? {}
      const isProject = ctx.scope === "project" && String(ctx.project ?? "") !== ""
      const base = isProject
        ? `${String(ctx.project).replace(/\/+$/, "")}/${ctx.id === "dsh" ? ".dsh" : ".agents"}/skills`
        : String(ctx.id === "dsh" ? (dirs.userDsh ?? "") : (dirs.userAgents ?? ""))
      if (ctx.kind === "create" && ctx.name !== "") {
        setOptimistic((list) => [...list.filter((e) => !(e.name === ctx.name && e.scope === (isProject ? ctx.project : "global"))), {
          name: ctx.name, description: ctx.description,
          source: `${isProject ? "project" : "user"}-${ctx.id === "dsh" ? "dsh" : "agents"}`,
          scope: isProject ? ctx.project : "global",
          path: base !== "" ? `${base}/${ctx.name}/SKILL.md` : "",
          optimistic: true,
        }])
      } else {
        const gone = ctx.kind === "delete" ? ctx.name : ctx.prevName
        setOptimistic((list) => list.filter((e) => e.name !== gone))
        if (ctx.kind === "delete") {
          const scopeKey = ctx.scope === "project" && String(ctx.project ?? "") !== "" ? ctx.project : "global"
          setRemovedKeys((list) => [...new Set([...list, `${gone}::${scopeKey}`])])
        }
      }
    }

    const deleteTargetRef = useRef(null)
    const [previewBody, setPreviewBody] = useState("")
    const [previewPending, setPreviewPending] = useState(false)
    const [previewNonce, setPreviewNonce] = useState("")
    const [editBodyNonce, setEditBodyNonce] = useState("")
    const [editBodyPending, setEditBodyPending] = useState(false)
    const editBodyTaskRef = useRef(createLatestTask())
    const previewTaskRef = useRef(createLatestTask())
    const scanTaskRef = useRef(createLatestTask())
    useEffect(() => {
      if (skillPendingPath === "") return undefined
      const timer = setTimeout(() => {
        setSkillPendingPath("")
        setDeletePending(false)
        setSkillError("删除没有回执（应用可能正在重载），请刷新后再确认一次")
      }, 15000)
      return () => clearTimeout(timer)
    }, [skillPendingPath])
    useEffect(() => {
      if (!editBodyPending || editBodyNonce === "") return undefined
      const timer = setTimeout(() => {
        editBodyTaskRef.current.invalidate()
        setEditBodyPending(false)
        setEditBodyNonce("")
        setSkillError("读取正文没有回执（应用可能正在重载），请关掉重开一次")
      }, 15000)
      return () => clearTimeout(timer)
    }, [editBodyPending, editBodyNonce])
    useEffect(() => {
      if (!previewPending || previewNonce === "") return undefined
      const timer = setTimeout(() => {
        previewTaskRef.current.invalidate()
        setPreviewPending(false)
        setPreviewNonce("")
        setPreviewBody("读取正文超时")
      }, 15000)
      return () => clearTimeout(timer)
    }, [previewPending, previewNonce])

    const [inflight, setInflight] = useState({})
    useEffect(() => () => {
      editBodyTaskRef.current.invalidate()
      previewTaskRef.current.invalidate()
      scanTaskRef.current.invalidate()
    }, [])

    useEffect(() => {
      if (menuFor === '') return undefined
      if (typeof document === 'undefined') return undefined
      const onKey = (event) => { if (event.key === 'Escape') setMenuFor('') }
      document.addEventListener('keydown', onKey)
      const removeDismissListeners = listenMenuDismiss(() => setMenuFor(''))
      return () => {
        document.removeEventListener('keydown', onKey)
        removeDismissListeners()
      }
    }, [menuFor])
    const [customProject, setCustomProject] = useState(false)
    const [importOpen, setImportOpen] = useState(false)
    const [importSource, setImportSource] = useState('claude')
    const [importScope, setImportScope] = useState('global')
    const [importProject, setImportProject] = useState('')
    const [importCustomProject, setImportCustomProject] = useState(false)
    const [importScan, setImportScan] = useState(null)
    const [scanPending, setScanPending] = useState(false)
    const [scanNonce, setScanNonce] = useState('')
    const scanTargetKey = `${importSource}\u0000${importScope}\u0000${importProject}`
    const importScanKeyRef = useRef(scanTargetKey)
    const invalidateImportScan = () => {
      scanTaskRef.current.invalidate()
      setScanPending(false)
      setScanNonce('')
      setImportScan(null)
    }
    const setImportOpenSafe = (value) => { if (!value) invalidateImportScan(); setImportOpen(value) }
    const setImportScopeSafe = (value) => { invalidateImportScan(); setImportScope(value) }
    const setImportSourceSafe = (value) => { invalidateImportScan(); setImportSource(value) }
    const setImportProjectSafe = (value) => { invalidateImportScan(); setImportProject(value) }
    const setImportCustomProjectSafe = (value) => { invalidateImportScan(); setImportCustomProject(value) }
    useEffect(() => {
      if (!importOpen || importScanKeyRef.current !== scanTargetKey) {
        importScanKeyRef.current = scanTargetKey
        invalidateImportScan()
      }
      return undefined
    }, [importOpen, scanTargetKey])
    useEffect(() => {
      if (!scanPending || scanNonce === '') return undefined
      const timer = setTimeout(() => {
        scanTaskRef.current.invalidate()
        setScanPending(false)
        setScanNonce('')
        setError('扫描超时')
      }, 15000)
      return () => clearTimeout(timer)
    }, [scanPending, scanNonce])

    // Hook calls retain their original order across the extracted lifecycle owners.
    useFormRefresh(React, form, refresh)
    const inventoryRows = useInventory(React, props.inventory)
    const { runtime, setRuntime, bumpRefresh } = useRuntime(React, tab, expanded)

    useEffect(() => {
      if (removedKeys.length === 0) return
      const now = new Set((runtime.skills ?? []).map((entry) => `${entry.name}::${entry.scope ?? 'global'}`))
      const keep = removedKeys.filter((key) => now.has(key))
      if (keep.length !== removedKeys.length) setRemovedKeys(keep)
    }, [runtime.skills, removedKeys])
    const serverTools = runtime.serverTools
    const toolFilters = useMemo(() => {
      const raw = snapshotOf(form)?.toolFilters
      return raw !== null && typeof raw === 'object' ? raw : {}
    }, [form, tick])
    const filterState = runtime.filter ?? {}
    const serverToolsError = runtime.serverToolsError
    const serverStatus = runtime.serverStatus

    const {
      oauthState, oauthPending, copiedUrlFor, oauthServerState, authorizeUrlFor,
      oauthFailureFor, startOAuth, revokeOAuth, copyAuthorizeUrl,
    } = useOAuth(React, runtime.oauth)

    const profileRows = useMemo(() => {
      const runtimeRows = Array.isArray(runtime.servers) ? runtime.servers : []
      if (runtimeRows.length > 0) return runtimeRows
      return inventoryRows
        .filter((row) => row.moduleName === '@deepseek-ai/dsh-mcp-client')
        .map((row) => ({
          entryId: row.entryId,
          serverName: row.entryId.replace(/^include:/, '').replace(/^mcp-/, ''),
          transport: '',
          target: '',
          enabled: row.enabled,
          phase: row.fiberPhase,
        }))
    }, [runtime.servers, inventoryRows])

    const debugOn = typeof location !== 'undefined' && /(?:^|[?&])smp=debug/.test(location.search)
    const debugMcp = inventoryRows.filter((row) => /mcp/i.test(row.entryId) || /mcp/i.test(row.moduleName))

    const rowOpsReady = true

    const matches = (row) => matchesName(row.serverName ?? row.name, query)
    const isGlobal = (row) => (row.scope ?? 'global') === 'global'

    const skillDirs = runtime.skillDirs ?? {}
    const discoveredFromDoc = runtime.skills ?? []
    const docKeys = new Set(discoveredFromDoc.map((entry) => `${entry.name}::${entry.scope}`))
    const removedSet = new Set(removedKeys)
    const discovered = [
      ...discoveredFromDoc.filter((entry) => !removedSet.has(`${entry.name}::${entry.scope}`)),
      ...optimistic.filter((entry) => !docKeys.has(`${entry.name}::${entry.scope}`)),
    ]
    const rootIdOfSource = (source) => (String(source).endsWith("-agents") ? "agents" : "dsh")
    const discoveredOnly = discovered.filter((entry) => matchesName(entry.name, query))
    const knownProjects = new Map((runtime.workspaces ?? [])
      .filter((workspace) => typeof workspace?.path === 'string' && workspace.path !== '')
      .map((workspace) => [workspace.path, typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : workspace.path]))
    const projectLabel = (path) => {
      if (typeof path !== 'string' || path === '') return ''
      const known = knownProjects.get(path)
      if (known !== undefined) return known
      return path
    }
    const scopeTagLabel = (path) => {
      if (typeof path !== 'string' || path === '' || path === 'global') return '全局'
      const known = knownProjects.get(path)
      if (known !== undefined) return known
      const parts = path.replace(/\/+$/, '').split('/')
      return parts[parts.length - 1] || ''
    }

    const skillRootLabel = (scope, id) => {
      const useAgents = id === 'agents'
      const leaf = useAgents ? '.agents/skills' : '.dsh/skills'
      if (typeof scope !== 'string' || scope === '' || scope === 'global') {
        const dirs = skillDirs
        if (useAgents) return dirs.userAgents || '~/.agents/skills'
        return dirs.userDsh || '~/.dsh/skills'
      }
      return `${scope.replace(/\/+$/, '')}/${leaf}`
    }
    const defaultWorkspace = () => {
      const current = runtime.currentWorkspace
      if (typeof current === 'string' && current !== '') return current
      const configured = profileRows.map((row) => row.scope).find((scope) => typeof scope === 'string' && scope !== '' && scope !== 'global')
      return configured ?? ''
    }

    useEffect(() => {
      setInflight((current) => settleInflight(current, { profileRows }))
    }, [tick, profileRows, inflight])

    const pendingOps = []
    const pendingOf = (entryId) => pendingOps.find((op) => String(op?.entryId ?? '').replace(/^include:/, '') === String(entryId).replace(/^include:/, '')) ?? null
    const projectChoices = useMemo(() => {
      const map = new Map()
      for (const workspace of runtime.workspaces ?? []) {
        const path = typeof workspace?.path === 'string' ? workspace.path : ''
        if (path !== '') map.set(path, typeof workspace.title === 'string' && workspace.title !== '' ? workspace.title : path)
      }
      for (const row of profileRows) {
        const scope = row?.scope
        if (typeof scope === 'string' && scope !== '' && scope !== 'global' && !map.has(scope)) map.set(scope, scope)
      }
      return [...map.entries()]
    }, [profileRows, runtime.workspaces, form, tick])

    const workspacePaths = useMemo(() => (runtime.workspaces ?? [])
      .map((workspace) => (typeof workspace?.path === 'string' ? workspace.path : ''))
      .filter((path) => path !== ''), [runtime.workspaces])

    async function write(field_, value) {
      setBusy(true)
      setError('')
      try {
        if (typeof form?.set === 'function') await acceptConfigWrite(() => form.set(field_, value), field_)
        else if (typeof props.mutate === 'function') await acceptConfigWrite(() => props.mutate(props.entryId ?? NS, [{ op: 'set', path: ROOT_ENTRIES.includes(props.entryId) ? ['skillsMcp', field_] : [field_], value }]), field_)
        else throw new Error('当前环境没有配置写入通道')
        refresh()
        bumpRefresh()
      } catch (cause) {
        setError(String(cause?.message ?? cause))
      } finally {
        setBusy(false)
      }
    }

    const filterFor = (serverName) => {
      const rule = toolFilters[serverName]
      return {
        mode: rule?.mode === 'allow' || rule?.mode === 'deny' ? rule.mode : 'off',
        tools: Array.isArray(rule?.tools) ? rule.tools : [],
      }
    }

    const writeFilter = (serverName, next) => {
      const map = { ...toolFilters }
      if (next.mode === 'off') delete map[serverName]
      else map[serverName] = { mode: next.mode, tools: next.tools }
      return write('toolFilters', map)
    }

    const leafOf = (serverName) => (fullName) => {
      const prefix = `mcp__${serverName}__`
      return fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName
    }

    const statusFor = (serverName, tier, scope) => {
      if (typeof serverName !== 'string' || serverName === '') return null
      const wantScope = scope ?? ''
      return serverStatus.find((item) => item.serverName === serverName && item.tier === tier && (item.scope ?? '') === wantScope)
        ?? serverStatus.find((item) => item.serverName === serverName && item.tier === tier)
        ?? null
    }

    const STATUS_DOTS = {
      connected: { dot: 'ok', text: '可用' },
      retrying: { dot: 'warn', text: '连接中' },
      pending: { dot: 'warn', text: '连接中' },
      'gave-up': { dot: 'danger', text: '已放弃重试' },
      failed: { dot: 'danger', text: '异常' },
      'needs-auth': { dot: 'warn', text: '需要授权' },
      unmounted: { dot: 'neutral', text: '未挂载' },
      disabled: { dot: 'neutral', text: '已关闭' },
      unknown: { dot: 'neutral', text: '状态未知' },
    }

    const statusDot = (serverName, tier, scope) => {
      const item = statusFor(serverName, tier, scope) ?? (serverToolsError?.reason ? {
        status: 'unknown', detail: serverToolsError.reason === 'loading' ? '正在读取连接状态' : serverToolsError.detail,
      } : null)
      const spec = STATUS_DOTS[item?.status]
      if (spec === undefined) return null
      const tools = item.status === 'connected' && item.toolCount > 0 ? `${item.toolCount} 个工具` : ''
      const left = item.status === 'retrying' && item.remainingSeconds > 0 ? `约 ${item.remainingSeconds}s` : ''
      const trailing = [tools, left].filter((part) => part !== '')
      return (
        <span className="smp-status" key="status" title={item.detail || undefined}>
          <span className="smp-dot" data-dot={spec.dot} key="d" aria-hidden="true" />
          <span className="smp-statusText" key="t">{spec.text}</span>
          {trailing.map((part, index) => (
            <span className="smp-statusMeta" key={`m${index}`}>{part}</span>
          ))}
        </span>
      )
    }

    const reconnectAction = (serverName, tier, scope) => {
      const item = statusFor(serverName, tier, scope)
      const RECONNECTABLE = new Set(['gave-up', 'failed', 'retrying', 'pending'])
      if (item === null || !RECONNECTABLE.has(item.status)) return null
      const state = reconnectState[serverName] ?? {}
      const waiting = state.pending === true
      const failure = String(state.error ?? '')
      return {
        node: (
          <button
            className="smp-menuItem" key="reconnect" disabled={busy || waiting}
            onClick={() => {
              setReconnectState((current) => ({ ...current, [serverName]: { pending: true, error: '' } }))
              void sendReconnect({ tier, serverName, scope: scope ?? '' }).then((result) => {
                setReconnectState((current) => ({
                  ...current,
                  [serverName]: { pending: false, error: result.ok ? '' : String(result.reason ?? '重连失败') },
                }))
                if (result.ok) bumpRefresh()
              })
            }}
          >
            {waiting ? '重连中…' : '重连'}
          </button>
        ),
        failure,
      }
    }

    // Confirmed optimistic rows remain until the runtime projection catches up.
    const commandRowOp = (op, entryId) => {
      const key = inflightKeyForRow(entryId)
      void sendRowOp(op).then((result) => {
        if (result.ok) {
          setInflight((m) => (m[key] === undefined ? m : { ...m, [key]: { ...m[key], confirmed: true } }))
          if (Array.isArray(result.servers)) {
            setRuntime((current) => ({ ...current, servers: result.servers }))
          }
          bumpRefresh()
          return
        }
        setInflight((m) => {
          const next = { ...m }
          delete next[key]
          return next
        })
        setError(result.reason)
      })
    }

    const enabledSwitch = (row) => {
      const key = inflightKeyForRow(row.entryId)
      const on = row.enabled !== false
      const expected = inflight[key]?.kind === 'toggle' ? inflight[key].expectEnabled : undefined
      const shown = expected === undefined ? on : expected
      const toggle = (next) => {
        setInflight((m) => ({ ...m, [key]: { kind: 'toggle', at: Date.now(), expectEnabled: next } }))
        commandRowOp(toggleServerOp(row.entryId, next), key)
      }
      const label = shown ? '停用' : '启用'
      return switchControl(shown, toggle, label, busy)
    }

    const moreMenu = (row, items) => {
      const open = menuFor === row.entryId
      const visible = items.filter((item) => item !== null && item !== undefined)
      if (visible.length === 0) return null
      return (
        <span className="smp-more" key="more">
          <button
            className="smp-moreTrigger" key="t" type="button" disabled={busy}
            aria-haspopup="menu" aria-expanded={open} aria-label="更多操作"
            onClick={(event) => {
              if (open) {
                setMenuFor('')
                return
              }
              const rect = event?.currentTarget?.getBoundingClientRect?.()
              setMenuAnchor(measureMenuAnchor({
                rect,
                itemCount: visible.length,
                viewportWidth: globalThis.window?.innerWidth,
                viewportHeight: globalThis.window?.innerHeight,
              }))
              setMenuFor(row.entryId)
            }}
          >
            ⋯
          </button>
          {open ? (
            <>
              {/* 点击遮罩关闭：不能让菜单在一次无关的点击后还开着，
                  否则下一次点击会落在用户没打算打开的菜单项上。 */}
              <span className="smp-menuScrim" key="scrim" onClick={() => setMenuFor('')} />
              <span
                className="smp-menu" key="menu" role="menu"
                data-placement={menuAnchor?.placement ?? 'down'}
                style={anchorStyle(menuAnchor)}
              >
                {visible}
              </span>
            </>
          ) : null}
        </span>
      )
    }

    const head = pageHead()

    const tabs = tabStrip({
      active: tab,
      counts: {
        mcp: profileRows.length,
        skills: discoveredOnly.length,
      },
      onSelect: (next) => { setTab(next); setEditing(null); setExpanded('') },
    })

    const mcpAddButton = () => (
      <button
        className="smp-button" data-variant="primary" key="add" disabled={busy}
        onClick={() => {
          setEditing({ kind: "mcp", tier: "global", id: undefined })
          setDraft({
            transport: "streamable-http",
            command: HINTS.command,
            ...CONNECTION_DRAFT_DEFAULTS,
          })
          setScopeDraft({ value: defaultWorkspace(), custom: false })
        }}
      >
        添加服务器
      </button>
    )

    const skillsAddButton = () => (
      <button
        className="smp-button" data-variant="primary" key="add" disabled={busy}
        onClick={() => {
          setSkillError("")
          setSkillDraft({ name: "", description: "", body: "" })
          resetSkillPending()
          setSkillDialog({
            mode: "add", scope: "global", id: "dsh",
            project: defaultWorkspace(), projectCustom: false, prevName: "",
          })
        }}
      >
        添加技能
      </button>
    )

    const filterRowView = filterRow({
      query,
      onQuery: setQuery,
      placeholder: tab === 'mcp' ? '搜索名称' : '搜索技能名称',
      actions: tab === 'mcp' ? mcpAddButton() : skillsAddButton(),
    })

    function needsAuthNote(serverName, tier, scope) {
      const item = statusFor(serverName, tier, scope)
      if (item?.status !== 'needs-auth') return null
      const why = String(item.detail ?? '') || '这台服务器要求先授权（OAuth）才能连接，这不是故障。'
      const ready = oauthState?.ready === true
      if (!ready) {
        const reason = String(oauthState?.detail ?? '')
        return (
          <p className="smp-note" key="needsAuth" style={{ marginTop: 6 }}>
            {`${why} OAuth 授权在这个 Host 上不可用${reason === '' ? '' : `（${reason}）`}，所以只能靠凭据补上：给这一行加一个 Authorization 请求头，或换成服务器提供的带 token 的地址。`}
          </p>
        )
      }
      const failure = oauthFailureFor(serverName)
      const pending = oauthPending === serverName
      const status = oauthServerState(serverName)
      return (
        <div className="smp-note" key="needsAuth" style={{ marginTop: 6 }}>
          <p style={{ margin: 0 }}>{why}</p>
          <div className="smp-oauthRow">
            <button
              className="smp-button" data-variant="primary" type="button" disabled={pending}
              onClick={() => void startOAuth(serverName)}
            >

              {pending ? '正在获取授权链接…' : status.present ? '重新授权' : '授权'}
            </button>
            {status.present && status.refreshable === true ? (
              <button
                className="smp-button" type="button" disabled={pending}
                onClick={() => void revokeOAuth(serverName)}
              >
                清除凭据
              </button>
            ) : null}
          </div>

          {status.present === true && failure === '' ? (
            <p className="smp-note" style={{ margin: '4px 0 0' }}>
              {"已经保存了授权凭据，但这台服务器仍然拒绝了连接。可能是令牌被撤销、或服务器端的鉴权配置变了 —— 重新授权通常能解决；若反复失败，请检查服务器是否还要求其它的请求头。"}
            </p>
          ) : null}
          {failure === '' ? null : <p className="smp-note smp-oauthError" style={{ margin: '4px 0 0' }}>{failure}</p>}
          {authorizeUrlFor(serverName) === '' ? null : (
            <div className="smp-oauthLink">
              <p style={{ margin: '6px 0 2px' }}>在浏览器里打开这个链接完成登录，完成后回到这里：</p>
              <div className="smp-oauthLinkRow">
                <input
                  className="smp-oauthUrl" readOnly
                  value={authorizeUrlFor(serverName)}
                  onFocus={(event) => event.target.select()}
                />
                <button className="smp-button" data-variant="outline" type="button" onClick={() => copyAuthorizeUrl(serverName)}>
                  {copiedUrlFor === serverName ? '已复制' : '复制链接'}
                </button>
              </div>
              <p className="smp-note" style={{ margin: '2px 0 0' }}>
                授权完成后如果状态没变，点一次「重连」让它重新建立连接。
              </p>
            </div>
          )}
        </div>
      )
    }

    function card(key, identity, description, enabled, details, menuItems, pending, statusNode, authNote) {
      return listCardView({
        key, identity, description, enabled, details, menuItems, pending, statusNode, authNote,
        isOpen: expanded === key, onToggle: () => setExpanded(expanded === key ? '' : key),
        menu: pending ? null : moreMenu({ entryId: key }, menuItems), error,
      })
    }

    function profileCard(row, tier = 'global') {
      const isGlobalTier = tier === 'global'
      const rowKey = `profile:${row.entryId}`
      const rowOpen = expanded === rowKey
      const rowStatusScope = isGlobalTier ? '' : (row.scope ?? '')
      if (editing?.kind === 'mcp' && editing.tier === tier && editing.id === row.entryId) {
        return serverForm({ tier, scope: row.scope ?? 'global' })
      }
      const inflightInfo = inflight[inflightKeyForRow(row.entryId)]
      const spinning = inflightInfo !== undefined && inflightInfo.confirmed !== true && inflightInfo.kind !== 'toggle'
      const pending = pendingOf(row.entryId) !== null || spinning
      const reconnect = reconnectAction(row.serverName, tier, rowStatusScope)
      const oauthCredentials = oauthServerState(row.serverName)
      const oauthRowStatus = statusFor(row.serverName, tier, rowStatusScope)
      const oauthWorthOffering = oauthCredentials.present === true
        ? oauthRowStatus?.status !== 'connected'
        : (oauthRowStatus === null || oauthRowStatus.status === 'needs-auth')
      const oauthMenuItem = oauthState?.ready === true && row.transport === 'streamable-http' && oauthWorthOffering ? (
        <button
          className="smp-menuItem" key="oauth" disabled={busy || oauthPending !== ''}
          onClick={() => {
            setMenuFor('')
            void startOAuth(row.serverName)
          }}
        >
          {oauthPending === row.serverName
            ? '正在获取授权链接…'
            : oauthServerState(row.serverName).present
              ? '重新授权'
              : '授权'}
        </button>
      ) : null
      const menuItems = [
        reconnect === null ? null : reconnect.node,
        oauthMenuItem,
        <button
          className="smp-menuItem" key="edit" disabled={busy}
          onClick={() => {
            setMenuFor('')
            setEditing({ kind: "mcp", tier, profile: row.entryId, id: row.entryId, original: row })
            setDraft(draftFromRow(row))
            const rowScope = row.scope && row.scope !== 'global' ? row.scope : ''
            setScopeDraft({
              value: rowScope,
              custom: rowScope !== '' && !projectChoices.some(([path]) => path === rowScope),
            })
          }}
        >
          编辑
        </button>,
        <button
          className="smp-menuItem" data-variant="danger" key="del" disabled={busy}
          onClick={() => {
            setMenuFor('')
            const run = () => {
              setInflight((m) => ({ ...m, [inflightKeyForRow(row.entryId)]: { kind: "delete", at: Date.now() } }))
              commandRowOp(deleteServerOp(row.entryId), row.entryId)
            }
            if (primitives?.Modal === undefined) {
              if (window.confirm(`删除「${row.serverName || row.entryId}」？`)) run()
              return
            }
            setDeleteDialog({
              label: row.serverName || row.entryId,
              note: "会从 cordis.patch.yml 里移除这一行（写入前自动备份）。",
              closeOnConfirm: true,
              run,
            })
          }}
        >
          删除
        </button>,
        reconnect?.failure ? (
          <span className="smp-menuError" key="reconnectError">{reconnect.failure}</span>
        ) : null,
      ]
      return profileCardView({
        row, tier, rowKey, rowOpen, rowStatusScope, setExpanded, scopeTagLabel, statusDot,
        pending, pendingText: pendingLabel(inflight[inflightKeyForRow(row.entryId)] ?? { kind: pendingOf(row.entryId)?.op }),
        rowOpsReady, enabledSwitch, moreMenu, menuItems,
        serverTools, serverToolsError, filterFor, leafOf, writeFilter, filterState, needsAuthNote,
      })
    }

    const importCard = (scope) => importCardView({
      scope, importProject, importScan, profileRows, importOpen, busy, scanPending, setImportOpen: setImportOpenSafe,
      setImportScope: setImportScopeSafe, importSource, setImportSource: setImportSourceSafe, importCustomProject,
      setImportCustomProject: setImportCustomProjectSafe, setImportProject: setImportProjectSafe, projectChoices,
      onScan: ({ source, scope, project }) => {
        invalidateImportScan()
        const task = scanTaskRef.current.begin()
        const target = { source, scope, project }
        const nonce = nextNonce()
        setImportScan(null)
        setScanPending(true)
        setScanNonce(nonce)
        setError("")
        void scanImport({ ...target, signal: task.signal }).then((payload) => {
          if (!task.isCurrent()) return
          setImportScan({ ...payload, ...target })
          setScanPending(false)
          setScanNonce("")
          if (payload?.ok !== true) setError(String(payload?.error ?? "扫描失败"))
        }).catch((error) => {
          if (!task.isCurrent()) return
          setScanPending(false)
          setScanNonce("")
          setError(String(error?.message ?? error))
        })
      },
      onImport: ({ scope, target, result }) => {
        const wantedScope = scope === "global" ? "global" : target
        const existing = new Set(profileRows
          .filter((row) => (row.scope ?? 'global') === wantedScope)
          .map((row) => row.serverName))
        for (const server of result.servers) {
          if (existing.has(server.serverName)) continue
          void sendRowOp(addServerOp({
            serverName: server.serverName,
            transport: server.transport,
            url: server.transport === "stdio" ? "" : server.url,
            command: server.transport === "stdio" ? server.command : "",
            args: server.transport === "stdio" ? (server.args ?? []).join(" ") : "",
            env: server.env ?? "", headers: server.headers ?? "",
            scope: scope === "global" ? "" : target,
            scopeChanged: scope !== "global",
          })).then((outcome) => { if (!outcome.ok) setError(outcome.reason) })
        }
        setImportScan(null)
      },
    })

    function serverForm(tier) {
      const profileEntry = typeof editing?.profile === 'string' && editing.profile !== '' ? editing.profile : null
      return serverFormView({
        tier, editing, draft, setDraft, scopeDraft, setScopeDraft, projectChoices,
        error, busy, switchControl, onCancel: () => { editBodyTaskRef.current.invalidate(); setEditBodyPending(false); setEditBodyNonce(""); setEditing(null) },
        onSave: () => {
          const transport = draft.transport ?? "streamable-http"
          if (profileEntry !== null) {
            setInflight((m) => ({ ...m, [inflightKeyForRow(profileEntry)]: { kind: "update", at: Date.now(), expectName: draft.serverName ?? "" } }))
            commandRowOp(updateServerOp(profileEntry, {
              ...draft,
              serverName: draft.serverName ?? "", transport,
              url: transport === "stdio" ? "" : (draft.url ?? ""),
              command: transport === "stdio" ? (draft.command ?? "") : "",
              args: transport === "stdio" ? String(draft.args ?? "") : "",
              env: transport === "stdio" ? String(draft.env ?? "") : "",
              headers: transport === "stdio" ? "" : String(draft.headers ?? ""),
            }, editing.original), profileEntry)
          } else {
            const optimisticKey = inflightKeyForRow(rowEntryId(draft.serverName))
            setInflight((m) => ({
              ...m,
              [optimisticKey]: {
                kind: "add", at: Date.now(), scope: scopeDraft.value,
                draft: { ...draft, transport },
              },
            }))
            commandRowOp(addServerOp({
              ...draft,
              serverName: draft.serverName ?? "", transport,
              url: transport === "stdio" ? "" : (draft.url ?? ""),
              command: transport === "stdio" ? (draft.command ?? "") : "",
              args: transport === "stdio" ? String(draft.args ?? "") : "",
              env: transport === "stdio" ? String(draft.env ?? "") : "",
              headers: transport === "stdio" ? "" : String(draft.headers ?? ""),
              scope: scopeDraft.value,
              scopeChanged: true,
            }), optimisticKey)
          }
          setEditing(null)
        },
      })
    }

    function diskSkillMenuItems(skill) {
      return [
        <button
          className="smp-menuItem" key="view" disabled={busy || skillPendingPath === skill.path}
          onClick={() => { setMenuFor(''); openPreview(skill) }}
        >
          预览
        </button>,
        <button
          className="smp-menuItem" key="edit" disabled={busy || skillPendingPath === skill.path}
          onClick={() => {
            setMenuFor('')
            const parts = String(skill.source).split("-")
            const scope = parts[0] === "project" ? "project" : "global"
            const id = parts[1] === "dsh" ? "dsh" : "agents"
            setSkillError("")
            setSkillDraft({ name: skill.name, description: skill.description ?? "", body: skill.body ?? "" })
            resetSkillPending()
            setSkillDialog({
              mode: "edit", scope, id, project: skill.scope === "global" ? "" : skill.scope,
              projectCustom: false, prevName: skill.name, path: skill.path ?? "",
            })
            loadSkillBody(skill)
          }}
        >
          编辑
        </button>,
        <button
          className="smp-menuItem" data-variant="danger" key="del" disabled={busy || skillPendingPath === skill.path}
          onClick={() => { setMenuFor(''); confirmDeleteSkill(skill) }}
        >
          删除
        </button>,
      ]
    }

    const pendingAdds = pendingAddsOf(inflight, profileRows)

    const skillGroups = orderedScopeGroups(
      discoveredOnly.map((skill) => ({ skill, scope: skill.scope ?? 'global' })),
      workspacePaths,
    )

    const skillCard = ({ skill }) => {
      const scopeValue = skill.scope ?? 'global'
      const rootId = rootIdOfSource(skill.source)
      const key = `disk:${skill.path}`
      const pending = skillPendingPath === skill.path ? '删除中…' : null
      const identity = [
        <span key="n">{skill.name}</span>,
        <span className="smp-tag" data-tone="neutral" key="scope">{scopeTagLabel(scopeValue)}</span>,
      ]
      return card(
        key,
        identity,
        skill.description || "(无描述)",
        undefined,
        [["来源", skill.source], ["路径", skill.path]],
        diskSkillMenuItems(skill),
        pending,
      )
    }

    const skillsList = (
      <ul className="smp-cards" key="cards">
        {skillGroups.map((group) => group.items.map((entry) => skillCard(entry)))}
        {skillGroups.length === 0 ? (
          <li className="smp-empty" key="empty" style={{ gridColumn: "1 / -1" }}>
            {emptySkillText('')}
          </li>
        ) : null}
      </ul>
    )

    const confirmDeleteSkill = (skill) => {
      const parts = String(skill.source ?? "").split("-")
      const scope = parts[0] === "project" ? "project" : "global"
      const id = parts[1] === "dsh" ? "dsh" : "agents"
      setDeleteDialog({
        label: skill.name,
        note: "会先把目录备份到同级的 .smp-backup-* 再删除；备份会保留，需要时可手动恢复。",
        closeOnConfirm: true,
        run: () => {
          const target = removalTargetOf(skill)
          deleteTargetRef.current = { ...target, path: String(skill.path ?? "") }
          setDeleteError("")
          setSkillPendingPath(String(skill.path ?? ""))
          setSkillError("")
          setSkillNonce("pending")
          const request = {
            op: "delete", scope, id,
            project: skill.scope === "global" ? "" : skill.scope,
            name: skill.name, prevName: "", description: "", body: "",
            path: skill.path ?? "", nonce: "",
          }
          void sendSkillWrite(request).then((result) => {
            setSkillNonce("")
            finishSkillDelete(result)
          })
        },
      })
    }

    const diskPathOfSkill = (skill) => {
      const name = String(skill?.name ?? "")
      if (name === "") return ""
      const scope = skill?.scope ?? "global"
      const rootId = skill?.id === "agents" ? "agents" : "dsh"
      const dirs = runtime.skillDirs ?? {}
      const base = scope === "global"
        ? String(rootId === "agents" ? (dirs.userAgents ?? "") : (dirs.userDsh ?? ""))
        : `${String(scope).replace(/\/+$/, "")}/${rootId === "dsh" ? ".dsh" : ".agents"}/skills`
      return base === "" ? "" : `${base}/${name}/SKILL.md`
    }

    const loadSkillBody = (skill) => {
      if (!skill?.path) return
      const task = editBodyTaskRef.current.begin()
      setEditBodyPending(true)
      setEditBodyNonce(nextNonce())
      void readSkillBody(skill.path, { signal: task.signal }).then((result) => {
        if (!task.isCurrent()) return
        setSkillDraft((current) => ({
          ...current,
          body: result.ok === true ? String(result.body ?? "") : String(current.body ?? ""),
        }))
        setEditBodyPending(false)
        setEditBodyNonce("")
        if (result.ok !== true) setSkillError(String(result.reason ?? "读取正文失败"))
      })
    }

    const openPreview = (skill) => {
      const task = previewTaskRef.current.begin()
      setSkillPreview(skill)
      setPreviewBody("")
      setPreviewPending(true)
      setPreviewNonce(nextNonce())
      void readSkillBody(skill.path ?? "", { signal: task.signal }).then((result) => {
        if (!task.isCurrent()) return
        setPreviewBody(result.ok === true ? String(result.body ?? "") : String(result.reason ?? "读取失败"))
        setPreviewPending(false)
        setPreviewNonce("")
      })
    }

    const skillDialogTarget = skillRootLabel(
      skillDialog?.scope === 'project' ? (skillDialog?.project ?? '') : 'global',
      skillDialog?.id,
    )

    const skillDialogElement = skillDialogView({
      dialog: skillDialog, draft: skillDraft,
      resolvedPath: skillDialog === null || (skillDialog.scope === 'project' && String(skillDialog.project ?? '') === '')
        ? ''
        : skillDialogTarget,
      workspaceChoices: projectChoices,
      error: skillError, pending: skillNonce !== "" || editBodyPending, primitives,
      onScope: (scope) => setSkillDialog((current) => (current === null ? current : { ...current, scope })),
      onProject: (next) => setSkillDialog((current) => {
        if (current === null) return current
        if (next === '__custom__') return { ...current, projectCustom: true }
        return { ...current, projectCustom: false, project: next }
      }),
      onProjectCustom: (next) => setSkillDialog((current) => (current === null ? current : { ...current, project: next })),
      onRoot: (id) => setSkillDialog((current) => (current === null ? current : { ...current, id: id === 'agents' ? 'agents' : 'dsh' })),
      onName: (name) => setSkillDraft((current) => ({ ...current, name })),
      onDescription: (description) => setSkillDraft((current) => ({ ...current, description })),
      onBody: (body) => setSkillDraft((current) => ({ ...current, body })),
      onCancel: () => { setSkillDialog(null); setSkillError(""); resetSkillPending() },
      onSave: () => {
        if (skillDialog === null) return
        // Saving before the body arrives would overwrite the file with an empty body.
        if (editBodyPending) return
        const isEdit = skillDialog.mode === "edit"
        const renamed = isEdit && (skillDraft.name ?? "") !== skillDialog.prevName
        const editOp = isEdit ? (renamed ? "rename" : "update") : "create"
        const sent = {
          kind: editOp,
          name: String(skillDraft.name ?? ""),
          prevName: String(skillDialog.prevName ?? ""),
          description: String(skillDraft.description ?? ""),
          scope: skillDialog.scope, id: skillDialog.id, project: skillDialog.project,
        }
        setSkillError("")
        setSkillNonce("pending")
        const request = {
          op: editOp,
          scope: skillDialog.scope, id: skillDialog.id, project: skillDialog.project,
          name: skillDraft.name ?? "", prevName: skillDialog.prevName ?? "",
          description: skillDraft.description ?? "", body: skillDraft.body ?? "",
          nonce: "",
        }
        void sendSkillWrite(request).then((result) => {
          setSkillNonce("")
          if (result.ok === true) {
            applyOptimisticSkillWrite(sent)
            setSkillDialog(null)
            setSkillError("")
            bumpRefresh()
            return
          }
          setSkillError(String(result.reason ?? "写入失败"))
        })
      },
    })

    const skillPreviewDialogView = skillPreviewDialog({
      skill: skillPreview, body: previewBody, pending: previewPending, primitives,
      onClose: () => { previewTaskRef.current.invalidate(); setSkillPreview(null); setPreviewPending(false); setPreviewNonce("") },
    })

    const confirmDeleteDialog = deleteConfirmDialog({
      dialog: deleteDialog,
      primitives,
      pending: deletePending,
      error: deleteError,
      onCancel: () => { setDeleteDialog(null); setDeletePending(false); setDeleteError(""); setDeleteNonce(""); },
      onConfirm: () => {
        if (deleteDialog?.closeOnConfirm === true) {
          setDeleteDialog(null)
          setDeletePending(false)
          setDeleteError("")
          setDeleteNonce("")
        }
        const run = deleteDialog?.run
        if (typeof run === 'function') run()
      },
    })

    // Hide local deletes until reconciliation settles or times out.
    const deletedIds = new Set(
      Object.entries(inflight)
        .filter(([, info]) => info?.kind === 'delete')
        .map(([entryId]) => String(entryId).replace(/^include:/, '')),
    )
    const mcpRows = profileRows
      .filter((row) => !deletedIds.has(String(row.entryId).replace(/^include:/, '')))
      .filter(matches)
    const pendingByScope = new Map()
    for (const [entryId, info] of pendingAdds) {
      const scope = scopeKey(info?.scope)
      pendingByScope.set(scope, [...(pendingByScope.get(scope) ?? []), entryId])
    }
    const optimisticCard = (entryId) => {
      const info = inflight[entryId]
      const draftRow = info?.draft
      if (draftRow === undefined) {
        return (
          <li className="smp-card" key={`pending:${entryId}`}>
            <div className="smp-cardHead" key="head">
              <span className="smp-pending" key="p">
                <span className="smp-spinner" key="s" />
                {`正在写入配置文件…（${String(entryId).replace(/^include:mcp-/, "")}）`}
              </span>
            </div>
          </li>
        )
      }
      const scope = scopeKey(info?.scope)
      const stdio = (draftRow.transport ?? 'streamable-http') === 'stdio'
      return profileCard({
        entryId: String(entryId),
        serverName: draftRow.serverName ?? '',
        scope: scope === '' ? '' : scope,
        transport: draftRow.transport ?? 'streamable-http',
        target: stdio
          ? [draftRow.command, draftRow.args].filter((part) => String(part ?? '').trim() !== '').join(' ')
          : (draftRow.url ?? ''),
        command: draftRow.command ?? '',
        args: draftRow.args ?? '',
        env: draftRow.env ?? '',
        headersText: draftRow.headers ?? '',
        enabled: true,
        phase: '',
      }, scope === '' ? 'global' : 'project')
    }
    const mcpGroups = orderedScopeGroups(
      mcpRows,
      workspacePaths,
      [...pendingByScope.keys()],
    )
    const mcpList = (
      <ul className="smp-cards" key="cards">
        {mcpGroups.map((group) => [
          ...group.items.map((row) => profileCard(row, (row.scope ?? 'global') === 'global' ? 'global' : 'project')),
          ...(pendingByScope.get(group.scope) ?? []).map(optimisticCard),
        ])}
        {mcpRows.length === 0 && pendingAdds.length === 0 ? (
          <li className="smp-empty" key="empty" style={{ gridColumn: "1 / -1" }}>
            {emptyMcpText('')}
          </li>
        ) : null}
      </ul>
    )

    const mcpSummary = `共 ${mcpRows.length} 个 · 作用域见卡片上的工作区标签 · 增删改都会写回 cordis.patch.yml（自动备份）`

    const mcpSections = [
      <ul className="smp-cards" key="import">{importCard(importScope)}</ul>,
      editing?.kind === "mcp" && editing.id === undefined ? (
        <ul className="smp-cards" key="formWrap">{serverForm({ tier: editing.tier })}</ul>
      ) : null,
      mcpList,
    ]

    const skillsSummary = [
      `共 ${skillGroups.reduce((total, group) => total + group.items.length, 0)} 个`,
      '作用域见卡片上的标签',
      `全局写 ${skillDirs.userDsh || '~/.dsh/skills'} 或 ${skillDirs.userAgents || '~/.agents/skills'}，项目级写 <工作区>/.dsh/skills 或 <工作区>/.agents/skills`,
    ].join(' · ')

    const skillsSections = [skillsList]

    return (
      <div className="smp-page">
        <style key="css">{CSS}</style>
        {head}
        {tabs}

        <div className="smp-groupSub smp-summaryAbove" key="summary">
          {tab === "mcp" ? mcpSummary : skillsSummary}
        </div>
        {filterRowView}
        {statusOf(form) === "loading" ? <p className="smp-empty" key="loading">正在读取设置…</p> : null}
        {error && !editing ? <p className="smp-error" key="err">{error}</p> : null}
        {/* Disk-delete errors remain visible after its confirmation closes. */}
        {skillError !== "" && skillDialog === null ? <p className="smp-error" key="skillerr">{skillError}</p> : null}
        {confirmDeleteDialog}
        {skillPreviewDialogView}
        {skillDialogElement}
        {tab === "mcp" ? mcpSections : skillsSections}
        {debugOn ? (
          <section className="smp-group" key="debug">
            <div className="smp-groupTitleRow" key="h">
              <span className="smp-groupTitle">
                {`Loader 诊断：共 ${inventoryRows.length} 行，其中 mcp 相关 ${debugMcp.length} 行`}
              </span>
            </div>
            <ul className="smp-cards" key="list">
              {debugMcp.map((row) => (
                <li className="smp-card" key={row.entryId}>
                  <div className="smp-cardContent" key="c" style={{ cursor: "default" }}>
                    <div className="smp-cardMainRow" key="r">
                      <span className="smp-cardIdentity" key="i">{row.entryId}</span>
                      <span className="smp-cardEnd" key="e">
                        <span className="smp-tag" data-tone="neutral">
                          {`${row.enabled ? "on" : "off"}${row.fiberPhase ? ` · ${row.fiberPhase}` : ""}`}
                        </span>
                      </span>
                    </div>
                    <div className="smp-cardDescription" key="d">{row.moduleName}</div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    )
  }

  return Panel
}
