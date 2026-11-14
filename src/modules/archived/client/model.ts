import { DELETION_CODE } from "./constants.js";

// Project the existing session and workspace snapshots without mutating either source.
export function archivedRowTitle(summary) {
  const title = typeof summary?.title === "string" ? summary.title.trim() : "";
  if (title !== "") return title;
  const display = typeof summary?.displayTitle === "string" ? summary.displayTitle.trim() : "";
  return display;
}

/**
 * 宿主回执的 `code` → 本模块字典里的文案键。
 *
 * 宿主只说数字 code（码表在 `host/constants.js`，唯一来源），措辞留在这里：改一句提示
 * 不用碰宿主，也不会像 `reason` 时代那样「宿主改了措辞，客户端的分支悄悄失效」。
 * `notFound` 不在表里 —— 文件本来就没了，removal 会把它当成成功。
 */
const FAILURE_KEYS = {
  [DELETION_CODE.invalidSessionId]: "failInvalidId",
  [DELETION_CODE.noSessionsDirectory]: "failNoSessionsDir",
  [DELETION_CODE.moveFailed]: "failLocked",
  [DELETION_CODE.sessionLoaded]: "failLoaded",
  [DELETION_CODE.sessionBusy]: "failBusy",
  [DELETION_CODE.unknown]: "failUnknown",
};

/**
 * 失败回执 → 用户可读的一句话。
 *
 * 只有 `unknown`（传输层失败、flush 抛错）才显示宿主的原始 `detail` —— 那是用户唯一
 * 能拿去报告的线索；其余 code 都有确定含义，露系统错误只会更难懂。
 */
export function failureText(t, receipt) {
  const detail = typeof receipt?.detail === "string" ? receipt.detail.trim() : "";
  const code = receipt?.code ?? DELETION_CODE.unknown;
  if (code === DELETION_CODE.unknown && detail !== "") return detail;
  return t(FAILURE_KEYS[code] ?? "failUnknown");
}

const UNGROUPED = "__ungrouped";

/**
 * One row per archived Session, grouped by the Workspace that accounts for it.
 *
 * Every id in the registry-global archive set is listed, including Sessions
 * whose summary never arrived (their data is gone or unreadable) and Sessions
 * the sidebar hides (subagents): leaving them out would strand them in the
 * archive set with no way to restore or delete them. A row without a summary
 * carries `missing` so the UI can label it instead of inventing a title.
 */
export function readArchived(ctx) {
  const sessions = ctx.sessions?.list?.getSnapshot?.() ?? {};
  const workspaces = ctx.workspaces?.list?.getSnapshot?.() ?? {};
  const byId = sessions.byId ?? {};
  const items = Array.isArray(workspaces.items) ? workspaces.items : [];
  const archived = [...new Set(Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : [])];

  const workspaceByPath = new Map();
  for (const workspace of items) {
    const path = typeof workspace.path === "string" ? workspace.path : "";
    if (path && !workspaceByPath.has(path)) workspaceByPath.set(path, workspace);
  }
  const workspaceKey = (workspace) => workspace?.workspaceId ?? workspace?.id ?? "";
  const workspaceOf = new Map();
  for (const workspace of items) {
    for (const sessionId of workspace.sessionIds ?? []) {
      if (!workspaceOf.has(sessionId)) workspaceOf.set(sessionId, workspace);
    }
  }

  const groupOf = (id) => {
    const byMember = workspaceOf.get(id);
    if (byMember) return byMember;
    const cwd = byId[id]?.cwd;
    return typeof cwd === "string" ? workspaceByPath.get(cwd) : undefined;
  };

  const toRow = (id) => {
    const summary = byId[id];
    const workspace = groupOf(id);
    return {
      id,
      title: archivedRowTitle(summary),
      updatedAt: summary?.updatedAt ?? 0,
      workspaceId: workspaceKey(workspace),
      missing: summary === undefined,
    };
  };

  const buckets = new Map();
  for (const id of archived) {
    const workspace = groupOf(id);
    const key = workspace ? workspaceKey(workspace) : UNGROUPED;
    if (!buckets.has(key)) {
      buckets.set(key, { id: key, title: workspace?.title ?? workspace?.path ?? "", rows: [] });
    }
    buckets.get(key).rows.push(toRow(id));
  }

  const byRecency = (a, b) => b.updatedAt - a.updatedAt;
  const groups = [];
  for (const workspace of items) {
    const key = workspaceKey(workspace);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    groups.push({ id: key, title: bucket.title, rows: bucket.rows.sort(byRecency), workspaceId: key });
  }
  const ungrouped = buckets.get(UNGROUPED);
  if (ungrouped) {
    groups.push({ id: UNGROUPED, title: "", rows: ungrouped.rows.sort(byRecency), workspaceId: "" });
  }

  // The filter lists every Workspace, not only the ones with archived rows, so a
  // project that just gained its first archive is already selectable.
  const projects = items.map((workspace) => ({ id: workspaceKey(workspace), title: workspace?.title ?? workspace?.path ?? "" }));

  return { groups, total: archived.length, projects, hasUngrouped: ungrouped !== undefined };
}
