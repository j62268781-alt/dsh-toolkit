/**
 * 插件入口。
 *
 * 不 `inject` 任何服务：皮肤只碰 DOM 与 CSS 变量，不调 slots、不调 theme。
 * （令牌是直接写在样式表里的 —— 内置主题的 tokens 是空对象，没有内联 style
 * 需要去压，所以不需要 `ctx.theme.overrideTokens`。哪天用户装了会注册
 * override 的第三方主题，再改成 overrideTokens 也不迟，见 README。）
 *
 * @param {import("cordis").Context} ctx - Client 侧 cordis 上下文。
 */
/* ══════════════════════════════════════════════════════════════════════
 * 设置页：已归档的聊天
 *
 * DSH 本身有归档能力（侧栏会话菜单里的「归档」），但归档后的会话只能靠
 * 侧栏那个三态筛选（隐藏归档 / 全部会话 / 仅归档）去看，没有一个专门的管理页。
 * 这个 section 补上那一页：按项目分组列出归档会话，可搜索、可按项目过滤、
 * 可单条或批量恢复。
 *
 * 数据全部来自 Client 已有的两个服务，不新增 Host 接口：
 *   ctx.sessions.list      → { byId, ids }       每个会话的标题 / 更新时间 / blank
 *   ctx.workspaces.list    → { items, archivedSessionIds, pinnedSessionIds }
 *                            items[].sessionIds 就是成员关系，archived 是会话 id 数组
 * 恢复走 ctx.workspaces.unarchiveSession(id)（Host 侧的同一份归档集）。
 *
 * 页面注册进 ui-settings 声明的 `settings.section` 槽位（与「内置插件」「模型」
 * 等设置页同级），order 20 排在内置插件(15) 之后、Agent 循环(30) 之前。
 * ══════════════════════════════════════════════════════════════════════ */

/** locale 命名空间。 */
const ARCH_NS = "shell-kit.archived";

/** 词典。 */
const ARCH_COPY = {
  zh: {
    nav: "已归档的聊天",
    title: "已归档的聊天",
    search: "搜索已归档的聊天",
    allProjects: "所有项目",
    project: "项目",
    restoreAll: "全部取消归档",
    restore: "取消归档",
    remove: "删除",
    confirmRemove: "确定要永久删除这条会话吗？\n\n「{t}」的聊天记录会从磁盘移入回收站（dsh-delete-session-trash），无法在应用里恢复。",
    removeFailed: "删除失败：{reason}",
    removeHint: "删除会把会话目录移进 ~/.dsh/dsh-delete-session-trash，列表里立刻消失；归档标记的残留在下次启动后被自动忽略。",
    chats: "个聊天",
    empty: "还没有归档的会话",
    emptyHint: "在侧栏会话的「…」菜单里选「归档」，它就会出现在这里。",
    noMatch: "没有匹配的归档会话",
    ungrouped: "未分组",
    confirmRestoreAll: "恢复全部 {n} 个归档会话？",
    done: "已恢复 {n} 个会话",
    untitled: "无标题会话",
    unlisted: "另有 {n} 条归档记录没有可显示的会话数据（所属工作区已不存在），无法在这里恢复。",
  },
  en: {
    nav: "Archived chats",
    title: "Archived chats",
    search: "Search archived chats",
    allProjects: "All projects",
    project: "Project",
    restoreAll: "Unarchive all",
    restore: "Unarchive",
    remove: "Delete",
    confirmRemove: "Permanently delete this chat?\n\n\"{t}\" will be moved to the trash folder (dsh-delete-session-trash); it cannot be restored from the app.",
    removeFailed: "Delete failed: {reason}",
    removeHint: "Delete moves the chat folder into ~/.dsh/dsh-delete-session-trash. The row disappears right away; the leftover archive marker is ignored on next launch.",
    chats: "chats",
    empty: "No archived chats yet",
    emptyHint: "Pick “Archive” from a session’s “…” menu in the sidebar and it shows up here.",
    noMatch: "No archived chats match",
    ungrouped: "Ungrouped",
    confirmRestoreAll: "Unarchive all {n} archived chats?",
    done: "Restored {n} chats",
    untitled: "Untitled chat",
    unlisted: "{n} more archived records have no session data left (their workspace is gone), so they cannot be restored here.",
  },
};

