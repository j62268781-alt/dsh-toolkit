/**
 * 微信侧只读查询：当前会话、工作区列表、某个工作区下的会话列表。
 *
 * 全部走 DSH 的只读服务（workspaceRegistry / sessionQuery / permissionPresets），
 * 不激活 Agent、不读凭据、不碰网络；服务缺失时退化成能看懂的提示而不是抛错。
 *
 * 微信里不能渲染 Markdown，所以这里直接产出纯文本（每行一条）。
 */

/** 每次最多列出多少个会话（微信里太长没人看）。 */
const MAX_SESSION_LINES = 10
/** /sessions all 时每个工作区最多几行。 */
const MAX_SESSION_LINES_PER_WORKSPACE = 3

/** 取可选服务：优先 cordis 的 ctx.get(name)，再退回普通属性（两者都没有就是 undefined）。 */
function serviceOf(ctx, name) {
  if (ctx === undefined || ctx === null) return undefined
  if (typeof ctx.get === 'function') {
    try {
      const resolved = ctx.get(name)
      if (resolved !== undefined) return resolved
    } catch {
      // 服务没挂载时 cordis 会抛，这里当没有
    }
  }
  return ctx[name]
}

/** 路径最后一段，拿不到就用整条路径。 */
function baseName(path) {
  if (typeof path !== 'string' || path === '') return ''
  const trimmed = path.replace(/[/\\]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

/** 家目录换成 ~，微信里更好读。 */
function prettyPath(path) {
  const home = typeof process.env.HOME === 'string' ? process.env.HOME : ''
  if (home !== '' && path === home) return '~'
  if (home !== '' && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`
  return path
}

/**
 * 归一化后的工作区：{ id, title, path, sessionIds }。
 * registry 缺失时用会话的 cwd 兜底推导，保证命令总有结果。
 */
export async function loadWorkspaces(ctx) {
  const registry = serviceOf(ctx, 'workspaceRegistry')
  if (registry?.list !== undefined) {
    try {
      const list = registry.list()
      if (Array.isArray(list)) {
        return list.map((item) => ({
          id: String(item?.id ?? ''),
          title: String(item?.title ?? baseName(item?.path) ?? ''),
          path: String(item?.path ?? ''),
          sessionIds: Array.isArray(item?.sessionIds) ? item.sessionIds : [],
        }))
      }
    } catch {
      // 落到下面的会话推导
    }
  }
  const records = await listSessionRecords(ctx)
  const byPath = new Map()
  for (const record of records) {
    const cwd = record.header?.cwd
    if (typeof cwd !== 'string' || cwd === '') continue
    const entry = byPath.get(cwd) ?? { id: cwd, title: baseName(cwd), path: cwd, sessionIds: [] }
    entry.sessionIds.push(record.header.id)
    byPath.set(cwd, entry)
  }
  return [...byPath.values()]
}

/** sessionQuery 优先（带 live 状态），缺失时退回 sessionPersistence；两者都缺则空。 */
async function listSessionRecords(ctx) {
  const query = serviceOf(ctx, 'sessionQuery')
  if (typeof query?.listSessions === 'function') {
    try {
      const records = await query.listSessions()
      if (Array.isArray(records)) return records
    } catch {
      // 继续退化
    }
  }
  const persistence = serviceOf(ctx, 'sessionPersistence')
  if (typeof persistence?.list === 'function') {
    try {
      const snapshots = await persistence.list()
      if (Array.isArray(snapshots)) {
        return snapshots
          .filter((snapshot) => snapshot?.header !== undefined)
          .map((snapshot) => ({ header: snapshot.header, live: false, persisted: true }))
      }
    } catch {
      // 没别的来源了
    }
  }
  return []
}

/** 批量取会话名（session/title 折叠），拿不到就空表。 */
async function loadTitles(ctx, sessionIds) {
  const titles = new Map()
  const query = serviceOf(ctx, 'sessionQuery')
  if (typeof query?.readTitleSnapshots !== 'function' || sessionIds.length === 0) return titles
  try {
    const results = await query.readTitleSnapshots(sessionIds)
    if (!Array.isArray(results)) return titles
    for (const result of results) {
      if (result?.status !== 'fulfilled') continue
      const title = result.value?.title?.title
      if (typeof title === 'string' && title !== '') titles.set(result.sessionId, title)
    }
  } catch {
    // 标题只是锦上添花
  }
  return titles
}

/** 会话头里记的 cwd（比桥接当前值更准，换过工作区也能反映出来）。 */
async function sessionCwdOf(ctx, sessionId) {
  if (sessionId === undefined) return undefined
  const query = serviceOf(ctx, 'sessionQuery')
  if (typeof query?.listSessions === 'function') {
    try {
      const records = await query.listSessions()
      const found = records.find((record) => record?.header?.id === sessionId)
      const cwd = found?.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    } catch {
      // 继续退化
    }
  }
  const persistence = serviceOf(ctx, 'sessionPersistence')
  if (typeof persistence?.stat === 'function') {
    try {
      const snapshot = await persistence.stat(sessionId)
      const cwd = snapshot?.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    } catch {
      // 没有就没有
    }
  }
  return undefined
}

/** 当前会话在跑时取它的权限预设名；没在跑返回 undefined。 */
function currentPresetOf(ctx, sessionId) {
  const agents = serviceOf(ctx, 'agents')
  const agent = agents?.get?.(sessionId)
  const session = agent?.session
  if (session === undefined) return undefined
  try {
    const preset = serviceOf(ctx, 'permissionPresets')?.current?.(session)
    return typeof preset === 'string' && preset !== '' ? preset : undefined
  } catch {
    return undefined
  }
}

/** 在给定工作区里按序号 / 路径 / 名字定位一个工作区。 */
export function resolveWorkspace(workspaces, ref) {
  const text = typeof ref === 'string' ? ref.trim() : ''
  if (text === '') return undefined
  const list = Array.isArray(workspaces) ? workspaces : []
  if (/^\d+$/.test(text)) {
    const index = Number(text) - 1
    return index >= 0 && index < list.length ? list[index] : undefined
  }
  const normalized = text.replace(/[/\\]+$/, '')
  return (
    list.find((item) => item.path === normalized) ??
    list.find((item) => item.path === text) ??
    list.find((item) => item.path.endsWith(`/${normalized}`)) ??
    list.find((item) => item.title === text)
  )
}

/**
 * 「当前任务」三件套：工作区、session_id、会话名（外带权限预设）。
 * @param {object} options
 * @param {object} options.ctx 宿主上下文
 * @param {string} [options.sessionId] 当前会话 id
 * @param {string} [options.workspaceCwd] 桥接使用的工作区（会话还没建时也能答）
 */
export async function describeCurrent({ ctx, sessionId, workspaceCwd } = {}) {
  const cwd = (await sessionCwdOf(ctx, sessionId)) ?? (typeof workspaceCwd === 'string' ? workspaceCwd : '')
  const workspaces = await loadWorkspaces(ctx)
  const workspace = workspaces.find((item) => item.path === cwd)
  const titles = sessionId === undefined ? new Map() : await loadTitles(ctx, [sessionId])
  const title = titles.get(sessionId)
  const preset = sessionId === undefined ? undefined : currentPresetOf(ctx, sessionId)

  const lines = ['当前会话：']
  lines.push(`工作区：${workspace === undefined ? `${prettyPath(cwd)}（未登记）` : `${workspace.title} — ${prettyPath(workspace.path)}`}`)
  lines.push(`会话名：${title === undefined ? '（还没有名字）' : title}`)
  lines.push(`session_id：${sessionId === undefined ? '（还没有会话）' : sessionId}`)
  lines.push(`权限预设：${preset === undefined ? '（会话当前未激活，发消息后按新会话的预设生效）' : preset}`)
  return lines.join('\n')
}

/** 工作区列表（序号供 /sessions <序号> 用）。 */
export async function describeWorkspaces(ctx) {
  const workspaces = await loadWorkspaces(ctx)
  if (workspaces.length === 0) return '还没有登记任何工作区。\n可以从 DSH 桌面端建一个，或把配置里的 bridgeWorkspace 指到某个目录。'
  const lines = [`工作区（${workspaces.length} 个）：`]
  workspaces.forEach((workspace, index) => {
    lines.push(`${index + 1}. ${workspace.title} — ${prettyPath(workspace.path)}（会话 ${workspace.sessionIds.length} 个）`)
  })
  lines.push('', '用 /sessions <序号> 看某个工作区下的会话。')
  return lines.join('\n')
}

/** 某个工作区最近的会话（带标题）；/sessions 的文案与 /use 的序号共用这一份。 */
export async function sessionsOfWorkspace(ctx, workspacePath, { limit = MAX_SESSION_LINES } = {}) {
  const records = await listSessionRecords(ctx)
  const matched = records.filter((record) => record?.header?.cwd === workspacePath)
  const shown = matched.slice(0, limit)
  const titles = await loadTitles(
    ctx,
    shown.map((record) => record.header.id),
  )
  return {
    total: matched.length,
    sessions: shown.map((record) => ({ id: record.header.id, title: titles.get(record.header.id) })),
  }
}

/** 按 id 前缀找会话（跨工作区，最多 limit 条），/use 用。 */
export async function sessionsByPrefix(ctx, prefix, { limit = 5 } = {}) {
  const value = typeof prefix === 'string' ? prefix.trim() : ''
  if (value === '') return []
  const records = await listSessionRecords(ctx)
  const matched = records
    .filter((record) => typeof record?.header?.id === 'string' && record.header.id.startsWith(value))
    .slice(0, limit)
  const titles = await loadTitles(
    ctx,
    matched.map((record) => record.header.id),
  )
  return matched.map((record) => ({
    id: record.header.id,
    cwd: record.header.cwd,
    title: titles.get(record.header.id),
  }))
}

/** 某个工作区下的会话（最近优先，最多 MAX_SESSION_LINES 条）。 */
export async function describeWorkspaceSessions({ ctx, workspace, currentSessionId, listing } = {}) {
  if (workspace === undefined) return '找不到这个工作区。先用 /workspaces 看一遍序号。'
  const { total, sessions } = listing ?? (await sessionsOfWorkspace(ctx, workspace.path))
  if (total === 0) return `${workspace.title}（${prettyPath(workspace.path)}）下还没有会话。`
  const lines = [
    `${workspace.title} 下的会话（共 ${total} 个${total > sessions.length ? `，显示最近 ${sessions.length} 个` : ''}）：`,
  ]
  sessions.forEach((session, index) => {
    const current = session.id === currentSessionId ? '（当前）' : ''
    lines.push(`${index + 1}. ${session.title ?? '（未命名）'}${current} · ${session.id}`)
  })
  lines.push('', '用 /use <序号> 切到其中一条；/use <id前缀> 可以跨工作区选。')
  return lines.join('\n')
}

/** `/sessions all`：每个工作区取最近几条，只读一遍语料。 */
export async function describeAllSessions({ ctx, currentSessionId } = {}) {
  const workspaces = await loadWorkspaces(ctx)
  if (workspaces.length === 0) return '还没有登记任何工作区。'
  const records = await listSessionRecords(ctx)
  const lines = []
  for (const workspace of workspaces) {
    const matched = records.filter((record) => record?.header?.cwd === workspace.path)
    if (matched.length === 0) continue
    const shown = matched.slice(0, MAX_SESSION_LINES_PER_WORKSPACE)
    const titles = await loadTitles(
      ctx,
      shown.map((record) => record.header.id),
    )
    lines.push(`${workspace.title}（${prettyPath(workspace.path)}）`)
    for (const record of shown) {
      const id = record.header.id
      const title = titles.get(id) ?? '（未命名）'
      const current = id === currentSessionId ? '（当前）' : ''
      lines.push(`· ${title}${current} · ${id}`)
    }
  }
  return lines.length === 0 ? '还没有任何会话。' : lines.join('\n')
}

/** 判断 /sessions 的参数是不是 "all"。 */
export function isAllRef(ref) {
  return typeof ref === 'string' && ref.trim().toLowerCase() === 'all'
}
