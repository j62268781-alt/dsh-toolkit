// Project the existing session and workspace snapshots without mutating either source.
export function archivedRowTitle(summary) {
  const title = typeof summary?.title === "string" ? summary.title.trim() : "";
  if (title !== "") return title;
  const display = typeof summary?.displayTitle === "string" ? summary.displayTitle.trim() : "";
  return display;
}

export function readArchived(ctx) {
  const sessions = ctx.sessions?.list?.getSnapshot?.() ?? {};
  const workspaces = ctx.workspaces?.list?.getSnapshot?.() ?? {};
  const byId = sessions.byId ?? {};
  const items = Array.isArray(workspaces.items) ? workspaces.items : [];
  const archived = new Set(Array.isArray(workspaces.archivedSessionIds) ? workspaces.archivedSessionIds : []);

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
    };
  };
  const byRecency = (a, b) => b.updatedAt - a.updatedAt;

  const buckets = new Map();
  for (const id of archived) {
    const summary = byId[id];
    if (summary === undefined) continue;

    if (summary.origin === "subagent") continue;
    const workspace = groupOf(id);
    const key = workspace ? workspaceKey(workspace) : "__ungrouped";
    if (!buckets.has(key)) {
      buckets.set(key, { id: key, title: workspace?.title ?? workspace?.path ?? "", rows: [] });
    }
    buckets.get(key).rows.push(toRow(id));
  }

  const groups = [];
  for (const workspace of items) {
    const key = workspaceKey(workspace);
    const bucket = buckets.get(key);
    if (!bucket || bucket.rows.length === 0) continue;
    groups.push({ ...bucket, rows: bucket.rows.sort(byRecency) });
    buckets.delete(key);
  }
  const ungrouped = buckets.get("__ungrouped");
  if (ungrouped && ungrouped.rows.length > 0) {
    groups.push({ id: "__ungrouped", title: "", rows: ungrouped.rows.sort(byRecency) });
  }

  const total = groups.reduce((n, group) => n + group.rows.length, 0);
  return { groups, total, unlisted: Math.max(0, archived.size - total) };
}