/** 会话行标题：Host 还没生成标题时用占位。 */
function archivedRowTitle(summary) {
  const title = typeof summary?.title === "string" ? summary.title.trim() : "";
  if (title !== "") return title;
  const display = typeof summary?.displayTitle === "string" ? summary.displayTitle.trim() : "";
  return display;
}

/**
 * 把两个服务快照拼成「按项目分组」的归档列表。
 *
 * @returns {{groups: Array<{id: string, title: string, rows: Array<object>}>, total: number}}
 */
function readArchived(ctx) {
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
    // 子代理会话（parentId / origin: "subagent"）不是用户开的聊天，不进这个管理页
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

/** 16×16 folder，取自侧栏「工作区」行的原始图标。 */
function ArchivedFolderIcon() {
  return (
    <svg
      className="sk-arch__icon"
      width={16}
      height={16}
      viewBox="0 0 16 16"
      fill="none"
      strokeWidth={1}
      aria-hidden="true"
    >
      <path
        d="M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z"
        stroke="currentColor"
      />
      <path d="M3.63501 7.66614H12.3647" stroke="currentColor" />
    </svg>
  );
}

/** 放大镜。 */
function ArchivedSearchIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx={7} cy={7} r={4.5} stroke="currentColor" strokeWidth={1} />
      <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth={1} />
    </svg>
  );
}

/**
 * 已归档的聊天页面。
 *
 * 不消费 Host 新增接口：只在两个已有快照上做投影，所以页面在离线/冷启动时
 * 也能立刻画出上一份数据。
 */
/** Host 侧的删除通道（由 index-inject 注入的 `window.__SK_HOST`）；缺失时返回 null。 */
function deleteEndpoint() {
  const host = typeof window === "undefined" ? null : window.__SK_HOST;
  if (!host || typeof host.deleteUrl !== "string" || typeof host.token !== "string") return null;
  return host;
}

/** 请求 Host 把这条会话的磁盘目录移进回收站。 */
async function removeSessionViaHost(sessionId) {
  const host = deleteEndpoint();
  if (host === null) return { ok: false, reason: "no-endpoint" };
  try {
    const response = await fetch(`${host.deleteUrl}/delete-session`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sk-token": host.token },
      body: JSON.stringify({ sessionId }),
    });
    return await response.json();
  } catch (error) {
    return { ok: false, reason: String(error?.message ?? error) };
  }
}

function createArchivedSection(ctx) {
  const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

  return function ArchivedChatsSection() {
    const t = ctx.locale.bind(ARCH_NS);
    const [, bump] = React.useState(0);
    const [query, setQuery] = React.useState("");
    const [project, setProject] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    // 删掉的会话：磁盘目录已经移进回收站，但归档标记还留在 workspace.json 里，
    // 重启前列表仍会给出这一行 —— 本地先藏起来，重启后它自然解析不到。
    const [hidden, setHidden] = React.useState(() => new Set());
    const [notice, setNotice] = React.useState("");
    const canRemove = deleteEndpoint() !== null;

    React.useEffect(() => {
      const rerender = () => bump((n) => n + 1);
      const offs = [];
      try {
        offs.push(ctx.sessions.list.subscribe(rerender));
      } catch {
        /* 服务不可用时页面退化为一次性快照 */
      }
      try {
        offs.push(ctx.workspaces.list.subscribe(rerender));
      } catch {
        /* 同上 */
      }
      return () => {
        for (const off of offs) {
          try {
            off();
          } catch {
            /* 已经退订 */
          }
        }
      };
    }, []);

    const { groups, total, unlisted } = readArchived(ctx);
    const projects = groups.filter((group) => group.id !== "__ungrouped");
    const needle = query.trim().toLowerCase();
    const visible = groups
      .filter((group) => project === "" || group.id === project)
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => {
          if (hidden.has(row.id)) return false;
          if (needle === "") return true;
          return (
            (row.title || "").toLowerCase().includes(needle) ||
            group.title.toLowerCase().includes(needle)
          );
        }),
      }))
      .filter((group) => group.rows.length > 0);
    const shown = visible.reduce((n, group) => n + group.rows.length, 0);

    const remove = async (row) => {
      const ask = t("confirmRemove").replace("{t}", row.title || t("untitled"));
      if (typeof window !== "undefined" && !window.confirm(ask)) return;
      setBusy(true);
      setNotice("");
      try {
        const result = await removeSessionViaHost(row.id);
        if (result?.ok === true) {
          setHidden((prev) => new Set(prev).add(row.id));
        } else {
          setNotice(t("removeFailed").replace("{reason}", result?.reason ?? "unknown"));
        }
      } finally {
        setBusy(false);
      }
    };

    const restore = async (id) => {
      setBusy(true);
      try {
        await ctx.workspaces.unarchiveSession(id);
      } finally {
        setBusy(false);
      }
    };
    const restoreAll = async () => {
      const ids = visible.flatMap((group) => group.rows.map((row) => row.id));
      if (ids.length === 0) return;
      const ask = t("confirmRestoreAll").replace("{n}", String(ids.length));
      if (typeof window !== "undefined" && !window.confirm(ask)) return;
      setBusy(true);
      try {
        for (const id of ids) await ctx.workspaces.unarchiveSession(id);
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="sk-arch">
        <div className="sk-arch__head">
          <h2 className="sk-arch__title">{t("title")}</h2>
          <button
            type="button"
            className="sk-arch__action"
            disabled={busy || shown === 0}
            onClick={restoreAll}
          >
            {t("restoreAll")}
          </button>
        </div>

        <div className="sk-arch__bar">
          <div className="sk-arch__search">
            <ArchivedSearchIcon />
            <input
              type="search"
              value={query}
              placeholder={t("search")}
              aria-label={t("search")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            className="sk-arch__select"
            value={project}
            aria-label={t("project")}
            onChange={(event) => setProject(event.target.value)}
          >
            <option value="">{t("allProjects")}</option>
            {projects.map((group) => (
              <option value={group.id} key={group.id}>
                {group.title}
              </option>
            ))}
          </select>
        </div>

        {visible.length === 0 ? (
          <div className="sk-arch__empty">
            <p className="sk-arch__emptyTitle">{total === 0 ? t("empty") : t("noMatch")}</p>
            {total === 0 ? <p className="sk-arch__emptyHint">{t("emptyHint")}</p> : null}
          </div>
        ) : (
          visible.map((group) => (
            <section className="sk-arch__group" key={group.id}>
              <div className="sk-arch__groupHead">
                <ArchivedFolderIcon />
                <span className="sk-arch__groupTitle">{group.title || t("ungrouped")}</span>
                <span className="sk-arch__groupCount">{`${group.rows.length} ${t("chats")}`}</span>
              </div>
              {group.rows.map((row) => (
                <div className="sk-arch__row" key={row.id}>
                  <div className="sk-arch__rowMain">
                    <span className="sk-arch__rowTitle" title={row.title || t("untitled")}>
                      {row.title || t("untitled")}
                    </span>
                    <span className="sk-arch__rowTime">
                      {row.updatedAt > 0 ? timeFormat.format(new Date(row.updatedAt)) : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="sk-arch__btn"
                    disabled={busy}
                    onClick={() => restore(row.id)}
                  >
                    {t("restore")}
                  </button>
                  <button
                    type="button"
                    className="sk-arch__btn sk-arch__btn--danger"
                    disabled={busy || !canRemove}
                    title={canRemove ? undefined : t("removeFailed").replace("{reason}", "no-endpoint")}
                    onClick={() => remove(row)}
                  >
                    {t("remove")}
                  </button>
                </div>
              ))}
            </section>
          ))
        )}

        {notice !== "" ? <p className="sk-arch__note sk-arch__note--error">{notice}</p> : null}
        {canRemove ? <p className="sk-arch__note">{t("removeHint")}</p> : null}

        {unlisted > 0 ? (
          <p className="sk-arch__note">{t("unlisted").replace("{n}", String(unlisted))}</p>
        ) : null}
      </div>
    );
  };
}

/** 注册设置页 section（`settings.section` 是 ui-settings 声明的根槽位）。 */
function installArchivedSection(ctx) {
  const t = ctx.locale.bind(ARCH_NS);
  return ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "archived-chats",
        order: 20,
        label: () => t("nav"),
        locale: ARCH_NS,
      },
      createArchivedSection(ctx)
    )
  );
}

